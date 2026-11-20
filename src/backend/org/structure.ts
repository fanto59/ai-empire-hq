import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { INITIAL_BUSINESSES, INITIAL_SECTORS, CREATABLE_AGENT_ROLES, type CreatableAgentRole } from "@/domain/sectors";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, businesses, projects, sectors, tasks } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import { canAccessBusiness, type RequestContext } from "../auth/context";
import { ServiceError } from "../errors";
import { slugify } from "../knowledge/paths";
import { canAssignAgent, canOwnProject } from "./rules";

/**
 * ORGANIZATION STRUCTURE - sectors, businesses, sector/business agents and
 * projects, as real database records.
 *
 * Who may change it: a PERSON with the `businesses:admin` scope and
 * organization-wide access (agents never). Every change is audited.
 *
 * New agents start with a minimal permission set (task.read, task.execute,
 * approval.request, knowledge.read) and NO tasks: nothing - in particular no
 * paid model call - starts until a person assigns work. They get no research
 * or spending permissions.
 */
type BusinessRow = typeof businesses.$inferSelect;
type AgentRow = typeof agents.$inferSelect;

const BASE_PERMISSIONS = ["task.read", "task.execute", "approval.request", "knowledge.read"] as const;
const OPEN_STATES = ["queued", "assigned", "running", "waiting", "paused"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertOrgAdmin(ctx: RequestContext): void {
  if (ctx.principal.kind !== "user") throw new ServiceError("forbidden", "Only people can change the organization's structure.");
  if (!ctx.scopes.has("businesses:admin")) throw new ServiceError("forbidden", "This needs an administrator token (businesses:admin scope).");
  if (ctx.businesses !== "*" || !ctx.hq) throw new ServiceError("forbidden", "This needs organization-wide access.");
}

const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ServiceError("invalid-input", `${field} is not valid.`);
  return v;
};

function cleanName(v: unknown, field: string, min = 2, max = 80): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (s.length < min || s.length > max) throw new ServiceError("invalid-input", `${field} must be ${min}-${max} characters.`);
  if (/[<>\u0000-\u001f]/.test(s)) throw new ServiceError("invalid-input", `${field} contains characters that are not allowed.`);
  return s;
}

/** A slug unique within the organization for `table` (appends -2, -3, ...). */
async function uniqueSlug(db: Db, table: "businesses" | "agents" | "projects", organizationId: string, base: string): Promise<string> {
  const t = table === "businesses" ? businesses : table === "agents" ? agents : projects;
  const root = (slugify(base) || table.slice(0, -1)).slice(0, 56).replace(/-+$/, "");
  const taken = new Set(
    (await db.select({ slug: t.slug }).from(t).where(and(eq(t.organizationId, organizationId), sql`${t.slug} like ${`${root}%`}`))).map((r) => r.slug),
  );
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

// ---- provisioning -----------------------------------------------------------------

export interface ProvisionResult {
  sectorsCreated: number;
  businessesCreated: number;
  managersCreated: number;
}

/**
 * Creates the initial sectors, the Nightlife & Entertainment businesses and
 * one manager agent per sector. Idempotent: existing records (matched by
 * slug) are kept as they are.
 */
export async function provisionInitialStructure(db: Db, organizationId: string, now: Date = new Date()): Promise<ProvisionResult> {
  const result: ProvisionResult = { sectorsCreated: 0, businessesCreated: 0, managersCreated: 0 };
  return db.transaction(async (tx) => {
    const sectorIds = new Map<string, string>();
    for (const [i, def] of INITIAL_SECTORS.entries()) {
      const [existing] = await tx.select().from(sectors).where(and(eq(sectors.organizationId, organizationId), eq(sectors.slug, def.slug)));
      if (existing) {
        sectorIds.set(def.slug, existing.id);
        continue;
      }
      const [row] = await tx.insert(sectors).values({ organizationId, slug: def.slug, name: def.name, description: def.description, position: i + 1 }).returning();
      sectorIds.set(def.slug, row!.id);
      result.sectorsCreated++;
    }
    for (const def of INITIAL_BUSINESSES) {
      const [existing] = await tx.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.organizationId, organizationId), eq(businesses.slug, def.slug)));
      if (existing) continue;
      await tx.insert(businesses).values({ organizationId, sectorId: sectorIds.get(def.sector)!, slug: def.slug, name: def.name, status: "planning" });
      result.businessesCreated++;
    }
    for (const def of INITIAL_SECTORS) {
      const slug = `${def.slug}-manager`;
      const [existing] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.slug, slug)));
      if (existing) continue;
      const [agent] = await tx
        .insert(agents)
        .values({ organizationId, businessId: null, sectorId: sectorIds.get(def.slug)!, slug, displayName: `${def.name} Manager`, role: "sector-manager", status: "active" })
        .returning();
      await tx.insert(agentPermissions).values(BASE_PERMISSIONS.map((permission) => ({ agentId: agent!.id, permission, grantedBy: "provisioning" })));
      result.managersCreated++;
    }
    if (result.sectorsCreated + result.businessesCreated + result.managersCreated > 0) {
      await writeAudit(tx, {
        organizationId,
        businessId: null,
        actor: { kind: "system", id: "provisioning" },
        action: "organization.provisioned",
        targetType: "organization",
        targetId: organizationId,
        metadata: { sectors: result.sectorsCreated, businesses: result.businessesCreated, managers: result.managersCreated },
        at: now,
      });
    }
    return result;
  });
}

// ---- businesses ---------------------------------------------------------------------

export async function createBusiness(db: Db, ctx: RequestContext, input: { name: unknown; sectorId: unknown; description?: unknown }, now = new Date()): Promise<BusinessRow> {
  assertOrgAdmin(ctx);
  const name = cleanName(input.name, "Business name");
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const sectorId = uuid(input.sectorId, "Sector");
  const [sector] = await db.select().from(sectors).where(and(eq(sectors.id, sectorId), eq(sectors.organizationId, ctx.organizationId)));
  if (!sector) throw new ServiceError("not-found", "Sector not found.");
  const [clash] = await db.select({ name: businesses.name }).from(businesses).where(and(eq(businesses.organizationId, ctx.organizationId), sql`lower(${businesses.name}) = lower(${name})`));
  if (clash) throw new ServiceError("conflict", `A business named "${clash.name}" already exists. Businesses must stay distinct.`, "duplicate-business");
  const slug = await uniqueSlug(db, "businesses", ctx.organizationId, name);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(businesses).values({ organizationId: ctx.organizationId, sectorId, slug, name, description, status: "planning", createdAt: now, updatedAt: now }).returning();
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      businessId: row!.id,
      actor: { kind: "user", id: ctx.principal.id },
      action: "business.created",
      targetType: "business",
      targetId: row!.id,
      metadata: { name, sector: sector.slug },
      at: now,
    });
    return row!;
  });
}

async function loadBusiness(db: Db, ctx: RequestContext, businessId: unknown): Promise<BusinessRow> {
  const id = uuid(businessId, "Business");
  const [b] = await db.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.organizationId, ctx.organizationId)));
  if (!b) throw new ServiceError("not-found", "Business not found.");
  return b;
}

/** Archives a business. Refused while it has open tasks (finish or cancel them first). */
export async function archiveBusiness(db: Db, ctx: RequestContext, businessId: unknown, now = new Date()): Promise<BusinessRow> {
  assertOrgAdmin(ctx);
  const b = await loadBusiness(db, ctx, businessId);
  if (b.status === "archived") throw new ServiceError("conflict", `${b.name} is already archived.`);
  const open = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.businessId, b.id), inArray(tasks.state, [...OPEN_STATES])));
  if (open.length > 0) throw new ServiceError("conflict", `${b.name} has ${open.length} open task${open.length === 1 ? "" : "s"}. Finish or cancel them before archiving.`, "open-tasks");
  return setStatus(db, ctx, b, "archived", now);
}

/** Restores an archived business to planning. */
export async function restoreBusiness(db: Db, ctx: RequestContext, businessId: unknown, now = new Date()): Promise<BusinessRow> {
  assertOrgAdmin(ctx);
  const b = await loadBusiness(db, ctx, businessId);
  if (b.status !== "archived") throw new ServiceError("conflict", `${b.name} is not archived.`);
  return setStatus(db, ctx, b, "planning", now);
}

/** Planning / active / paused (archiving has its own rules above). */
export async function setBusinessStatus(db: Db, ctx: RequestContext, businessId: unknown, status: unknown, now = new Date()): Promise<BusinessRow> {
  assertOrgAdmin(ctx);
  if (status !== "planning" && status !== "active" && status !== "paused") throw new ServiceError("invalid-input", "Status must be planning, active or paused.");
  const b = await loadBusiness(db, ctx, businessId);
  if (b.status === "archived") throw new ServiceError("conflict", `${b.name} is archived; restore it first.`);
  return setStatus(db, ctx, b, status, now);
}

async function setStatus(db: Db, ctx: RequestContext, b: BusinessRow, status: BusinessRow["status"], now: Date): Promise<BusinessRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(businesses)
      .set({ status, archivedAt: status === "archived" ? now : null, updatedAt: now })
      .where(eq(businesses.id, b.id))
      .returning();
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      businessId: b.id,
      actor: { kind: "user", id: ctx.principal.id },
      action: status === "archived" ? "business.archived" : b.status === "archived" ? "business.restored" : "business.status_changed",
      targetType: "business",
      targetId: b.id,
      metadata: { from: b.status, to: status },
      at: now,
    });
    return row!;
  });
}

// ---- agents -----------------------------------------------------------------------------

/**
 * Creates a sector manager, sector specialist, business lead or business
 * specialist. No tasks are created and no work starts.
 */
export async function createAgent(
  db: Db,
  ctx: RequestContext,
  input: { name: unknown; role: unknown; sectorId?: unknown; businessId?: unknown },
  now = new Date(),
): Promise<AgentRow> {
  assertOrgAdmin(ctx);
  const name = cleanName(input.name, "Agent name");
  if (!CREATABLE_AGENT_ROLES.includes(input.role as CreatableAgentRole)) throw new ServiceError("invalid-input", "Role must be sector manager, business lead or specialist.");
  const role = input.role as CreatableAgentRole;
  const businessId = input.businessId ? uuid(input.businessId, "Business") : null;
  const sectorId = !businessId && input.sectorId ? uuid(input.sectorId, "Sector") : null;
  if (!businessId && !sectorId) throw new ServiceError("invalid-input", "Choose the sector or business this agent works for.");
  if (role === "sector-manager" && !sectorId) throw new ServiceError("invalid-input", "A sector manager works for a sector, not one business.");
  if (role === "business-lead" && !businessId) throw new ServiceError("invalid-input", "A business lead works for one business.");
  if (businessId) {
    const b = await loadBusiness(db, ctx, businessId);
    if (b.status === "archived") throw new ServiceError("conflict", `${b.name} is archived.`);
  } else {
    const [s] = await db.select({ id: sectors.id }).from(sectors).where(and(eq(sectors.id, sectorId!), eq(sectors.organizationId, ctx.organizationId)));
    if (!s) throw new ServiceError("not-found", "Sector not found.");
  }
  const slug = await uniqueSlug(db, "agents", ctx.organizationId, name);
  return db.transaction(async (tx) => {
    const [agent] = await tx.insert(agents).values({ organizationId: ctx.organizationId, businessId, sectorId, slug, displayName: name, role, status: "active", createdAt: now, updatedAt: now }).returning();
    await tx.insert(agentPermissions).values(BASE_PERMISSIONS.map((permission) => ({ agentId: agent!.id, permission, grantedBy: ctx.principal.id })));
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      businessId,
      actor: { kind: "user", id: ctx.principal.id },
      action: "agent.created",
      targetType: "agent",
      targetId: agent!.id,
      metadata: { role, sectorId, businessId },
      at: now,
    });
    return agent!;
  });
}

// ---- projects ---------------------------------------------------------------------------

/**
 * Creates a project for one business, one sector, or headquarters (a
 * cross-sector project). The caller needs tasks:write and access to the
 * scope; an owner agent must be allowed to lead that scope.
 */
export async function createProject(
  db: Db,
  ctx: RequestContext,
  input: { title: unknown; businessId?: unknown; sectorId?: unknown; ownerAgentId?: unknown },
  now = new Date(),
): Promise<typeof projects.$inferSelect> {
  if (!ctx.scopes.has("tasks:write")) throw new ServiceError("forbidden", "This token lacks the tasks:write scope.");
  const title = cleanName(input.title, "Project title", 3, 120);
  const businessId = input.businessId ? uuid(input.businessId, "Business") : null;
  const sectorId = !businessId && input.sectorId ? uuid(input.sectorId, "Sector") : null;
  let business: BusinessRow | null = null;
  if (businessId) {
    business = await loadBusiness(db, ctx, businessId);
    if (business.status === "archived") throw new ServiceError("conflict", `${business.name} is archived.`);
    if (!canAccessBusiness(ctx, businessId)) throw new ServiceError("forbidden", "You cannot create projects in that business.");
  } else if (sectorId) {
    const [s] = await db.select({ id: sectors.id }).from(sectors).where(and(eq(sectors.id, sectorId), eq(sectors.organizationId, ctx.organizationId)));
    if (!s) throw new ServiceError("not-found", "Sector not found.");
    const inSector = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.sectorId, sectorId));
    if (!(ctx.businesses === "*" || (inSector.length > 0 && inSector.every((b) => ctx.businesses.includes(b.id))))) throw new ServiceError("forbidden", "Sector projects need access to the whole sector.");
  } else if (!ctx.hq || ctx.businesses !== "*") {
    throw new ServiceError("forbidden", "Cross-sector (headquarters) projects need organization-wide access.");
  }
  let ownerAgentId: string | null = null;
  if (input.ownerAgentId) {
    ownerAgentId = uuid(input.ownerAgentId, "Owner");
    const [owner] = await db.select().from(agents).where(and(eq(agents.id, ownerAgentId), eq(agents.organizationId, ctx.organizationId)));
    if (!owner || owner.status !== "active") throw new ServiceError("invalid-input", "The owner must be an active agent.");
    const rule = canOwnProject(owner, { businessId, sectorId }, business);
    if (!rule.ok) throw new ServiceError("invalid-input", rule.message, rule.code);
  }
  const slug = await uniqueSlug(db, "projects", ctx.organizationId, title);
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(projects).values({ organizationId: ctx.organizationId, businessId, sectorId, slug, title, status: "active", ownerAgentId, createdAt: now, updatedAt: now }).returning();
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      businessId,
      actor: { kind: ctx.principal.kind, id: ctx.principal.id },
      action: "project.created",
      targetType: "project",
      targetId: p!.id,
      metadata: { scope: businessId ? "business" : sectorId ? "sector" : "headquarters", sectorId, ownerAgentId },
      at: now,
    });
    return p!;
  });
}

/** Agents of the organization that may be assigned a task of `businessId` (null = headquarters). */
export async function eligibleAgents(db: Db, organizationId: string, businessId: string | null): Promise<AgentRow[]> {
  const [b] = businessId ? await db.select().from(businesses).where(eq(businesses.id, businessId)) : [];
  const rows = await db.select().from(agents).where(and(eq(agents.organizationId, organizationId), eq(agents.status, "active"))).orderBy(asc(agents.displayName));
  return rows.filter((a) => canAssignAgent(a, b ?? null).ok);
}

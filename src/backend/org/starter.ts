import { and, eq } from "drizzle-orm";
import { profileTemplate, starterKitFor } from "@/domain/business-starter";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, businesses, departments, projects, sectors } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import type { RequestContext } from "../auth/context";
import { ServiceError } from "../errors";
import { KnowledgeError, type KnowledgeAccessContext, type KnowledgeService } from "../knowledge";
import { assertOrgAdmin } from "./structure";

/**
 * BUSINESS STARTER - gives one business a working team and a profile to fill
 * in. People only (businesses:admin), audited, idempotent (existing records,
 * matched by slug, are kept as they are; the profile is never overwritten).
 *
 * Creates: departments, a Business Lead and one specialist per department
 * (base permissions + knowledge.write so they can save DRAFT notes), projects
 * in "proposed" status, and the business.md profile TEMPLATE. It creates NO
 * tasks and spends nothing: agents only work when a person assigns work, and
 * only within the business budget (default $0).
 */
const STARTER_PERMISSIONS = ["task.read", "task.execute", "approval.request", "knowledge.read", "knowledge.write"] as const;

export interface StarterResult {
  departmentsCreated: number;
  agentsCreated: number;
  projectsCreated: number;
  profileCreated: boolean;
}

const personKnowledge = (ctx: RequestContext): KnowledgeAccessContext => ({ principal: { kind: "user", id: ctx.principal.id }, hq: true, businesses: "*", write: true });

async function loadBusiness(db: Db, ctx: RequestContext, businessId: unknown) {
  if (typeof businessId !== "string") throw new ServiceError("invalid-input", "Business is not valid.");
  const [b] = await db
    .select({ id: businesses.id, slug: businesses.slug, name: businesses.name, status: businesses.status, sectorId: businesses.sectorId, sectorSlug: sectors.slug })
    .from(businesses)
    .leftJoin(sectors, eq(sectors.id, businesses.sectorId))
    .where(and(eq(businesses.organizationId, ctx.organizationId), eq(businesses.id, businessId)));
  if (!b) throw new ServiceError("not-found", "Business not found.");
  return b;
}

export async function setupBusinessStarter(db: Db, knowledge: KnowledgeService, ctx: RequestContext, businessId: unknown, now = new Date()): Promise<StarterResult> {
  assertOrgAdmin(ctx);
  const b = await loadBusiness(db, ctx, businessId);
  if (b.status === "archived") throw new ServiceError("conflict", `${b.name} is archived.`);
  const kit = starterKitFor(b.sectorSlug);
  const result: StarterResult = { departmentsCreated: 0, agentsCreated: 0, projectsCreated: 0, profileCreated: false };

  await db.transaction(async (tx) => {
    const deptIds = new Map<string, string>();
    for (const d of kit.departments) {
      const [existing] = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.businessId, b.id), eq(departments.slug, d.slug)));
      if (existing) {
        deptIds.set(d.slug, existing.id);
        continue;
      }
      const [row] = await tx.insert(departments).values({ businessId: b.id, slug: d.slug, name: d.name, createdAt: now }).returning();
      deptIds.set(d.slug, row!.id);
      result.departmentsCreated++;
    }

    const wanted = [
      { slug: `${b.slug}-lead`, name: `${b.name} Lead`, role: "business-lead" as const, departmentId: null as string | null },
      ...kit.specialists.map((s) => ({ slug: `${b.slug}-${s.department}`, name: `${b.name} ${s.title}`, role: "specialist" as const, departmentId: deptIds.get(s.department) ?? null })),
    ];
    let leadId: string | null = null;
    for (const w of wanted) {
      const [existing] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, ctx.organizationId), eq(agents.slug, w.slug)));
      if (existing) {
        if (w.role === "business-lead") leadId = existing.id;
        continue;
      }
      const [agent] = await tx
        .insert(agents)
        .values({ organizationId: ctx.organizationId, businessId: b.id, departmentId: w.departmentId, slug: w.slug, displayName: w.name.slice(0, 80), role: w.role, status: "active", createdAt: now, updatedAt: now })
        .returning();
      await tx.insert(agentPermissions).values(STARTER_PERMISSIONS.map((permission) => ({ agentId: agent!.id, permission, grantedBy: ctx.principal.id })));
      if (w.role === "business-lead") leadId = agent!.id;
      result.agentsCreated++;
    }

    for (const title of kit.projects) {
      const slug = `${b.slug}-${title.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 64);
      const [existing] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.slug, slug)));
      if (existing) continue;
      await tx.insert(projects).values({ organizationId: ctx.organizationId, businessId: b.id, slug, title, status: "proposed", ownerAgentId: leadId, createdAt: now, updatedAt: now });
      result.projectsCreated++;
    }

    if (result.departmentsCreated + result.agentsCreated + result.projectsCreated > 0) {
      await writeAudit(tx, {
        organizationId: ctx.organizationId,
        businessId: b.id,
        actor: { kind: "user", id: ctx.principal.id },
        action: "business.starter_applied",
        targetType: "business",
        targetId: b.id,
        metadata: { departments: result.departmentsCreated, agents: result.agentsCreated, projects: result.projectsCreated },
        at: now,
      });
    }
  });

  // The profile template (never overwrites what the owner wrote).
  try {
    await knowledge.createNote(personKnowledge(ctx), { kind: "business", business: b.slug, title: b.name, body: profileTemplate(b.name, kit), status: "draft", tags: ["business-profile"] });
    result.profileCreated = true;
  } catch (e) {
    if (!(e instanceof KnowledgeError && e.code === "already-exists")) throw e;
  }
  return result;
}

/** The owner's business profile (business.md), or null if none exists yet. */
export async function readBusinessProfile(knowledge: KnowledgeService, ctx: RequestContext, businessSlug: string) {
  try {
    const note = await knowledge.readNote(personKnowledge(ctx), `businesses/${businessSlug}/business.md`);
    return { body: note.body, updated: note.meta.updated };
  } catch (e) {
    if (e instanceof KnowledgeError && e.code === "not-found") return null;
    throw e;
  }
}

/** Saves the owner's profile text. People with businesses:admin only; audited; secrets are refused by the knowledge service. */
export async function saveBusinessProfile(db: Db, knowledge: KnowledgeService, ctx: RequestContext, businessId: unknown, body: unknown, now = new Date()): Promise<{ path: string }> {
  assertOrgAdmin(ctx);
  const b = await loadBusiness(db, ctx, businessId);
  const text = typeof body === "string" ? body.replace(/\r\n/g, "\n").trim() : "";
  if (text.length < 10 || text.length > 50_000) throw new ServiceError("invalid-input", "The profile must be 10-50,000 characters.");
  const path = `businesses/${b.slug}/business.md`;
  try {
    await knowledge.updateNote(personKnowledge(ctx), path, { body: `${text}\n`, status: "final" });
  } catch (e) {
    if (!(e instanceof KnowledgeError && e.code === "not-found")) throw e;
    await knowledge.createNote(personKnowledge(ctx), { kind: "business", business: b.slug, title: b.name, body: `${text}\n`, status: "final", tags: ["business-profile"] });
  }
  await writeAudit(db, {
    organizationId: ctx.organizationId,
    businessId: b.id,
    actor: { kind: "user", id: ctx.principal.id },
    action: "business.profile_saved",
    targetType: "business",
    targetId: b.id,
    metadata: { characters: text.length },
    at: now,
  });
  return { path };
}

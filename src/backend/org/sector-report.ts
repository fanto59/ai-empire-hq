import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agents, budgets, businesses, modelUsage, organizations, projects, sectors, tasks } from "@/infrastructure/db/schema";
import { canAccessBusiness, type RequestContext } from "../auth/context";
import { monthStart } from "../budgets/spend-guard";

/**
 * SECTOR REPORTING - read models for the sector directory and each sector's
 * page, built only from stored records (businesses, agents, projects, tasks,
 * budgets, model_usage). Business-level access applies: a caller sees only
 * the businesses it may access; sector-wide figures (sector agents, sector
 * projects, the sector budget) need access to the WHOLE sector.
 */
const OPEN = ["queued", "assigned", "running", "waiting", "paused"] as const;

export interface BudgetView {
  limitMicros: number;
  spentMicros: number;
}

export interface SectorSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  businessCount: number;
  activeBusinesses: number;
  archivedBusinesses: number;
  agentCount: number;
  managerName: string | null;
  openTasks: number;
  spendMonthMicros: number;
  budget: BudgetView | null;
  /** True when the caller can see every business of the sector. */
  fullAccess: boolean;
}

function monthBounds(now: Date) {
  const start = monthStart(now);
  return { start, from: new Date(`${start}T00:00:00.000Z`) };
}

async function load(db: Db, ctx: RequestContext) {
  const [sectorRows, businessRows, agentRows] = await Promise.all([
    db.select().from(sectors).where(eq(sectors.organizationId, ctx.organizationId)).orderBy(asc(sectors.position), asc(sectors.name)),
    db.select().from(businesses).where(eq(businesses.organizationId, ctx.organizationId)).orderBy(asc(businesses.name)),
    db.select().from(agents).where(and(eq(agents.organizationId, ctx.organizationId), inArray(agents.status, ["active", "draft", "disabled"]))).orderBy(asc(agents.displayName)),
  ]);
  return { sectorRows, businessRows, agentRows };
}

const fullSectorAccess = (ctx: RequestContext, sectorBusinessIds: string[]) =>
  ctx.businesses === "*" || (sectorBusinessIds.length > 0 && sectorBusinessIds.every((id) => ctx.businesses.includes(id)));

export async function listSectorSummaries(db: Db, ctx: RequestContext, now = new Date()): Promise<SectorSummary[]> {
  const { sectorRows, businessRows, agentRows } = await load(db, ctx);
  const { start, from } = monthBounds(now);
  const visibleBiz = businessRows.filter((b) => canAccessBusiness(ctx, b.id));
  const bizIds = visibleBiz.map((b) => b.id);
  const [openRows, spendRows, budgetRows] = await Promise.all([
    bizIds.length
      ? db.select({ businessId: tasks.businessId, n: sql<number>`count(*)::int` }).from(tasks).where(and(inArray(tasks.businessId, bizIds), inArray(tasks.state, [...OPEN]))).groupBy(tasks.businessId)
      : [],
    bizIds.length
      ? db
          .select({ businessId: modelUsage.businessId, total: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint` })
          .from(modelUsage)
          .where(and(inArray(modelUsage.businessId, bizIds), gte(modelUsage.recordedAt, from)))
          .groupBy(modelUsage.businessId)
      : [],
    db.select().from(budgets).where(and(eq(budgets.organizationId, ctx.organizationId), eq(budgets.periodStart, start), isNull(budgets.businessId))),
  ]);
  return sectorRows
    .map((s) => {
      const all = businessRows.filter((b) => b.sectorId === s.id);
      const mine = visibleBiz.filter((b) => b.sectorId === s.id);
      const full = fullSectorAccess(ctx, all.map((b) => b.id));
      const ids = new Set(mine.map((b) => b.id));
      const sectorAgents = agentRows.filter((a) => a.sectorId === s.id || (a.businessId !== null && ids.has(a.businessId)));
      const budget = full ? budgetRows.find((b) => b.sectorId === s.id) : undefined;
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        businessCount: mine.length,
        activeBusinesses: mine.filter((b) => b.status === "active").length,
        archivedBusinesses: mine.filter((b) => b.status === "archived").length,
        agentCount: full ? sectorAgents.length : sectorAgents.filter((a) => a.businessId !== null).length,
        managerName: full ? (agentRows.find((a) => a.sectorId === s.id && a.role === "sector-manager")?.displayName ?? null) : null,
        openTasks: openRows.filter((r) => r.businessId && ids.has(r.businessId)).reduce((n, r) => n + r.n, 0),
        spendMonthMicros: spendRows.filter((r) => r.businessId && ids.has(r.businessId)).reduce((n, r) => n + Number(r.total), 0),
        budget: budget ? { limitMicros: budget.limitMicros, spentMicros: budget.spentMicros } : null,
        fullAccess: full,
      };
    })
    .filter((s) => s.fullAccess || s.businessCount > 0);
}

export interface BusinessReportRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  archivedAt: string | null;
  agents: { id: string; name: string; role: string }[];
  tasksByState: Record<string, number>;
  openTasks: number;
  spendMonthMicros: number;
  budget: BudgetView | null;
}

export interface SectorReport {
  organizationName: string;
  isTestData: boolean;
  sector: { id: string; slug: string; name: string; description: string };
  fullAccess: boolean;
  businesses: BusinessReportRow[];
  sectorAgents: { id: string; slug: string; name: string; role: string; status: string }[];
  projects: { id: string; title: string; status: string; scope: "business" | "sector"; businessName: string | null; ownerName: string | null; openTasks: number }[];
  /** Headquarters (cross-sector) projects with tasks in this sector's businesses. */
  crossSectorProjects: { id: string; title: string; status: string; tasksHere: number }[];
  /** Headquarters agents overseeing the whole organization. */
  oversight: { id: string; name: string; role: string }[];
  totals: { openTasks: number; completedTasks: number; failedTasks: number; spendMonthMicros: number };
  sectorBudget: BudgetView | null;
}

export async function getSectorReport(db: Db, ctx: RequestContext, slug: string, now = new Date()): Promise<SectorReport | null> {
  const { sectorRows, businessRows, agentRows } = await load(db, ctx);
  const sector = sectorRows.find((s) => s.slug === slug);
  if (!sector) return null;
  const all = businessRows.filter((b) => b.sectorId === sector.id);
  const visible = all.filter((b) => canAccessBusiness(ctx, b.id));
  const full = fullSectorAccess(ctx, all.map((b) => b.id));
  if (!full && visible.length === 0) return null; // no business-level access to this sector
  const ids = visible.map((b) => b.id);
  const { start, from } = monthBounds(now);

  const [[org], taskRows, spendRows, budgetRows, projectRows] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)),
    ids.length ? db.select({ id: tasks.id, businessId: tasks.businessId, projectId: tasks.projectId, state: tasks.state }).from(tasks).where(inArray(tasks.businessId, ids)) : [],
    ids.length
      ? db
          .select({ businessId: modelUsage.businessId, total: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint` })
          .from(modelUsage)
          .where(and(inArray(modelUsage.businessId, ids), gte(modelUsage.recordedAt, from)))
          .groupBy(modelUsage.businessId)
      : [],
    db.select().from(budgets).where(and(eq(budgets.organizationId, ctx.organizationId), eq(budgets.periodStart, start))),
    db.select().from(projects).where(eq(projects.organizationId, ctx.organizationId)),
  ]);

  const businessesOut: BusinessReportRow[] = visible.map((b) => {
    const mine = taskRows.filter((t) => t.businessId === b.id);
    const byState: Record<string, number> = {};
    for (const t of mine) byState[t.state] = (byState[t.state] ?? 0) + 1;
    const budget = budgetRows.find((r) => r.businessId === b.id);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description,
      status: b.status,
      archivedAt: b.archivedAt?.toISOString() ?? null,
      agents: agentRows.filter((a) => a.businessId === b.id).map((a) => ({ id: a.id, name: a.displayName, role: a.role })),
      tasksByState: byState,
      openTasks: mine.filter((t) => (OPEN as readonly string[]).includes(t.state)).length,
      spendMonthMicros: Number(spendRows.find((r) => r.businessId === b.id)?.total ?? 0),
      budget: budget ? { limitMicros: budget.limitMicros, spentMicros: budget.spentMicros } : null,
    };
  });

  const agentName = (id: string | null) => (id ? (agentRows.find((a) => a.id === id)?.displayName ?? null) : null);
  const projectsOut = projectRows
    .filter((p) => (p.businessId ? ids.includes(p.businessId) : full && p.sectorId === sector.id))
    .map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      scope: (p.businessId ? "business" : "sector") as "business" | "sector",
      businessName: p.businessId ? (visible.find((b) => b.id === p.businessId)?.name ?? null) : null,
      ownerName: agentName(p.ownerAgentId),
      openTasks: taskRows.filter((t) => t.projectId === p.id && (OPEN as readonly string[]).includes(t.state)).length,
    }));
  const crossSector = projectRows
    .filter((p) => !p.businessId && !p.sectorId)
    .map((p) => ({ id: p.id, title: p.title, status: p.status, tasksHere: taskRows.filter((t) => t.projectId === p.id).length }))
    .filter((p) => p.tasksHere > 0);
  const sb = full ? budgetRows.find((r) => r.sectorId === sector.id) : undefined;

  return {
    organizationName: org?.name ?? "",
    isTestData: org?.isTestData ?? false,
    sector: { id: sector.id, slug: sector.slug, name: sector.name, description: sector.description },
    fullAccess: full,
    businesses: businessesOut,
    sectorAgents: full ? agentRows.filter((a) => a.sectorId === sector.id).map((a) => ({ id: a.id, slug: a.slug, name: a.displayName, role: a.role, status: a.status })) : [],
    projects: projectsOut,
    crossSectorProjects: crossSector,
    oversight: agentRows.filter((a) => a.businessId === null && a.sectorId === null && a.status === "active").map((a) => ({ id: a.id, name: a.displayName, role: a.role })),
    totals: {
      openTasks: businessesOut.reduce((n, b) => n + b.openTasks, 0),
      completedTasks: taskRows.filter((t) => t.state === "completed").length,
      failedTasks: taskRows.filter((t) => t.state === "failed").length,
      spendMonthMicros: businessesOut.reduce((n, b) => n + b.spendMonthMicros, 0),
    },
    sectorBudget: sb ? { limitMicros: sb.limitMicros, spentMicros: sb.spentMicros } : null,
  };
}

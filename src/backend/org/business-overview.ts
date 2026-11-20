import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { profileCompleteness } from "@/domain/business-starter";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, budgets, businesses, departments, modelUsage, organizations, projects, sectors, tasks } from "@/infrastructure/db/schema";
import { canAccessBusiness, type RequestContext } from "../auth/context";
import { monthStart } from "../budgets/spend-guard";
import type { KnowledgeService } from "../knowledge";
import { resolveAgentModel } from "../models/assignment";
import { readBusinessProfile } from "./starter";

/**
 * Everything the business page shows, read from real records: the business,
 * its team (with each agent's model), departments, projects, recent tasks,
 * AI deliverables (draft notes), this month's budget and spend, and the
 * owner's profile. Business-level access applies (null if not visible).
 */
export async function getBusinessOverview(db: Db, knowledge: KnowledgeService, ctx: RequestContext, slug: string, now = new Date()) {
  const [row] = await db
    .select({ business: businesses, sectorName: sectors.name, sectorSlug: sectors.slug, isTestData: organizations.isTestData })
    .from(businesses)
    .innerJoin(organizations, eq(organizations.id, businesses.organizationId))
    .leftJoin(sectors, eq(sectors.id, businesses.sectorId))
    .where(and(eq(businesses.organizationId, ctx.organizationId), eq(businesses.slug, slug)));
  if (!row || !canAccessBusiness(ctx, row.business.id)) return null;
  const b = row.business;
  const period = monthStart(now);
  const from = new Date(`${period}T00:00:00Z`);

  const [team, depts, projs, recent, budget, spend, sectorTeam] = await Promise.all([
    db.select().from(agents).where(eq(agents.businessId, b.id)),
    db.select().from(departments).where(eq(departments.businessId, b.id)),
    db.select().from(projects).where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.businessId, b.id))),
    db.select().from(tasks).where(eq(tasks.businessId, b.id)).orderBy(desc(tasks.updatedAt)).limit(20),
    db.select().from(budgets).where(and(eq(budgets.organizationId, ctx.organizationId), eq(budgets.businessId, b.id), eq(budgets.periodStart, period))),
    db
      .select({ total: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint` })
      .from(modelUsage)
      .where(and(eq(modelUsage.businessId, b.id), gte(modelUsage.recordedAt, from))),
    b.sectorId ? db.select().from(agents).where(and(eq(agents.sectorId, b.sectorId), eq(agents.status, "active"))) : Promise.resolve([]),
  ]);
  const ids = [...team, ...sectorTeam].map((a) => a.id);
  const perms = ids.length ? await db.select({ agentId: agentPermissions.agentId, p: agentPermissions.permission }).from(agentPermissions).where(inArray(agentPermissions.agentId, ids)) : [];
  const permsOf = (id: string) => new Set(perms.filter((p) => p.agentId === id).map((p) => p.p));
  const describe = (a: typeof agents.$inferSelect) => {
    const m = resolveAgentModel(a, permsOf(a.id));
    return {
      id: a.id,
      slug: a.slug,
      name: a.displayName,
      role: a.role,
      status: a.status,
      department: depts.find((d) => d.id === a.departmentId)?.name ?? null,
      departmentSlug: depts.find((d) => d.id === a.departmentId)?.slug ?? null,
      model: m.info?.label ?? m.model,
      canWrite: permsOf(a.id).has("knowledge.write"),
      openTasks: 0,
    };
  };

  const profile = await readBusinessProfile(knowledge, ctx, b.slug);
  const { notes } = await knowledge.listNotes({ principal: { kind: "user", id: ctx.principal.id }, hq: false, businesses: [b.slug], write: false }, { business: b.slug, kind: "report" });
  const deliverables = notes
    .filter((n) => n.meta.tags.includes("agent-deliverable") || n.meta.tags.includes("agent-draft"))
    .slice(0, 20)
    .map((n) => ({ path: n.path, title: n.meta.title, status: n.meta.status, updated: n.meta.updated, agent: n.meta.agent, isDraft: n.meta.tags.includes("agent-draft") }));

  return {
    business: { id: b.id, slug: b.slug, name: b.name, status: b.status, description: b.description },
    sector: row.sectorSlug ? { slug: row.sectorSlug, name: row.sectorName ?? row.sectorSlug } : null,
    isTestData: row.isTestData,
    team: team.map(describe).sort((x, y) => (x.role === "business-lead" ? -1 : 0) - (y.role === "business-lead" ? -1 : 0) || x.name.localeCompare(y.name)),
    sectorTeam: sectorTeam.map(describe),
    departments: depts.map((d) => ({ id: d.id, slug: d.slug, name: d.name })),
    projects: projs.map((p) => ({ id: p.id, title: p.title, status: p.status, owner: team.find((a) => a.id === p.ownerAgentId)?.displayName ?? null })),
    tasks: recent.map((t) => ({ id: t.id, title: t.title, state: t.state, kind: t.kind, assignee: [...team, ...sectorTeam].find((a) => a.id === t.assigneeAgentId)?.displayName ?? null, updatedAt: t.updatedAt, result: t.resultSummary, error: t.lastError })),
    budget: budget[0] ? { limitMicros: budget[0].limitMicros, spentMicros: budget[0].spentMicros } : null,
    spendMonthMicros: Number(spend[0]?.total ?? 0),
    profile: profile ? { ...profile, ...profileCompleteness(profile.body) } : null,
    deliverables,
  };
}

export type BusinessOverview = NonNullable<Awaited<ReturnType<typeof getBusinessOverview>>>;

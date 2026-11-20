import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, approvalRequests, budgets, businesses, executionEvents, executionRuns, modelUsage, projects, sectors, tasks } from "@/infrastructure/db/schema";
import { monthStart } from "../budgets/spend-guard";
import { resolveAgentModel } from "../models/assignment";

/**
 * CONTROL CENTER READ MODELS - execution history, error report, approval
 * queue, agents and budgets. Built only from stored records.
 */
export async function runHistory(db: Db, organizationId: string, opts: { limit?: number; status?: string } = {}) {
  const rows = await db
    .select({
      run: executionRuns,
      taskTitle: tasks.title,
      taskKind: tasks.kind,
      taskState: tasks.state,
      agentName: agents.displayName,
      cost: sql<number>`(select coalesce(sum(${modelUsage.costMicros}), 0)::bigint from ${modelUsage} where ${modelUsage.runId} = ${executionRuns.id})`,
      model: sql<string | null>`(select ${modelUsage.model} from ${modelUsage} where ${modelUsage.runId} = ${executionRuns.id} order by ${modelUsage.recordedAt} desc limit 1)`,
    })
    .from(executionRuns)
    .innerJoin(tasks, eq(tasks.id, executionRuns.taskId))
    .leftJoin(agents, eq(agents.id, tasks.assigneeAgentId))
    .where(and(eq(tasks.organizationId, organizationId), opts.status ? sql`${executionRuns.status} = ${opts.status}` : undefined))
    .orderBy(desc(executionRuns.createdAt))
    .limit(Math.min(opts.limit ?? 40, 200));
  return rows.map((r) => ({
    runId: r.run.id,
    taskId: r.run.taskId,
    taskTitle: r.taskTitle,
    taskKind: r.taskKind,
    taskState: r.taskState,
    agentName: r.agentName,
    status: r.run.status,
    attempt: r.run.attempt,
    startedAt: r.run.startedAt?.toISOString() ?? null,
    finishedAt: r.run.finishedAt?.toISOString() ?? null,
    durationSeconds: r.run.startedAt && r.run.finishedAt ? Math.round((r.run.finishedAt.getTime() - r.run.startedAt.getTime()) / 1000) : null,
    costMicros: Number(r.cost),
    model: r.model,
    error: r.run.error,
  }));
}

/** Failures in the last `days`, grouped by error code (from run.failed events; reaper/person failures included). */
export async function errorReport(db: Db, organizationId: string, now = new Date(), days = 30) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({ payload: executionEvents.payload, at: executionEvents.occurredAt, taskId: executionEvents.taskId, agent: agents.displayName, title: tasks.title })
    .from(executionEvents)
    .innerJoin(tasks, eq(tasks.id, executionEvents.taskId))
    .leftJoin(agents, eq(agents.id, executionEvents.agentId))
    .where(and(eq(executionEvents.organizationId, organizationId), eq(executionEvents.type, "run.failed"), eq(executionEvents.origin, "live"), gte(executionEvents.occurredAt, since)))
    .orderBy(desc(executionEvents.occurredAt))
    .limit(500);
  const groups = new Map<string, { code: string; count: number; lastAt: string; lastMessage: string; lastTaskId: string; lastTaskTitle: string; agents: Set<string> }>();
  for (const r of rows) {
    const p = (r.payload ?? {}) as { errorCode?: string; message?: string };
    const code = String(p.errorCode ?? "FAILED").slice(0, 40);
    const g = groups.get(code) ?? { code, count: 0, lastAt: r.at.toISOString(), lastMessage: String(p.message ?? "").slice(0, 300), lastTaskId: r.taskId, lastTaskTitle: r.title, agents: new Set<string>() };
    g.count++;
    if (r.agent) g.agents.add(r.agent);
    groups.set(code, g);
  }
  return [...groups.values()].map((g) => ({ ...g, agents: [...g.agents] })).sort((a, b) => b.count - a.count);
}

export async function pendingTaskApprovals(db: Db, organizationId: string) {
  const rows = await db
    .select({ a: approvalRequests, title: tasks.title, taskId: tasks.id, business: businesses.name })
    .from(approvalRequests)
    .innerJoin(tasks, eq(tasks.id, approvalRequests.taskId))
    .leftJoin(businesses, eq(businesses.id, tasks.businessId))
    .where(and(eq(tasks.organizationId, organizationId), eq(approvalRequests.status, "pending")))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(50);
  return rows.map((r) => ({ id: r.a.id, taskId: r.taskId, taskTitle: r.title, business: r.business ?? "Headquarters", action: r.a.action, reason: r.a.reason, createdAt: r.a.createdAt.toISOString() }));
}

export async function agentsOverview(db: Db, organizationId: string) {
  const rows = await db
    .select({ a: agents, business: businesses.name, sector: sectors.name })
    .from(agents)
    .leftJoin(businesses, eq(businesses.id, agents.businessId))
    .leftJoin(sectors, eq(sectors.id, agents.sectorId))
    .where(and(eq(agents.organizationId, organizationId), inArray(agents.status, ["active", "disabled", "draft"])))
    .orderBy(agents.displayName);
  const open = await db
    .select({ agentId: tasks.assigneeAgentId, state: tasks.state })
    .from(tasks)
    .where(and(eq(tasks.organizationId, organizationId), inArray(tasks.state, ["queued", "assigned", "running", "waiting", "paused"])));
  const perms = rows.length
    ? await db.select({ agentId: agentPermissions.agentId, p: agentPermissions.permission }).from(agentPermissions).where(inArray(agentPermissions.agentId, rows.map((r) => r.a.id)))
    : [];
  return rows.map(({ a, business, sector }) => {
    const m = resolveAgentModel(a, new Set(perms.filter((p) => p.agentId === a.id).map((p) => p.p)));
    const mine = open.filter((t) => t.agentId === a.id);
    return {
      id: a.id,
      name: a.displayName,
      role: a.role,
      status: a.status,
      scope: business ?? (sector ? `${sector} sector` : "Headquarters"),
      provider: m.provider,
      model: m.model,
      running: mine.filter((t) => t.state === "running").length,
      open: mine.length,
    };
  });
}

export async function budgetsOverview(db: Db, organizationId: string, now = new Date()) {
  const period = monthStart(now);
  const rows = await db
    .select({ b: budgets, business: businesses.name, sector: sectors.name, agent: agents.displayName })
    .from(budgets)
    .leftJoin(businesses, eq(businesses.id, budgets.businessId))
    .leftJoin(sectors, eq(sectors.id, budgets.sectorId))
    .leftJoin(agents, eq(agents.id, budgets.agentId))
    .where(and(eq(budgets.organizationId, organizationId), eq(budgets.periodStart, period)));
  return rows
    .map(({ b, business, sector, agent }) => {
      const scope = b.businessId
        ? { kind: "business", id: b.businessId, label: business ?? "Business" }
        : b.sectorId
          ? { kind: "sector", id: b.sectorId, label: `${sector ?? "Sector"} (sector)` }
          : b.agentId
            ? { kind: "agent", id: b.agentId, label: `${agent ?? "Agent"} (agent)` }
            : b.provider
              ? { kind: "provider", id: b.provider, label: `${b.provider} (provider)` }
              : { kind: "organization", id: null, label: "Organization" };
      return { id: b.id, scope, limitMicros: b.limitMicros, spentMicros: b.spentMicros, exhausted: b.spentMicros >= b.limitMicros };
    })
    .sort((x, y) => (x.scope.kind === "organization" ? -1 : y.scope.kind === "organization" ? 1 : x.scope.label.localeCompare(y.scope.label)));
}

export async function projectsOverview(db: Db, organizationId: string) {
  const rows = await db
    .select({ p: projects, business: businesses.name, sector: sectors.name, owner: agents.displayName })
    .from(projects)
    .leftJoin(businesses, eq(businesses.id, projects.businessId))
    .leftJoin(sectors, eq(sectors.id, projects.sectorId))
    .leftJoin(agents, eq(agents.id, projects.ownerAgentId))
    .where(eq(projects.organizationId, organizationId))
    .orderBy(desc(projects.updatedAt))
    .limit(40);
  return rows.map(({ p, business, sector, owner }) => ({ id: p.id, title: p.title, status: p.status, scope: business ?? (sector ? `${sector} (sector)` : "Headquarters (cross-sector)"), owner }));
}

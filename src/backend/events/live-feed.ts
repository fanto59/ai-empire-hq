import { and, asc, desc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { LIVE_EVENT_TYPES, type LiveAgentInfo, type LiveEvent, type LiveHealth, type LiveRunHealth, type LiveSnapshot, type LiveTaskInfo } from "@/domain/live-office";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, executionEvents, executionRuns, knowledgeDocuments, modelUsage, tasks } from "@/infrastructure/db/schema";
import type { RequestContext } from "../auth/context";
import { resolveAgentModel } from "../models/assignment";

/**
 * LIVE FEED - reads for the authenticated office stream.
 *
 * Scoped to the caller's organization and businesses. Only stored events with
 * origin "live" are sent (never test or simulation events), and payloads are
 * reduced to a whitelist of display-safe fields.
 */
type EventRow = typeof executionEvents.$inferSelect;

const TYPES = new Set<string>(LIVE_EVENT_TYPES);
const PAYLOAD_FIELDS: Record<string, readonly string[]> = {
  "run.started": ["provider", "model", "trigger", "attempt"],
  "run.step": ["stepIndex", "summary"],
  "tool.called": ["toolCallId", "tool", "inputSummary"],
  "tool.result": ["toolCallId", "tool", "ok", "outputSummary"],
  "approval.requested": ["approvalId", "action", "reason"],
  "approval.resolved": ["approvalId", "decision", "by"],
  "run.completed": ["summary", "costMicros", "notePath", "modelCalls", "by"],
  "run.failed": ["errorCode", "message", "by"],
  "run.canceled": ["reason", "by"],
};

export function toLiveEvent(row: EventRow, businessId: string | null, origin: LiveEvent["origin"]): LiveEvent | null {
  if (!TYPES.has(row.type) || row.origin !== "live") return null;
  const src = (row.payload ?? {}) as Record<string, unknown>;
  const payload: LiveEvent["payload"] = {};
  for (const k of PAYLOAD_FIELDS[row.type] ?? []) {
    const v = src[k];
    if (typeof v === "string") payload[k] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) payload[k] = v;
  }
  return {
    streamId: row.streamId,
    id: row.id,
    type: row.type as LiveEvent["type"],
    origin,
    occurredAt: row.occurredAt.toISOString(),
    sequence: row.sequence,
    runId: row.runId,
    taskId: row.taskId,
    agentId: row.agentId,
    businessId,
    payload,
  };
}

/** Row filter: this organization, live events, businesses the caller may see. */
function visible(ctx: RequestContext): SQL {
  const parts: SQL[] = [eq(executionEvents.organizationId, ctx.organizationId), eq(executionEvents.origin, "live")];
  const biz: SQL[] = [];
  if (ctx.hq) biz.push(isNull(tasks.businessId));
  if (ctx.businesses === "*") biz.push(sql`${tasks.businessId} is not null`);
  else if (ctx.businesses.length > 0) biz.push(inArray(tasks.businessId, [...ctx.businesses]));
  parts.push(biz.length > 0 ? or(...biz)! : sql`false`);
  return and(...parts)!;
}

/** Events after a cursor (oldest first). `lookback` re-reads a small window to catch late commits. */
export async function readEventsAfter(db: Db, ctx: RequestContext, cursor: number, opts: { limit?: number; lookback?: number; origin?: LiveEvent["origin"] } = {}): Promise<LiveEvent[]> {
  const from = Math.max(0, cursor - (opts.lookback ?? 0));
  const rows = await db
    .select({ e: executionEvents, businessId: tasks.businessId })
    .from(executionEvents)
    .innerJoin(tasks, eq(tasks.id, executionEvents.taskId))
    .where(and(visible(ctx), gt(executionEvents.streamId, from)))
    .orderBy(asc(executionEvents.streamId))
    .limit(opts.limit ?? 200);
  return rows.map((r) => toLiveEvent(r.e, r.businessId, opts.origin ?? "live")).filter((e): e is LiveEvent => e !== null);
}

/** Highest stream cursor visible to the caller (0 when there are no events). */
export async function currentCursor(db: Db, ctx: RequestContext): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${executionEvents.streamId})` })
    .from(executionEvents)
    .innerJoin(tasks, eq(tasks.id, executionEvents.taskId))
    .where(visible(ctx));
  return Number(row?.max ?? 0);
}

async function visibleAgents(db: Db, ctx: RequestContext): Promise<LiveAgentInfo[]> {
  const rows = await db.select().from(agents).where(and(eq(agents.organizationId, ctx.organizationId), inArray(agents.status, ["active", "draft", "disabled"])));
  const seen = rows.filter((a) => (a.businessId === null ? ctx.hq : ctx.businesses === "*" || ctx.businesses.includes(a.businessId)));
  const perms = seen.length
    ? await db.select({ agentId: agentPermissions.agentId, p: agentPermissions.permission }).from(agentPermissions).where(inArray(agentPermissions.agentId, seen.map((a) => a.id)))
    : [];
  return seen.map((a) => {
    const m = resolveAgentModel(a, new Set(perms.filter((p) => p.agentId === a.id).map((p) => p.p)));
    return { id: a.id, slug: a.slug, name: a.displayName, role: a.role, businessId: a.businessId, workType: m.workType, provider: m.provider, model: m.model };
  });
}

export async function loadTaskInfos(db: Db, ctx: RequestContext, taskIds: string[]): Promise<LiveTaskInfo[]> {
  if (taskIds.length === 0) return [];
  const rows = await db.select().from(tasks).where(and(eq(tasks.organizationId, ctx.organizationId), inArray(tasks.id, taskIds)));
  const docs = await db.select({ taskId: knowledgeDocuments.taskId, path: knowledgeDocuments.vaultPath }).from(knowledgeDocuments).where(inArray(knowledgeDocuments.taskId, taskIds));
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    kind: t.kind,
    state: t.state,
    agentId: t.assigneeAgentId,
    lastError: t.lastError,
    resultSummary: t.resultSummary,
    notePath: docs.find((d) => d.taskId === t.id)?.path ?? null,
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function loadRunHealth(db: Db, ctx: RequestContext, runIds: string[], now: Date): Promise<LiveRunHealth[]> {
  // Plus every run that is still running for this organization (a new run may have started).
  const running = await db
    .select({ id: executionRuns.id })
    .from(executionRuns)
    .innerJoin(tasks, eq(tasks.id, executionRuns.taskId))
    .where(and(eq(tasks.organizationId, ctx.organizationId), eq(executionRuns.status, "running")));
  const ids = [...new Set([...runIds, ...running.map((r) => r.id)])];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ run: executionRuns, agentId: tasks.assigneeAgentId, businessId: tasks.businessId })
    .from(executionRuns)
    .innerJoin(tasks, eq(tasks.id, executionRuns.taskId))
    .where(and(eq(tasks.organizationId, ctx.organizationId), inArray(executionRuns.id, ids)));
  const costs = await db
    .select({ runId: modelUsage.runId, total: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint` })
    .from(modelUsage)
    .where(inArray(modelUsage.runId, ids))
    .groupBy(modelUsage.runId);
  return rows
    .filter((r) => (r.businessId === null ? ctx.hq : ctx.businesses === "*" || ctx.businesses.includes(r.businessId)))
    .map(({ run, agentId }) => ({
      runId: run.id,
      taskId: run.taskId,
      agentId,
      status: run.status,
      attempt: run.attempt,
      startedAt: run.startedAt?.toISOString() ?? null,
      heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
      leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
      stalled: run.status === "running" && ((run.leaseExpiresAt !== null && run.leaseExpiresAt < now) || (run.deadlineAt !== null && run.deadlineAt < now)),
      costMicros: Number(costs.find((c) => c.runId === run.id)?.total ?? 0),
    }));
}

/** The full current picture for a fresh connection (refresh) or a too-large reconnect gap. */
export async function loadSnapshot(db: Db, ctx: RequestContext, now = new Date()): Promise<LiveSnapshot> {
  const cursor = await currentCursor(db, ctx);
  const agentList = await visibleAgents(db, ctx);
  const events: LiveEvent[] = [];
  for (const a of agentList) {
    // The agent's most recent run with live events, replayed in order.
    const [latest] = await db
      .select({ runId: executionEvents.runId })
      .from(executionEvents)
      .innerJoin(tasks, eq(tasks.id, executionEvents.taskId))
      .where(and(visible(ctx), eq(executionEvents.agentId, a.id), sql`${executionEvents.streamId} <= ${cursor}`))
      .orderBy(desc(executionEvents.streamId))
      .limit(1);
    if (!latest) continue;
    const rows = await db
      .select({ e: executionEvents, businessId: tasks.businessId })
      .from(executionEvents)
      .innerJoin(tasks, eq(tasks.id, executionEvents.taskId))
      .where(and(visible(ctx), eq(executionEvents.runId, latest.runId), sql`${executionEvents.streamId} <= ${cursor}`))
      .orderBy(asc(executionEvents.sequence))
      .limit(200);
    for (const r of rows) {
      const ev = toLiveEvent(r.e, r.businessId, "replay");
      if (ev) events.push(ev);
    }
  }
  events.sort((x, y) => x.streamId - y.streamId);
  const taskIds = [...new Set(events.map((e) => e.taskId))];
  const runIds = [...new Set(events.map((e) => e.runId))];
  const [taskInfos, runs] = await Promise.all([loadTaskInfos(db, ctx, taskIds), loadRunHealth(db, ctx, runIds, now)]);
  // Running runs not yet in the event set (e.g. claimed seconds ago) need their task too.
  const missing = runs.map((r) => r.taskId).filter((id) => !taskIds.includes(id));
  return { cursor, serverTime: now.toISOString(), agents: agentList, events, tasks: [...taskInfos, ...(await loadTaskInfos(db, ctx, missing))], runs };
}

export async function loadHealth(db: Db, ctx: RequestContext, runIds: string[], taskIds: string[], now = new Date()): Promise<LiveHealth> {
  const runs = await loadRunHealth(db, ctx, runIds, now);
  const ids = [...new Set([...taskIds, ...runs.map((r) => r.taskId)])];
  return { serverTime: now.toISOString(), runs, tasks: await loadTaskInfos(db, ctx, ids) };
}

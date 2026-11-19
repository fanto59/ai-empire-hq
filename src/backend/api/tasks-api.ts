import type { Db } from "@/infrastructure/db/client";
import type { TaskState } from "@/domain/task-lifecycle";
import { authenticate } from "../auth/api-tokens";
import { ServiceError } from "../errors";
import type { RunRow, TaskRow } from "../tasks/engine";
import { TaskService, type CreateTaskInput, type TransitionRequest } from "../tasks/service";

/**
 * HTTP layer for the task API (framework-agnostic: Request in, Response out).
 * The Next.js route files are one-line adapters around these functions, so
 * the whole API is testable without a running server.
 *
 *   GET  /api/v1/tasks                      list (filters: state, businessId, projectId, assigneeAgentId, limit)
 *   POST /api/v1/tasks                      create (optional Idempotency-Key header)
 *   GET  /api/v1/tasks/:id                  detail incl. runs, approvals, history, availableActions
 *   POST /api/v1/tasks/:id/transitions      { action, agentId?, reason?, result?, error?, approval?, expectedVersion? }
 *   POST /api/v1/approvals/:id/decision     { decision: "approved" | "rejected", note? }  (people only)
 */
const MAX_BODY = 32 * 1024;

export interface ApiDeps {
  db: Db | null;
  now?: () => Date;
}

export const listTasks = (deps: ApiDeps, req: Request) =>
  handle(deps, req, async (svc, ctx) => {
    const q = new URL(req.url).searchParams;
    const businessId = q.get("businessId");
    const rows = await svc.listTasks(ctx, {
      state: (q.get("state") ?? undefined) as TaskState | undefined,
      businessId: businessId === null ? undefined : businessId === "hq" ? null : businessId,
      projectId: q.get("projectId") ?? undefined,
      assigneeAgentId: q.get("assigneeAgentId") ?? undefined,
      limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    });
    return json(200, { tasks: rows.map(taskDto) });
  });

export const createTask = (deps: ApiDeps, req: Request) =>
  handle(deps, req, async (svc, ctx) => {
    const body = (await readJson(req)) as CreateTaskInput;
    const key = req.headers.get("idempotency-key") ?? undefined;
    const { task, created } = await svc.createTask(ctx, body, key);
    return json(created ? 201 : 200, { task: taskDto(task), created });
  });

export const getTask = (deps: ApiDeps, req: Request, id: string) =>
  handle(deps, req, async (svc, ctx) => {
    const d = await svc.getTask(ctx, id);
    return json(200, {
      task: taskDto(d.task),
      assignee: d.assignee,
      dependencies: d.dependencies,
      runs: d.runs.map(runDto),
      approvals: d.approvals.map((a) => ({ id: a.id, action: a.action, reason: a.reason, status: a.status, decidedAt: iso(a.decidedAt), createdAt: iso(a.createdAt) })),
      history: d.history.map((h) => ({ action: h.action, actorKind: h.actorKind, actorId: h.actorId, occurredAt: iso(h.occurredAt), metadata: h.metadata })),
      availableActions: d.availableActions,
    });
  });

export const transitionTask = (deps: ApiDeps, req: Request, id: string) =>
  handle(deps, req, async (svc, ctx) => {
    const body = (await readJson(req)) as TransitionRequest;
    const task = await svc.transition(ctx, id, body);
    return json(200, { task: taskDto(task) });
  });

export const decideApproval = (deps: ApiDeps, req: Request, id: string) =>
  handle(deps, req, async (svc, ctx) => {
    const body = (await readJson(req)) as { decision: "approved" | "rejected"; note?: string };
    const task = await svc.decideApproval(ctx, id, body.decision, typeof body.note === "string" ? body.note : undefined);
    return json(200, { task: taskDto(task) });
  });

// ---- plumbing ---------------------------------------------------------------------

type Handler = (svc: TaskService, ctx: Awaited<ReturnType<typeof authenticate>>) => Promise<Response>;

async function handle(deps: ApiDeps, req: Request, fn: Handler): Promise<Response> {
  try {
    if (!deps.db) throw new ServiceError("unavailable", "The database is not configured.");
    const now = deps.now ?? (() => new Date());
    const ctx = await authenticate(deps.db, req.headers.get("authorization"), now());
    return await fn(new TaskService(deps.db, { now }), ctx);
  } catch (e) {
    if (e instanceof ServiceError) {
      const headers: Record<string, string> = e.code === "unauthenticated" ? { "WWW-Authenticate": 'Bearer realm="aehq"' } : {};
      return json(e.status, { error: { code: e.code, reason: e.reason, message: e.message } }, headers);
    }
    // Never leak internals (SQL, stack traces) to clients.
    console.error("[api] unexpected error", e instanceof Error ? e.message : e);
    return json(500, { error: { code: "internal", message: "Something went wrong." } });
  }
}

async function readJson(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new ServiceError("invalid-input", "Send a JSON body with Content-Type: application/json.");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new ServiceError("invalid-input", "Request body is too large.");
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ServiceError("invalid-input", "Request body must be a JSON object.");
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function taskDto(t: TaskRow) {
  return {
    id: t.id,
    businessId: t.businessId,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    state: t.state,
    priority: t.priority,
    assigneeAgentId: t.assigneeAgentId,
    requiresApproval: t.requiresApproval,
    attempt: t.attempt,
    maxAttempts: t.maxAttempts,
    timeoutSeconds: t.timeoutSeconds,
    version: t.version,
    waitingReason: t.waitingReason,
    lastError: t.lastError,
    resultSummary: t.resultSummary,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
    startedAt: iso(t.startedAt),
    finishedAt: iso(t.finishedAt),
  };
}

function runDto(r: RunRow) {
  return {
    id: r.id,
    attempt: r.attempt,
    status: r.status,
    workerId: r.workerId,
    error: r.error,
    createdAt: iso(r.createdAt),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    deadlineAt: iso(r.deadlineAt),
  };
}

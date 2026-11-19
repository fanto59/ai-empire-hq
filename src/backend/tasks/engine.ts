import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { planTransition, type TaskAction } from "@/domain/task-lifecycle";
import type { Executor } from "@/infrastructure/db/client";
import { agentPermissions, agents, approvalRequests, executionRuns, taskDependencies, tasks } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import { ServiceError } from "../errors";
import { appendEvent, hasTerminalEvent, latestRun } from "../execution/events";

/**
 * TRANSITION ENGINE - the only code that changes a task's state.
 *
 * Callers (TaskService for the API, ExecutionQueue for workers) must hold a
 * row lock on the task (SELECT ... FOR UPDATE) inside a transaction. The
 * engine validates the move with the pure state machine, enforces guards
 * that need the database, applies run/approval side effects, bumps the
 * optimistic-concurrency version and writes an audit entry - atomically.
 */
export type TaskRow = typeof tasks.$inferSelect;
export type RunRow = typeof executionRuns.$inferSelect;

export interface Actor {
  kind: "user" | "agent" | "system";
  id: string;
}

export interface TransitionInput {
  action: TaskAction;
  agentId?: string;
  reason?: string;
  result?: string;
  error?: string;
  /** For "wait": open a human approval request. */
  approval?: { action: string; reason: string };
  /** For "start" by a worker: the queued run it claimed. */
  claimedRunId?: string;
  workerId?: string;
  leaseMs?: number;
  /** For "fail" by the reaper. */
  runOutcome?: "failed" | "timed_out";
  /** For "fail": machine-readable code for the run.failed event (e.g. WORKER_LOST). */
  errorCode?: string;
  /**
   * Record lifecycle execution events (approval requested, run ended by the
   * system or a person). Default true; the test-data seed turns it off so no
   * execution activity is ever invented for seeded tasks.
   */
  recordEvents?: boolean;
  expectedVersion?: number;
}

const ACTIVE_RUN = ["queued", "running"] as const;

export async function applyTransition(tx: Executor, task: TaskRow, input: TransitionInput, actor: Actor, now: Date): Promise<TaskRow> {
  if (input.expectedVersion !== undefined && input.expectedVersion !== task.version) {
    throw new ServiceError("conflict", `Task changed since version ${input.expectedVersion} (now ${task.version}). Reload and retry.`, "version-mismatch");
  }
  const plan = planTransition(task, input.action);
  if (!plan.ok) throw new ServiceError("invalid-transition", plan.message, plan.code);

  const patch: Partial<TaskRow> = { state: plan.to, updatedAt: now };
  const meta: Record<string, string | number | boolean | null> = { from: plan.from, to: plan.to };

  switch (input.action) {
    case "assign": {
      const agentId = input.agentId;
      if (!agentId) throw new ServiceError("invalid-input", "agentId is required to assign a task.");
      await assertAssignable(tx, task, agentId);
      patch.assigneeAgentId = agentId;
      meta.agentId = agentId;
      break;
    }
    case "unassign":
      patch.assigneeAgentId = null;
      break;
    case "start": {
      await assertDependenciesComplete(tx, task.id);
      const attempt = task.attempt + 1;
      patch.attempt = attempt;
      patch.startedAt = task.startedAt ?? now;
      patch.finishedAt = null;
      patch.lastError = null;
      const run = await beginRun(tx, task, attempt, input, now);
      meta.runId = run.id;
      meta.attempt = attempt;
      break;
    }
    case "wait": {
      const run = await activeRun(tx, task.id);
      await endActiveRuns(tx, task.id, "suspended", now);
      patch.waitingReason = clip(input.reason ?? input.approval?.reason ?? "Waiting", 500);
      if (input.approval) {
        const [approval] = await tx
          .insert(approvalRequests)
          .values({
            taskId: task.id,
            businessId: task.businessId,
            requestedByAgentId: task.assigneeAgentId,
            action: clip(input.approval.action, 200),
            reason: clip(input.approval.reason, 1000),
          })
          .returning({ id: approvalRequests.id });
        meta.approvalId = approval!.id;
        if (input.recordEvents !== false) {
          await lifecycleEvent(tx, task, run, now, "approval.requested", {
            approvalId: approval!.id,
            action: clip(input.approval.action, 200),
            reason: clip(input.approval.reason, 300),
          });
        }
      }
      break;
    }
    case "resume": {
      if (plan.from === "waiting") {
        const pending = await tx
          .select({ id: approvalRequests.id })
          .from(approvalRequests)
          .where(and(eq(approvalRequests.taskId, task.id), eq(approvalRequests.status, "pending")));
        if (pending.length > 0) throw new ServiceError("conflict", "An approval request is still pending.", "approval-pending");
        const run = await beginRun(tx, task, task.attempt, input, now);
        meta.runId = run.id;
      }
      patch.waitingReason = null;
      break;
    }
    case "pause":
      await endActiveRuns(tx, task.id, "suspended", now);
      break;
    case "complete": {
      if (task.requiresApproval) {
        const approved = await tx
          .select({ id: approvalRequests.id })
          .from(approvalRequests)
          .where(and(eq(approvalRequests.taskId, task.id), eq(approvalRequests.status, "approved")));
        if (approved.length === 0) throw new ServiceError("conflict", "This task needs an approved approval request before it can complete.", "approval-required");
      }
      const run = (await activeRun(tx, task.id)) ?? (await latestRun(tx, task.id));
      await endActiveRuns(tx, task.id, "succeeded", now);
      patch.resultSummary = clip(input.result ?? "", 2000) || null;
      if (input.recordEvents !== false) {
        await lifecycleEvent(tx, task, run, now, "run.completed", { summary: clip(input.result ?? "Completed.", 300), usage: null, by: actor.kind }, { onlyIfNoTerminal: true });
      }
      patch.finishedAt = now;
      patch.waitingReason = null;
      break;
    }
    case "fail": {
      const error = clip(input.error ?? "Task failed.", 2000);
      const run = (await activeRun(tx, task.id)) ?? (await latestRun(tx, task.id));
      await endActiveRuns(tx, task.id, input.runOutcome ?? "failed", now, error);
      if (input.recordEvents !== false) {
        await lifecycleEvent(
          tx,
          task,
          run,
          now,
          "run.failed",
          { errorCode: clip(input.errorCode ?? (input.runOutcome === "timed_out" ? "TIMED_OUT" : "FAILED"), 40), message: clip(error, 300), by: actor.kind },
          { onlyIfNoTerminal: true },
        );
      }
      await expirePendingApprovals(tx, task.id, now);
      patch.lastError = error;
      patch.finishedAt = now;
      patch.waitingReason = null;
      meta.error = clip(error, 200);
      break;
    }
    case "retry":
      patch.finishedAt = null;
      break;
    case "cancel": {
      const run = (await activeRun(tx, task.id)) ?? (await latestRun(tx, task.id));
      if (input.recordEvents !== false) {
        await lifecycleEvent(tx, task, run, now, "run.canceled", { reason: clip(input.reason ?? "Canceled.", 300), by: actor.kind }, { onlyIfNoTerminal: true });
      }
      await endActiveRuns(tx, task.id, "canceled", now);
      await expirePendingApprovals(tx, task.id, now);
      patch.finishedAt = now;
      patch.waitingReason = null;
      break;
    }
  }
  if (input.reason) meta.reason = clip(input.reason, 200);

  const [updated] = await tx
    .update(tasks)
    .set({ ...patch, version: task.version + 1 })
    .where(and(eq(tasks.id, task.id), eq(tasks.version, task.version)))
    .returning();
  if (!updated) throw new ServiceError("conflict", "Task was modified concurrently. Reload and retry.", "version-mismatch");

  await writeAudit(tx, {
    organizationId: task.organizationId,
    businessId: task.businessId,
    actor,
    action: `task.${input.action}`,
    targetType: "task",
    targetId: task.id,
    metadata: meta,
    at: now,
  });
  return updated;
}

async function assertAssignable(tx: Executor, task: TaskRow, agentId: string) {
  const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
  if (!agent || agent.organizationId !== task.organizationId) throw new ServiceError("invalid-input", "Agent not found.");
  if (agent.status !== "active") throw new ServiceError("conflict", `Agent ${agent.slug} is ${agent.status}, not active.`, "agent-inactive");
  if (agent.businessId !== task.businessId) {
    throw new ServiceError("forbidden", "Agents can only take tasks from their own business (or headquarters agents from headquarters).", "business-mismatch");
  }
  const grant = await tx
    .select({ id: agentPermissions.id })
    .from(agentPermissions)
    .where(
      and(
        eq(agentPermissions.agentId, agentId),
        eq(agentPermissions.permission, "task.execute"),
        task.businessId === null
          ? isNull(agentPermissions.businessId)
          : or(isNull(agentPermissions.businessId), eq(agentPermissions.businessId, task.businessId)),
      ),
    );
  if (grant.length === 0) throw new ServiceError("forbidden", "Agent lacks the task.execute permission for this scope.", "permission-missing");
}

async function assertDependenciesComplete(tx: Executor, taskId: string) {
  const open = await tx
    .select({ id: tasks.id, title: tasks.title })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(and(eq(taskDependencies.taskId, taskId), ne(tasks.state, "completed")));
  if (open.length > 0) {
    throw new ServiceError("conflict", `Waiting on ${open.length} unfinished dependenc${open.length === 1 ? "y" : "ies"}.`, "dependencies-incomplete");
  }
}

/** Starts a run: reuses the run a worker claimed, or creates a new one. */
async function beginRun(tx: Executor, task: TaskRow, attempt: number, input: TransitionInput, now: Date): Promise<RunRow> {
  const deadlineAt = new Date(now.getTime() + task.timeoutSeconds * 1000);
  const leaseExpiresAt = input.leaseMs ? new Date(now.getTime() + input.leaseMs) : null;
  if (input.claimedRunId) {
    const [run] = await tx
      .update(executionRuns)
      .set({ status: "running", attempt, workerId: input.workerId ?? null, startedAt: now, heartbeatAt: now, leaseExpiresAt, deadlineAt })
      .where(and(eq(executionRuns.id, input.claimedRunId), eq(executionRuns.status, "queued")))
      .returning();
    if (!run) throw new ServiceError("conflict", "Run is no longer claimable.", "run-not-queued");
    return run;
  }
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(executionRuns)
    .where(eq(executionRuns.taskId, task.id))) as [{ n: number }];
  try {
    const [run] = await tx
      .insert(executionRuns)
      .values({
        taskId: task.id,
        attempt,
        status: "running",
        idempotencyKey: `${task.id}:${attempt}:${n + 1}`,
        workerId: input.workerId ?? null,
        startedAt: now,
        heartbeatAt: now,
        leaseExpiresAt,
        deadlineAt,
        availableAt: now,
      })
      .returning();
    return run!;
  } catch {
    throw new ServiceError("conflict", "This task already has an active run.", "duplicate-run");
  }
}

async function endActiveRuns(tx: Executor, taskId: string, outcome: RunRow["status"], now: Date, error?: string) {
  await tx
    .update(executionRuns)
    .set({ status: outcome, finishedAt: now, leaseExpiresAt: null, error: error ?? null })
    .where(and(eq(executionRuns.taskId, taskId), eq(executionRuns.status, "running")));
  await tx
    .update(executionRuns)
    .set({ status: "canceled", finishedAt: now })
    .where(and(eq(executionRuns.taskId, taskId), inArray(executionRuns.status, [...ACTIVE_RUN])));
}

/** The task's running run, if any. */
async function activeRun(tx: Executor, taskId: string): Promise<RunRow | undefined> {
  const [run] = await tx.select().from(executionRuns).where(and(eq(executionRuns.taskId, taskId), eq(executionRuns.status, "running")));
  return run;
}

/**
 * Records a real lifecycle event on the task's run. No run = nothing was ever
 * executed, so nothing is recorded. With onlyIfNoTerminal, an event the
 * worker already reported (run.completed / run.failed) is not duplicated.
 */
async function lifecycleEvent(
  tx: Executor,
  task: TaskRow,
  run: RunRow | undefined,
  now: Date,
  type: string,
  payload: Record<string, unknown>,
  opts: { onlyIfNoTerminal?: boolean } = {},
): Promise<void> {
  if (!run) return;
  if (opts.onlyIfNoTerminal && (await hasTerminalEvent(tx, run.id))) return;
  await appendEvent(tx, { run, task, type, payload, origin: "live", at: now });
}

async function expirePendingApprovals(tx: Executor, taskId: string, now: Date) {
  await tx
    .update(approvalRequests)
    .set({ status: "expired", decidedAt: now, decidedBy: "system" })
    .where(and(eq(approvalRequests.taskId, taskId), eq(approvalRequests.status, "pending")));
}

function clip(s: string, max: number): string {
  return s.replace(/\0/g, "").trim().slice(0, max);
}

export async function lockTask(tx: Executor, taskId: string): Promise<TaskRow | undefined> {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
  return row;
}

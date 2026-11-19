import { and, asc, eq, gt, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { retryDelayMs } from "@/domain/task-lifecycle";
import type { Db, Executor } from "@/infrastructure/db/client";
import { executionEvents, executionRuns, taskDependencies, tasks } from "@/infrastructure/db/schema";
import { ServiceError } from "../errors";
import { applyTransition, lockTask, type Actor, type RunRow, type TaskRow } from "../tasks/engine";

/**
 * DURABLE EXECUTION QUEUE (PostgreSQL-backed)
 *
 * The queue is the execution_runs table; there is no separate broker.
 *
 *   enqueue ─▶ run(queued, available_at)
 *   claim   ─▶ SELECT … FOR UPDATE SKIP LOCKED  → run(running, lease, deadline), task → running
 *   heartbeat ─▶ extends the lease while the worker is alive
 *   complete / fail ─▶ only the lease holder may finish the run
 *   reap    ─▶ runs whose lease expired (worker died) or deadline passed
 *              (timeout) become timed_out and are retried with backoff
 *
 * Duplicate-job prevention, enforced by the database:
 *   - partial unique index: at most one queued/running run per task
 *   - unique idempotency_key per run segment
 *   - SKIP LOCKED so two workers never claim the same run
 *   - every finish checks the worker still holds an unexpired lease
 *
 * Retries: a failed or timed-out attempt is retried automatically while
 * attempts remain (exponential backoff via available_at); then the task
 * becomes failed. Non-retryable failures fail the task immediately.
 *
 * Nothing in the app starts a worker: real agent execution stays disabled
 * (AGENT_EXECUTION_ENABLED=false). Tests drive the queue directly.
 */
export interface QueueOptions {
  now?: () => Date;
  leaseMs?: number;
  backoffBaseMs?: number;
}

export interface ClaimedRun {
  run: RunRow;
  task: TaskRow;
}

const SYSTEM: Actor = { kind: "system", id: "execution-queue" };

export class ExecutionQueue {
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly backoffBaseMs: number;

  constructor(db: Db, options: QueueOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 60_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 30_000;
  }

  /** Queues the next attempt of an assigned task. Idempotent. */
  async enqueue(taskId: string): Promise<{ run: RunRow; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const task = await lockTask(tx, taskId);
      if (!task) throw new ServiceError("not-found", "Task not found.");
      if (task.state !== "assigned") throw new ServiceError("invalid-transition", `Only assigned tasks can be queued for execution (task is ${task.state}).`);
      if (task.attempt >= task.maxAttempts) throw new ServiceError("invalid-transition", "No attempts remain.", "attempts-exhausted");
      return this.insertQueuedRun(tx, task, this.now());
    });
  }

  /** Queues every assigned task that has no active run and whose dependencies are done. */
  async enqueueReady(options: { organizationId?: string; limit?: number; kinds?: readonly ("general" | "research")[] } = {}): Promise<number> {
    const candidates = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.state, "assigned"),
          options.organizationId ? eq(tasks.organizationId, options.organizationId) : undefined,
          options.kinds ? inArray(tasks.kind, [...options.kinds]) : undefined,
          lt(tasks.attempt, tasks.maxAttempts),
          sql`not exists (select 1 from ${executionRuns} r where r.task_id = ${tasks.id} and r.status in ('queued','running'))`,
          sql`not exists (select 1 from ${taskDependencies} d join ${tasks} dt on dt.id = d.depends_on_task_id where d.task_id = ${tasks.id} and dt.state <> 'completed')`,
        ),
      )
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 500));
    let created = 0;
    for (const c of candidates) {
      try {
        if ((await this.enqueue(c.id)).created) created++;
      } catch {
        // Raced with another scheduler or the task moved on: skip.
      }
    }
    return created;
  }

  /**
   * Claims the oldest available run. `kinds` restricts which task kinds this
   * worker can execute (e.g. a research worker only claims research tasks).
   */
  async claim(workerId: string, options: { kinds?: readonly ("general" | "research")[] } = {}): Promise<ClaimedRun | null> {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(workerId)) throw new ServiceError("invalid-input", "Invalid worker id.");
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(executionRuns)
        .where(
          and(
            eq(executionRuns.status, "queued"),
            lte(executionRuns.availableAt, now),
            options.kinds
              ? sql`exists (select 1 from ${tasks} t where t.id = ${executionRuns.taskId} and t.kind in (${sql.join(
                  options.kinds.map((k) => sql`${k}`),
                  sql`, `,
                )}))`
              : undefined,
          ),
        )
        .orderBy(asc(executionRuns.availableAt), asc(executionRuns.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!run) return null;
      const task = await lockTask(tx, run.taskId);
      if (!task || task.state !== "assigned") {
        // The task moved on (paused, canceled, ...) after this run was queued.
        await tx.update(executionRuns).set({ status: "canceled", finishedAt: now }).where(eq(executionRuns.id, run.id));
        return null;
      }
      const started = await applyTransition(tx, task, { action: "start", claimedRunId: run.id, workerId, leaseMs: this.leaseMs }, SYSTEM, now);
      const [claimed] = await tx.select().from(executionRuns).where(eq(executionRuns.id, run.id));
      return { run: claimed!, task: started };
    });
  }

  /** Extends the lease. Returns false if the worker no longer owns the run: it must stop. */
  async heartbeat(runId: string, workerId: string): Promise<boolean> {
    const now = this.now();
    const rows = await this.db
      .update(executionRuns)
      .set({ heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + this.leaseMs) })
      .where(
        and(
          eq(executionRuns.id, runId),
          eq(executionRuns.workerId, workerId),
          eq(executionRuns.status, "running"),
          gt(executionRuns.leaseExpiresAt, now),
          gt(executionRuns.deadlineAt, now),
        ),
      )
      .returning({ id: executionRuns.id });
    return rows.length === 1;
  }

  async complete(runId: string, workerId: string, result: string): Promise<TaskRow> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const { task } = await this.ownedRun(tx, runId, workerId, now);
      return applyTransition(tx, task, { action: "complete", result }, SYSTEM, now);
    });
  }

  async fail(runId: string, workerId: string, error: string, options: { retryable?: boolean } = {}): Promise<TaskRow> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const { task } = await this.ownedRun(tx, runId, workerId, now);
      return this.failAndMaybeRetry(tx, task, error, "failed", options.retryable ?? true, now);
    });
  }

  /** Times out runs whose worker vanished (lease expired) or that overran their deadline. */
  async reapExpired(): Promise<number> {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const expired = await tx
        .select()
        .from(executionRuns)
        .where(
          and(
            eq(executionRuns.status, "running"),
            or(and(isNotNull(executionRuns.leaseExpiresAt), lt(executionRuns.leaseExpiresAt, now)), lt(executionRuns.deadlineAt, now)),
          ),
        )
        .for("update", { skipLocked: true });
      for (const run of expired) {
        const task = await lockTask(tx, run.taskId);
        if (!task || task.state !== "running") continue;
        const reason = run.deadlineAt && run.deadlineAt < now ? "Run exceeded its timeout." : "Worker stopped sending heartbeats (lease expired).";
        await this.failAndMaybeRetry(tx, task, reason, "timed_out", true, now);
      }
      return expired.length;
    });
  }

  /** Appends an execution event to a run the worker owns (sequence is gap-free per run). */
  async recordEvent(runId: string, workerId: string, type: string, payload: Record<string, unknown>, origin: "live" | "test" = "live") {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const { run } = await this.ownedRun(tx, runId, workerId, now);
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${executionEvents.sequence}), -1)::int + 1` })
        .from(executionEvents)
        .where(eq(executionEvents.runId, run.id))) as [{ next: number }];
      const [event] = await tx
        .insert(executionEvents)
        .values({ runId: run.id, taskId: run.taskId, sequence: next, type: type.slice(0, 64), origin, payload, occurredAt: now })
        .returning();
      return event!;
    });
  }

  // ---- internals ------------------------------------------------------------

  private async ownedRun(tx: Executor, runId: string, workerId: string, now: Date) {
    const [run] = await tx.select().from(executionRuns).where(eq(executionRuns.id, runId)).for("update");
    const leaseValid = run && (run.leaseExpiresAt === null || run.leaseExpiresAt > now);
    if (!run || run.status !== "running" || run.workerId !== workerId || !leaseValid) {
      throw new ServiceError("conflict", "This worker no longer holds the run (lease lost, finished, or reassigned).", "lease-lost");
    }
    const task = await lockTask(tx, run.taskId);
    if (!task) throw new ServiceError("not-found", "Task not found.");
    return { run, task };
  }

  private async failAndMaybeRetry(tx: Executor, task: TaskRow, error: string, outcome: "failed" | "timed_out", retryable: boolean, now: Date) {
    const failed = await applyTransition(tx, task, { action: "fail", error, runOutcome: outcome }, SYSTEM, now);
    if (!retryable || failed.attempt >= failed.maxAttempts) return failed;
    const retried = await applyTransition(tx, failed, { action: "retry", reason: "automatic retry" }, SYSTEM, now);
    if (retried.state === "assigned") {
      await this.insertQueuedRun(tx, retried, new Date(now.getTime() + retryDelayMs(failed.attempt, this.backoffBaseMs)), now);
    }
    return retried;
  }

  private async insertQueuedRun(tx: Executor, task: TaskRow, availableAt: Date, now: Date = availableAt) {
    const attempt = task.attempt + 1;
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(executionRuns)
      .where(eq(executionRuns.taskId, task.id))) as [{ n: number }];
    const [run] = await tx
      .insert(executionRuns)
      .values({ taskId: task.id, attempt, status: "queued", idempotencyKey: `${task.id}:${attempt}:${n + 1}`, availableAt, createdAt: now })
      .onConflictDoNothing()
      .returning();
    if (run) return { run, created: true };
    const [existing] = await tx
      .select()
      .from(executionRuns)
      .where(and(eq(executionRuns.taskId, task.id), inArray(executionRuns.status, ["queued", "running"])));
    if (!existing) throw new ServiceError("conflict", "Could not queue the run.");
    return { run: existing, created: false };
  }
}

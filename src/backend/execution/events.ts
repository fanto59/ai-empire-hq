import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/infrastructure/db/client";
import { executionEvents, executionRuns, tasks } from "@/infrastructure/db/schema";

/**
 * EXECUTION EVENT LOG - the one place events are written.
 *
 * Every event stores its id, global stream cursor, organization, agent, task,
 * run, per-run sequence and timestamp. Writers:
 * - workers (via ExecutionQueue.recordEvent) for real agent activity:
 *   run.started, run.step, tool.called, tool.result, run.completed, run.failed;
 * - the task engine for real lifecycle changes that happen outside a worker:
 *   approval requested/resolved, a run ended by the system (worker lost,
 *   timeout, a person completing/failing/canceling a task).
 * Nothing here invents activity: every event corresponds to a database change.
 */
export type EventRow = typeof executionEvents.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type RunRow = typeof executionRuns.$inferSelect;

export const TERMINAL_EVENT_TYPES = ["run.completed", "run.failed", "run.canceled"] as const;

export async function appendEvent(
  tx: Executor,
  input: { run: Pick<RunRow, "id">; task: Pick<TaskRow, "id" | "organizationId" | "assigneeAgentId">; type: string; payload: Record<string, unknown>; origin: "live" | "test"; at: Date },
): Promise<EventRow> {
  const [{ next }] = (await tx
    .select({ next: sql<number>`coalesce(max(${executionEvents.sequence}), -1)::int + 1` })
    .from(executionEvents)
    .where(eq(executionEvents.runId, input.run.id))) as [{ next: number }];
  const [event] = await tx
    .insert(executionEvents)
    .values({
      organizationId: input.task.organizationId,
      agentId: input.task.assigneeAgentId,
      runId: input.run.id,
      taskId: input.task.id,
      sequence: next,
      type: input.type.slice(0, 64),
      origin: input.origin,
      payload: input.payload,
      occurredAt: input.at,
    })
    .returning();
  return event!;
}

/** The task's most recent run (any status), or undefined. */
export async function latestRun(tx: Executor, taskId: string): Promise<RunRow | undefined> {
  const [run] = await tx.select().from(executionRuns).where(eq(executionRuns.taskId, taskId)).orderBy(desc(executionRuns.createdAt), desc(executionRuns.attempt)).limit(1);
  return run;
}

/** True when the run already has a completed/failed/canceled event. */
export async function hasTerminalEvent(tx: Executor, runId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: executionEvents.id })
    .from(executionEvents)
    .where(and(eq(executionEvents.runId, runId), inArray(executionEvents.type, [...TERMINAL_EVENT_TYPES])))
    .limit(1);
  return rows.length > 0;
}

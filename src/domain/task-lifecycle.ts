/**
 * TASK STATE MACHINE (pure, framework-free).
 *
 *                 assign              start
 *   ┌────────┐ ─────────▶ ┌──────────┐ ─────▶ ┌─────────┐ ── complete ──▶ completed
 *   │ queued │ ◀───────── │ assigned │        │ running │ ── fail ──────▶ failed ── retry ─▶ assigned/queued
 *   └────────┘  unassign  └──────────┘        └─────────┘ ── wait ─▶ waiting ── resume ─▶ running
 *        │ pause / cancel       │ pause / cancel     │ pause                │ pause / fail / cancel
 *        ▼                      ▼                    ▼                      ▼
 *      paused ── resume ─▶ assigned (if assignee) or queued        canceled (terminal)
 *
 * completed and canceled are terminal. failed is terminal unless `retry` is
 * allowed (attempts remaining).
 */
export const TASK_STATES = ["queued", "assigned", "running", "waiting", "paused", "completed", "failed", "canceled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_ACTIONS = ["assign", "unassign", "start", "wait", "resume", "pause", "complete", "fail", "retry", "cancel"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const TERMINAL_STATES: readonly TaskState[] = ["completed", "canceled"];

/** States in which an execution run may be active. */
export const ACTIVE_STATES: readonly TaskState[] = ["running"];

export interface TaskLifecycleView {
  state: TaskState;
  assigneeAgentId: string | null;
  attempt: number;
  maxAttempts: number;
}

const FROM: Record<TaskAction, readonly TaskState[]> = {
  assign: ["queued", "assigned"],
  unassign: ["assigned"],
  start: ["assigned"],
  wait: ["running"],
  resume: ["waiting", "paused"],
  pause: ["queued", "assigned", "running", "waiting"],
  complete: ["running"],
  fail: ["running", "waiting"],
  retry: ["failed"],
  cancel: ["queued", "assigned", "running", "waiting", "paused"],
};

export type TransitionPlan =
  | { ok: true; from: TaskState; to: TaskState }
  | { ok: false; code: "invalid-transition" | "no-assignee" | "attempts-exhausted"; message: string };

export function planTransition(task: TaskLifecycleView, action: TaskAction): TransitionPlan {
  const from = task.state;
  if (!FROM[action].includes(from)) {
    return { ok: false, code: "invalid-transition", message: `Cannot ${action} a task that is ${from}.` };
  }
  switch (action) {
    case "assign":
      return { ok: true, from, to: "assigned" };
    case "unassign":
      return { ok: true, from, to: "queued" };
    case "start":
      if (!task.assigneeAgentId) return { ok: false, code: "no-assignee", message: "Assign the task before starting it." };
      if (task.attempt >= task.maxAttempts) {
        return { ok: false, code: "attempts-exhausted", message: `All ${task.maxAttempts} attempts have been used.` };
      }
      return { ok: true, from, to: "running" };
    case "wait":
      return { ok: true, from, to: "waiting" };
    case "resume":
      if (from === "waiting") return { ok: true, from, to: "running" };
      return { ok: true, from, to: task.assigneeAgentId ? "assigned" : "queued" };
    case "pause":
      return { ok: true, from, to: "paused" };
    case "complete":
      return { ok: true, from, to: "completed" };
    case "fail":
      return { ok: true, from, to: "failed" };
    case "retry":
      if (task.attempt >= task.maxAttempts) {
        return { ok: false, code: "attempts-exhausted", message: `All ${task.maxAttempts} attempts have been used.` };
      }
      return { ok: true, from, to: task.assigneeAgentId ? "assigned" : "queued" };
    case "cancel":
      return { ok: true, from, to: "canceled" };
  }
}

/** Actions currently available for a task (for UIs and API hints). */
export function availableActions(task: TaskLifecycleView): TaskAction[] {
  return TASK_ACTIONS.filter((a) => planTransition(task, a).ok);
}

export function isTerminal(task: TaskLifecycleView): boolean {
  return TERMINAL_STATES.includes(task.state) || (task.state === "failed" && task.attempt >= task.maxAttempts);
}

/** Exponential backoff for automatic retries: 30s, 60s, 120s ... capped at 30 min. */
export function retryDelayMs(attempt: number, baseMs = 30_000, capMs = 30 * 60_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

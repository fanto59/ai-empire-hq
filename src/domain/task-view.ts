import type { TaskState } from "./task-lifecycle";

/**
 * Read model of a task for UIs (plain, serializable). Produced on the server
 * from database rows; the frontend never builds task lists itself.
 */
export interface TaskSummaryView {
  id: string;
  title: string;
  state: TaskState;
  priority: number;
  businessName: string | null;
  projectTitle: string | null;
  assigneeSlug: string | null;
  assigneeName: string | null;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
}

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  queued: "Queued",
  assigned: "Assigned",
  running: "Running",
  waiting: "Waiting",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

/** Project board columns (left to right). Canceled tasks are not shown. */
export const BOARD_COLUMNS: readonly { key: string; label: string; states: readonly TaskState[] }[] = [
  { key: "queued", label: "Queued", states: ["queued"] },
  { key: "active", label: "Active", states: ["assigned", "running"] },
  { key: "waiting", label: "Waiting", states: ["waiting", "paused"] },
  { key: "done", label: "Done", states: ["completed"] },
  { key: "failed", label: "Failed", states: ["failed"] },
];

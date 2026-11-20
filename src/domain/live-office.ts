/**
 * LIVE OFFICE WIRE FORMAT - what the authenticated event stream sends to the
 * browser. Framework-free; shared by the server (src/backend/events) and the
 * client (src/frontend/office/live).
 *
 * Every LiveEvent is a stored execution event (id, stream cursor, agent,
 * task, run, timestamp). The browser animates ONLY from these and from the
 * stored task/run state; it never invents activity.
 */
export const LIVE_EVENT_TYPES = [
  "run.started",
  "run.step",
  "tool.called",
  "tool.result",
  "approval.requested",
  "approval.resolved",
  "run.completed",
  "run.failed",
  "run.canceled",
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface LiveEvent {
  /** Global cursor (SSE event id); strictly increasing per insert. */
  streamId: number;
  id: string;
  type: LiveEventType;
  /** "live" = streamed as it happened; "replay" = re-sent after a refresh or reconnect. */
  origin: "live" | "replay";
  occurredAt: string;
  /** Per-run sequence (gap-free). */
  sequence: number;
  runId: string;
  /** When the run was created: orders runs, so a late event of an older run never replaces a newer one. */
  runCreatedAt: string;
  taskId: string;
  agentId: string | null;
  businessId: string | null;
  /** Whitelisted, display-safe fields only. */
  payload: Record<string, string | number | boolean | null>;
}

export interface LiveAgentInfo {
  id: string;
  slug: string;
  name: string;
  role: string;
  businessId: string | null;
  /** Sector-level agents (sector managers / specialists); null otherwise. */
  sectorId: string | null;
  /** engineering | strategy | research - decides the agent's workstation on the floor. */
  workType: string;
  provider: string;
  model: string;
}

export interface LiveTaskInfo {
  id: string;
  title: string;
  kind: string;
  state: string;
  agentId: string | null;
  lastError: string | null;
  resultSummary: string | null;
  /** Knowledge vault note produced by the task, if any. */
  notePath: string | null;
  updatedAt: string;
}

export interface LiveRunHealth {
  runId: string;
  taskId: string;
  agentId: string | null;
  status: string;
  attempt: number;
  startedAt: string | null;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  /** Running, but the worker's lease or deadline has passed (worker lost / hung). */
  stalled: boolean;
  /** Recorded API cost of this run so far (model_usage), micro-dollars. */
  costMicros: number;
}

/** Sent on connect (and when a reconnect gap is too large): the full current picture. */
export interface LiveSnapshot {
  cursor: number;
  serverTime: string;
  agents: LiveAgentInfo[];
  /** Events of each agent's most recent run, oldest first (origin "replay"). */
  events: LiveEvent[];
  tasks: LiveTaskInfo[];
  runs: LiveRunHealth[];
}

/** Periodic truth refresh: run health/cost and task state for runs in view. */
export interface LiveHealth {
  serverTime: string;
  tasks: LiveTaskInfo[];
  runs: LiveRunHealth[];
}

import type { AgentId, BusinessId, IsoTimestamp, ProjectId, TaskId } from "@/domain/ids";
import type { ModelProviderId } from "@/domain/agent";

/**
 * AGENT EXECUTION EVENTS - the single source of truth for live activity.
 *
 * Everything the virtual office animates and every activity feed entry must
 * come from one of these events. Agent "status" is derived from the event
 * stream, never stored or invented.
 *
 * Provenance (`origin`) is mandatory:
 * - "live":   emitted by a real agent run against a real provider.
 * - "replay": a recorded live event being replayed (e.g. after reconnect).
 * - "test":   produced by automated tests. Must never be persisted or shown
 *             in a production UI. (Rule: no fake production activity.)
 * - "simulation": produced by the in-browser prototype simulation (e.g. the
 *             Executive Floor demo). Allowed in the UI ONLY when every surface
 *             showing it is labelled as simulation. Never sent to the server,
 *             never persisted; the backend event bus drops it.
 */
export const AGENT_EVENT_SCHEMA_VERSION = 1 as const;

export type EventOrigin = "live" | "replay" | "test" | "simulation";

export type RunId = string;
export type EventId = string;

export interface AgentEventEnvelope<TType extends string, TPayload> {
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  id: EventId;
  type: TType;
  origin: EventOrigin;
  occurredAt: IsoTimestamp;
  /** Monotonic sequence number within one run; used for ordering/dedup. */
  sequence: number;
  runId: RunId;
  agentId: AgentId;
  /** null for HQ-level agents. Used for business isolation filtering. */
  businessId: BusinessId | null;
  projectId: ProjectId | null;
  taskId: TaskId | null;
  payload: TPayload;
}

export type RunStartedEvent = AgentEventEnvelope<
  "run.started",
  { provider: ModelProviderId; model: string; trigger: "user" | "schedule" | "agent" }
>;

export type RunStepEvent = AgentEventEnvelope<
  "run.step",
  { stepIndex: number; summary: string }
>;

export type ToolCalledEvent = AgentEventEnvelope<
  "tool.called",
  { toolCallId: string; tool: string; /** Redacted, human-readable summary only. */ inputSummary: string }
>;

export type ToolResultEvent = AgentEventEnvelope<
  "tool.result",
  { toolCallId: string; tool: string; ok: boolean; outputSummary: string }
>;

export type MessageEvent = AgentEventEnvelope<
  "message.created",
  { role: "agent" | "user"; text: string }
>;

export type ApprovalRequestedEvent = AgentEventEnvelope<
  "approval.requested",
  { approvalId: string; action: string; reason: string }
>;

export type ApprovalResolvedEvent = AgentEventEnvelope<
  "approval.resolved",
  { approvalId: string; decision: "approved" | "rejected" }
>;

export type HandoffEvent = AgentEventEnvelope<
  "agent.handoff",
  { toAgentId: AgentId; reason: string }
>;

export type RunCompletedEvent = AgentEventEnvelope<
  "run.completed",
  { summary: string; usage: TokenUsage | null }
>;

export type RunFailedEvent = AgentEventEnvelope<
  "run.failed",
  { errorCode: string; /** Safe for display: no stack traces or secrets. */ message: string }
>;

/** A person (or the system) canceled the task while it had a run. */
export type RunCanceledEvent = AgentEventEnvelope<"run.canceled", { reason: string }>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AgentExecutionEvent =
  | RunStartedEvent
  | RunStepEvent
  | ToolCalledEvent
  | ToolResultEvent
  | MessageEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | HandoffEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCanceledEvent;

export type AgentExecutionEventType = AgentExecutionEvent["type"];

export const AGENT_EVENT_TYPES = [
  "run.started",
  "run.step",
  "tool.called",
  "tool.result",
  "message.created",
  "approval.requested",
  "approval.resolved",
  "agent.handoff",
  "run.completed",
  "run.failed",
  "run.canceled",
] as const satisfies readonly AgentExecutionEventType[];

/** Activity state derived for display (office animations, status badges). */
export type DerivedAgentActivity =
  | "offline"
  | "idle"
  | "thinking"
  | "using-tool"
  | "awaiting-approval"
  | "error";

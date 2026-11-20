import type { LiveEvent, LiveRunHealth } from "@/domain/live-office";
import type { CharacterState } from "../sim/types";

/**
 * EVENT-TO-ANIMATION STATE MACHINE (pure; no React, PixiJS or timers)
 *
 * Input: stored execution events for one agent (plus run health from the
 * server). Output: the agent's live phase, which maps to a character state
 * and a place on the floor. Every phase is justified by a real event:
 *
 *   (no events)         offline           idle at the resting spot
 *   run.started         ready             walk to the workstation, sit
 *   run.step            working           working at the workstation
 *   tool.called         using-tool        working, showing the tool
 *   tool.result         working
 *   approval.requested  awaiting-approval paused with the approval badge
 *   approval.resolved   ready             (rejected: run.failed follows)
 *   run.completed       completed
 *   run.failed          failed
 *   run.canceled        canceled          idle at the workstation
 *   health: suspended   paused            (task paused by a person)
 *
 * Ordering and replay: within a run, events with a sequence at or below the
 * last applied one are duplicates and are ignored. Events of an OLDER run
 * (created before the current run) are stale and ignored, even when they
 * arrive later (e.g. the reaper failing two lost runs at once). So replays
 * after refresh or reconnect are idempotent.
 */
export type LivePhase = "offline" | "ready" | "working" | "using-tool" | "awaiting-approval" | "paused" | "completed" | "failed" | "canceled";

export interface AgentLiveState {
  agentId: string;
  phase: LivePhase;
  runId: string | null;
  taskId: string | null;
  /** occurredAt of the first event seen for the current run. */
  runStartedAt: string | null;
  /** Creation time of the current run (orders runs). */
  runCreatedAt: string | null;
  lastSequence: number;
  lastEvent: LiveEvent | null;
  tool: string | null;
  provider: string | null;
  model: string | null;
  approval: { action: string; reason: string } | null;
  error: { code: string; message: string } | null;
  summary: string | null;
  notePath: string | null;
  /** The worker stopped reporting (lease/deadline passed) - shown, never "fixed" by guessing. */
  stalled: boolean;
  /** Events of the current run, oldest first (bounded). */
  events: LiveEvent[];
}

export type ReduceOutcome = "applied" | "duplicate" | "stale" | "ignored";

const MAX_EVENTS = 60;
const ACTIVE: ReadonlySet<LivePhase> = new Set(["ready", "working", "using-tool"]);

export function initialAgentState(agentId: string): AgentLiveState {
  return {
    agentId,
    phase: "offline",
    runId: null,
    taskId: null,
    runStartedAt: null,
    runCreatedAt: null,
    lastSequence: -1,
    lastEvent: null,
    tool: null,
    provider: null,
    model: null,
    approval: null,
    error: null,
    summary: null,
    notePath: null,
    stalled: false,
    events: [],
  };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Applies one event. Returns the new state (same object when nothing changed). */
export function reduceEvent(s: AgentLiveState, e: LiveEvent): { state: AgentLiveState; outcome: ReduceOutcome } {
  if (e.agentId !== s.agentId) return { state: s, outcome: "ignored" };
  if (e.runId === s.runId && e.sequence <= s.lastSequence) return { state: s, outcome: "duplicate" };
  if (e.runId !== s.runId && s.runCreatedAt !== null && e.runCreatedAt < s.runCreatedAt) return { state: s, outcome: "stale" };

  const newRun = e.runId !== s.runId;
  const n: AgentLiveState = newRun
    ? { ...s, runId: e.runId, taskId: e.taskId, runStartedAt: e.occurredAt, runCreatedAt: e.runCreatedAt, events: [], tool: null, approval: null, error: null, summary: null, notePath: null, stalled: false, provider: null, model: null }
    : { ...s };
  n.lastSequence = e.sequence;
  n.lastEvent = e;
  n.events = [...n.events, e].slice(-MAX_EVENTS);
  const p = e.payload;

  switch (e.type) {
    case "run.started":
      n.phase = "ready";
      n.provider = str(p.provider);
      n.model = str(p.model);
      break;
    case "run.step":
      n.phase = "working";
      n.tool = null;
      break;
    case "tool.called":
      n.phase = "using-tool";
      n.tool = str(p.tool);
      break;
    case "tool.result":
      n.phase = "working";
      n.tool = null;
      break;
    case "approval.requested":
      n.phase = "awaiting-approval";
      n.tool = null;
      n.approval = { action: str(p.action) ?? "Approval", reason: str(p.reason) ?? "" };
      break;
    case "approval.resolved":
      n.approval = null;
      n.phase = "ready";
      break;
    case "run.completed":
      n.phase = "completed";
      n.stalled = false;
      n.tool = null;
      n.summary = str(p.summary);
      n.notePath = str(p.notePath);
      break;
    case "run.failed":
      n.phase = "failed";
      n.stalled = false;
      n.tool = null;
      n.error = { code: str(p.errorCode) ?? "FAILED", message: str(p.message) ?? "The run failed." };
      break;
    case "run.canceled":
      n.phase = "canceled";
      n.stalled = false;
      n.tool = null;
      break;
  }
  return { state: n, outcome: "applied" };
}

/**
 * Applies server-side run health to the agent's CURRENT run: marks a lost or
 * hung worker as stalled, and a run suspended by a person (pause) as paused.
 * Health never creates working/completed states; only events do.
 */
export function applyHealth(s: AgentLiveState, runs: readonly LiveRunHealth[]): AgentLiveState {
  const h = s.runId ? runs.find((r) => r.runId === s.runId) : undefined;
  if (!h) return s;
  const stalled = h.stalled && ACTIVE.has(s.phase);
  const paused = h.status === "suspended" && ACTIVE.has(s.phase);
  if (stalled === s.stalled && !paused) return s;
  return { ...s, stalled, phase: paused ? "paused" : s.phase };
}

/** Where the character should be: at its workstation for any run, else resting. */
export function placeFor(phase: LivePhase): "station" | "rest" {
  return phase === "offline" ? "rest" : "station";
}

/** The visual character state for a phase (walking is added by the director while moving). */
export function characterStateFor(phase: LivePhase): Exclude<CharacterState, "walking"> {
  switch (phase) {
    case "offline":
      return "idle";
    case "ready":
      return "sitting";
    case "working":
    case "using-tool":
      return "working";
    case "awaiting-approval":
      return "waiting-approval";
    case "paused":
    case "canceled":
      return "idle";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

export const PHASE_LABELS: Record<LivePhase, string> = {
  offline: "No runs yet",
  ready: "Run started",
  working: "Working",
  "using-tool": "Using a tool",
  "awaiting-approval": "Waiting for approval",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

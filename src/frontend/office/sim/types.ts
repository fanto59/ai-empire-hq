import type { AgentExecutionEvent } from "@/agents/events/types";
import type { TilePoint } from "../iso";
import type { Facing, WaypointId } from "../floor/types";

/** The eight visual states every character supports. */
export const CHARACTER_STATES = [
  "idle",
  "walking",
  "sitting",
  "working",
  "collaborating",
  "waiting-approval",
  "completed",
  "failed",
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

export const CHARACTER_STATE_LABELS: Record<CharacterState, string> = {
  idle: "Idle",
  walking: "Walking",
  sitting: "Sitting",
  working: "Working",
  collaborating: "Collaborating",
  "waiting-approval": "Waiting for approval",
  completed: "Completed",
  failed: "Failed",
};

export type Posture = "stand" | "sit";

/** Distinct, original look for each prototype character. */
export interface CharacterAppearance {
  skin: number;
  hair: number;
  hairStyle: "short" | "bun" | "long";
  jacket: number;
  shirt: number;
  accent: number;
  trousers: number;
  shoes: number;
  heightScale: number;
  accessory: "tie" | "tablet" | "glasses";
}

/**
 * A prototype character. These are NOT agents: they have no model, no
 * credentials, and no ability to act. Every field shown in the UI is
 * labelled as simulated or placeholder.
 */
export interface PrototypeCharacter {
  id: string;
  codename: string;
  role: string;
  business: string;
  project: string;
  plannedModel: string;
  homeWaypoint: WaypointId;
  /**
   * Slug of the TEST agent record this prototype stands in for. The
   * inspector lists that agent's real (test) tasks from the database.
   */
  agentSlug: string;
  appearance: CharacterAppearance;
}

/** What a scripted activity step announces to the event stream. */
export type SimEmit =
  | { type: "run.started" }
  | { type: "run.step"; summary: string }
  | { type: "tool.called"; tool: string; inputSummary: string }
  | { type: "message.created"; text: string }
  | { type: "approval.requested"; action: string; reason: string }
  | { type: "approval.resolved"; decision: "approved" | "rejected" }
  | { type: "run.completed"; summary: string }
  | { type: "run.failed"; errorCode: string; message: string };

export type SimStep =
  | { kind: "goto"; waypoint: WaypointId; note: string }
  | {
      kind: "activity";
      state: Exclude<CharacterState, "walking">;
      durationMs: number;
      note: string;
      emit?: SimEmit;
    };

export interface SimScript {
  characterId: string;
  steps: SimStep[];
}

export interface HistoryEntry {
  id: string;
  at: string;
  text: string;
  kind: "movement" | "state" | "event";
  event?: AgentExecutionEvent;
}

/** Mutable per-frame runtime read by the renderer (no allocations). */
export interface CharacterRuntime {
  id: string;
  /** Continuous tile position of the character's tile ORIGIN. */
  col: number;
  row: number;
  facing: Facing;
  posture: Posture;
  state: CharacterState;
  /** Simulated ms since the current state began. */
  stateElapsedMs: number;
  /** Depth key for sorting (see pixi/depth.ts). */
  depth: number;
  target: TilePoint | null;
}

/** Immutable snapshot for React (inspector, lists). */
export interface CharacterSnapshot {
  id: string;
  state: CharacterState;
  posture: Posture;
  location: string;
  stepNote: string;
  lastEvent: AgentExecutionEvent | null;
  history: HistoryEntry[];
  eventCount: number;
}

import {
  AGENT_EVENT_SCHEMA_VERSION,
  type AgentExecutionEvent,
} from "@/agents/events/types";
import type { AgentId, IsoTimestamp } from "@/domain/ids";
import type { TilePoint } from "../iso";
import type { FloorPlan, Waypoint } from "../floor/types";
import { buildNavGrid, type NavGrid } from "../navigation/grid";
import { facingForStep, findPath } from "../navigation/pathfinding";
import type {
  CharacterRuntime,
  CharacterSnapshot,
  CharacterState,
  HistoryEntry,
  PrototypeCharacter,
  SimEmit,
  SimScript,
  SimStep,
  SimTask,
  SimTaskStatus,
} from "./types";
import { CHARACTER_STATE_LABELS } from "./types";

/**
 * SIMULATION DIRECTOR
 *
 * Plays the hand-written scripts in `scripts.ts`: walks characters between
 * waypoints (A* on the floor's nav grid), holds activity states for their
 * durations, and emits AgentExecutionEvents with origin "simulation".
 *
 * Pure TypeScript - no PixiJS, no React, no timers. The host calls
 * `tick(dtMs)` (the renderer does it every frame), which makes the whole
 * simulation deterministic and unit-testable.
 */
export interface DirectorOptions {
  plan: FloorPlan;
  cast: readonly PrototypeCharacter[];
  scripts: readonly SimScript[];
  tasks: readonly SimTask[];
  /** Wall-clock epoch used to timestamp simulated events. */
  startEpochMs?: number;
  walkTilesPerSecond?: number;
  historyLimit?: number;
}

interface CharacterRecord {
  character: PrototypeCharacter;
  runtime: CharacterRuntime;
  script: SimStep[];
  stepIndex: number;
  loop: number;
  stepRemainingMs: number;
  path: TilePoint[];
  waypoint: Waypoint | null;
  destination: Waypoint | null;
  currentTaskId: string | null;
  stepNote: string;
  history: HistoryEntry[];
  lastEvent: AgentExecutionEvent | null;
  eventCount: number;
  sequence: number;
  snapshot: CharacterSnapshot;
}

const MAX_TICK_MS = 250;

const TASK_STATUS_FOR_STATE: Partial<Record<CharacterState, SimTaskStatus>> = {
  working: "in-progress",
  collaborating: "in-progress",
  "waiting-approval": "awaiting-approval",
  completed: "done",
  failed: "blocked",
};

export class SimulationDirector {
  private readonly grid: NavGrid;
  private readonly waypoints: Map<string, Waypoint>;
  private readonly records = new Map<string, CharacterRecord>();
  private readonly tasks = new Map<string, SimTask>();
  private readonly runtimeList: CharacterRuntime[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly startEpochMs: number;
  private readonly walkSpeed: number;
  private readonly historyLimit: number;
  private simTimeMs = 0;
  private eventCounter = 0;
  private historyCounter = 0;
  private version = 0;
  private taskList: SimTask[] = [];
  private paused = false;
  private speed = 1;
  private dirty = false;

  constructor(options: DirectorOptions) {
    this.grid = buildNavGrid(options.plan);
    this.waypoints = new Map(options.plan.waypoints.map((w) => [w.id, w]));
    this.startEpochMs = options.startEpochMs ?? Date.now();
    this.walkSpeed = options.walkTilesPerSecond ?? 2.4;
    this.historyLimit = options.historyLimit ?? 30;

    for (const task of options.tasks) this.tasks.set(task.id, { ...task });
    this.taskList = [...this.tasks.values()];

    for (const character of options.cast) {
      const script = options.scripts.find((s) => s.characterId === character.id);
      if (!script || script.steps.length === 0) throw new Error(`No script for ${character.id}`);
      const home = this.requireWaypoint(character.homeWaypoint);
      const record: CharacterRecord = {
        character,
        runtime: {
          id: character.id,
          col: home.tile.col,
          row: home.tile.row,
          facing: home.facing,
          posture: home.posture,
          state: "idle",
          stateElapsedMs: 0,
          depth: home.tile.col + home.tile.row + 1,
          target: null,
        },
        script: script.steps,
        stepIndex: -1,
        loop: 0,
        stepRemainingMs: 0,
        path: [],
        waypoint: home,
        destination: null,
        currentTaskId: null,
        stepNote: "",
        history: [],
        lastEvent: null,
        eventCount: 0,
        sequence: 0,
        snapshot: undefined as unknown as CharacterSnapshot,
      };
      this.records.set(character.id, record);
      this.runtimeList.push(record.runtime);
      this.pushHistory(record, "state", "Simulation started");
      this.advanceStep(record);
    }
    this.flush();
  }

  // ---- host controls ------------------------------------------------------

  tick(dtMs: number): void {
    if (this.paused || dtMs <= 0) return;
    let remaining = Math.min(dtMs, MAX_TICK_MS) * this.speed;
    // Sub-step large ticks (high speed) so waypoint arrivals stay accurate.
    while (remaining > 0) {
      const slice = Math.min(remaining, 50);
      remaining -= slice;
      this.simTimeMs += slice;
      for (const record of this.records.values()) this.update(record, slice);
    }
    this.flush();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.dirty = true;
    this.flush();
  }

  isPaused(): boolean {
    return this.paused;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(speed, 8));
    this.dirty = true;
    this.flush();
  }

  getSpeed(): number {
    return this.speed;
  }

  // ---- reads ----------------------------------------------------------------

  /** Mutable runtimes for the renderer's per-frame loop. Do not mutate. */
  runtimes(): readonly CharacterRuntime[] {
    return this.runtimeList;
  }

  getRuntime(id: string): CharacterRuntime | undefined {
    return this.records.get(id)?.runtime;
  }

  getSnapshot(id: string): CharacterSnapshot | undefined {
    return this.records.get(id)?.snapshot;
  }

  getTasks(): readonly SimTask[] {
    return this.taskList;
  }

  getSimTimeMs(): number {
    return this.simTimeMs;
  }

  /** Simulated ms elapsed at an ISO timestamp produced by this director. */
  simTimeAt(iso: string): number {
    return Date.parse(iso) - this.startEpochMs;
  }

  /** Increments whenever a snapshot, task, or control value changes. */
  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // ---- internals ------------------------------------------------------------

  private requireWaypoint(id: string): Waypoint {
    const w = this.waypoints.get(id);
    if (!w) throw new Error(`Unknown waypoint "${id}"`);
    return w;
  }

  private update(record: CharacterRecord, dt: number): void {
    const rt = record.runtime;
    rt.stateElapsedMs += dt;

    if (rt.state === "walking") {
      this.walk(record, dt);
      return;
    }
    record.stepRemainingMs -= dt;
    if (record.stepRemainingMs <= 0) this.advanceStep(record);
  }

  private walk(record: CharacterRecord, dt: number): void {
    const rt = record.runtime;
    let budget = (this.walkSpeed * dt) / 1000;
    while (budget > 0 && record.path.length > 0) {
      const next = record.path[0]!;
      const dc = next.col - rt.col;
      const dr = next.row - rt.row;
      const dist = Math.abs(dc) + Math.abs(dr);
      if (dist <= budget) {
        rt.col = next.col;
        rt.row = next.row;
        budget -= dist;
        record.path.shift();
        const following = record.path[0];
        if (following) rt.facing = facingForStep(next, following);
      } else {
        rt.col += Math.sign(dc) * budget;
        rt.row += Math.sign(dr) * budget;
        budget = 0;
      }
    }
    const target = record.path[0] ?? null;
    rt.target = target;
    const here = rt.col + rt.row;
    rt.depth = Math.max(here, target ? target.col + target.row : here) + 1;

    if (record.path.length === 0) {
      const dest = record.destination!;
      rt.col = dest.tile.col;
      rt.row = dest.tile.row;
      rt.depth = rt.col + rt.row + 1;
      rt.facing = dest.facing;
      rt.posture = dest.posture;
      record.waypoint = dest;
      record.destination = null;
      this.pushHistory(record, "movement", `Arrived at ${dest.label}`);
      this.advanceStep(record);
    }
  }

  private advanceStep(record: CharacterRecord): void {
    record.stepIndex += 1;
    if (record.stepIndex >= record.script.length) {
      record.stepIndex = 0;
      record.loop += 1;
      record.sequence = 0;
      for (const task of this.tasks.values()) {
        if (task.ownerId === record.character.id) this.setTaskStatus(task.id, "todo");
      }
    }
    const step = record.script[record.stepIndex]!;
    record.stepNote = step.note;
    const rt = record.runtime;

    if (step.kind === "goto") {
      const dest = this.requireWaypoint(step.waypoint);
      const from = { col: Math.round(rt.col), row: Math.round(rt.row) };
      const path = findPath(this.grid, from, dest.tile);
      if (!path || path.length === 0) {
        // Already there (or unreachable - floor tests guarantee reachability).
        record.destination = dest;
        record.path = [];
        rt.facing = dest.facing;
        rt.posture = dest.posture;
        record.waypoint = dest;
        this.setState(record, "idle");
        record.stepRemainingMs = 0;
        return;
      }
      record.path = path;
      record.destination = dest;
      record.waypoint = null;
      rt.posture = "stand";
      rt.facing = facingForStep(from, path[0]!);
      this.setState(record, "walking");
      this.pushHistory(record, "movement", `${step.note} → ${dest.label}`);
      return;
    }

    const previousState = rt.state;
    record.stepRemainingMs = step.durationMs;
    if (step.taskId) {
      record.currentTaskId = step.taskId;
      const status = TASK_STATUS_FOR_STATE[step.state];
      if (status) this.setTaskStatus(step.taskId, status);
    }
    this.setState(record, step.state);
    this.pushHistory(record, "state", `${CHARACTER_STATE_LABELS[step.state]} · ${step.note}`);
    if (previousState === "waiting-approval" && step.emit?.type === "run.completed") {
      this.emit(record, { type: "approval.resolved", decision: "approved" });
    }
    if (step.emit) this.emit(record, step.emit);
  }

  private setState(record: CharacterRecord, state: CharacterState): void {
    record.runtime.state = state;
    record.runtime.stateElapsedMs = 0;
    this.dirty = true;
  }

  private setTaskStatus(taskId: string, status: SimTaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status === status) return;
    this.tasks.set(taskId, { ...task, status });
    this.taskList = [...this.tasks.values()];
    this.dirty = true;
  }

  private emit(record: CharacterRecord, spec: SimEmit): void {
    const { character } = record;
    const task = record.currentTaskId ? this.tasks.get(record.currentTaskId) : undefined;
    const base = {
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      id: `sim-evt-${++this.eventCounter}`,
      origin: "simulation" as const,
      occurredAt: new Date(this.startEpochMs + this.simTimeMs).toISOString() as IsoTimestamp,
      sequence: record.sequence++,
      runId: `sim-run-${character.id}-${record.loop}`,
      agentId: character.id as AgentId,
      businessId: null,
      projectId: null,
      taskId: null,
    };

    let event: AgentExecutionEvent;
    switch (spec.type) {
      case "run.started":
        event = { ...base, type: spec.type, payload: { provider: "anthropic", model: "none (simulation)", trigger: "schedule" } };
        break;
      case "run.step":
        event = { ...base, type: spec.type, payload: { stepIndex: record.sequence, summary: spec.summary } };
        break;
      case "tool.called":
        event = {
          ...base,
          type: spec.type,
          payload: { toolCallId: `${base.id}-call`, tool: spec.tool, inputSummary: spec.inputSummary },
        };
        break;
      case "message.created":
        event = { ...base, type: spec.type, payload: { role: "agent", text: spec.text } };
        break;
      case "approval.requested":
        event = {
          ...base,
          type: spec.type,
          payload: { approvalId: `${base.runId}-approval`, action: spec.action, reason: spec.reason },
        };
        break;
      case "approval.resolved":
        event = { ...base, type: spec.type, payload: { approvalId: `${base.runId}-approval`, decision: spec.decision } };
        break;
      case "run.completed":
        event = { ...base, type: spec.type, payload: { summary: spec.summary, usage: null } };
        break;
      case "run.failed":
        event = { ...base, type: spec.type, payload: { errorCode: spec.errorCode, message: spec.message } };
        break;
    }

    record.lastEvent = event;
    record.eventCount += 1;
    const label = task ? ` · ${task.title}` : "";
    this.pushHistory(record, "event", `${event.type}${label}`, event);
  }

  private pushHistory(record: CharacterRecord, kind: HistoryEntry["kind"], text: string, event?: AgentExecutionEvent) {
    const entry: HistoryEntry = {
      id: `${record.character.id}-h${++this.historyCounter}`,
      at: new Date(this.startEpochMs + this.simTimeMs).toISOString(),
      text,
      kind,
      event,
    };
    record.history = [entry, ...record.history].slice(0, this.historyLimit);
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const record of this.records.values()) {
      const task = record.currentTaskId ? (this.tasks.get(record.currentTaskId) ?? null) : null;
      const location = record.destination
        ? `Walking to ${record.destination.label}`
        : (record.waypoint?.label ?? "On the floor");
      const prev = record.snapshot;
      if (
        prev &&
        prev.state === record.runtime.state &&
        prev.history === record.history &&
        prev.currentTask === task &&
        prev.location === location
      ) {
        continue;
      }
      record.snapshot = {
        id: record.character.id,
        state: record.runtime.state,
        posture: record.runtime.posture,
        location,
        currentTask: task,
        stepNote: record.stepNote,
        lastEvent: record.lastEvent,
        history: record.history,
        eventCount: record.eventCount,
      };
    }
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

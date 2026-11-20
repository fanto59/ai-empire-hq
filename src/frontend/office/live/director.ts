import type { LiveAgentInfo, LiveEvent, LiveHealth, LiveRunHealth, LiveSnapshot, LiveTaskInfo } from "@/domain/live-office";
import type { TilePoint } from "../iso";
import type { FloorPlan, Waypoint } from "../floor/types";
import { buildNavGrid, type NavGrid } from "../navigation/grid";
import { facingForStep, findPath } from "../navigation/pathfinding";
import type { CharacterRuntime, CharacterState, PrototypeCharacter } from "../sim/types";
import { characterFor } from "./looks";
import { applyHealth, characterStateFor, initialAgentState, placeFor, reduceEvent, type AgentLiveState, type ReduceOutcome } from "./machine";

/**
 * LIVE DIRECTOR - drives the office characters from REAL execution events.
 *
 * The state machine (machine.ts) decides what each agent is doing; this class
 * turns that into movement: A* paths on the floor grid, walked in the browser
 * at a fixed speed by `tick(dt)` (called by the renderer each frame). No model
 * is ever asked about animation - movement costs zero tokens.
 *
 * It exposes the same small interface the PixiJS renderer uses for the
 * simulation (tick / runtimes / getRuntime / getSimTimeMs), so the renderer
 * does not know or care whether characters are live or simulated.
 */
export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "unauthorized" | "offline";

export interface FloorSlot {
  rest: string;
  desk: string;
}

/** Which look and spots a real agent gets on the Executive Floor (by work type / role). */
export const LIVE_SLOTS: Record<"chief" | "pm" | "research", { lookId: string; rest: string; desk: string }> = {
  chief: { lookId: "sim-chief", rest: "chief.window", desk: "chief.desk" },
  pm: { lookId: "sim-pm", rest: "board.left", desk: "pm.desk" },
  research: { lookId: "sim-research", rest: "research.side", desk: "research.desk" },
};

/** Executive Floor workstations by task kind (falls back to the agent's own desk). */
export const EXECUTIVE_STATIONS: Record<string, string> = { research: "research.desk", executive: "chief.desk" };

export function slotFor(agent: LiveAgentInfo): keyof typeof LIVE_SLOTS | null {
  if (agent.role === "chief-ai-manager") return "chief";
  if (agent.role === "central-project-manager") return "pm";
  if (agent.workType === "research") return "research";
  return null;
}

export interface LiveCharacterView {
  agent: LiveAgentInfo;
  character: PrototypeCharacter;
  live: AgentLiveState;
  state: CharacterState;
  location: string;
  task: LiveTaskInfo | null;
  run: LiveRunHealth | null;
}

interface Rec {
  agent: LiveAgentInfo;
  character: PrototypeCharacter;
  slot: FloorSlot;
  live: AgentLiveState;
  runtime: CharacterRuntime;
  path: TilePoint[];
  destination: Waypoint | null;
  at: Waypoint;
  view: LiveCharacterView;
}

/** Where each agent goes on this floor: a slot, "overflow" (belongs here, no free desk), or absent (not on this floor). */
export type SlotAssignment = Map<string, { character: PrototypeCharacter; rest: string; desk: string } | "overflow">;

export interface LiveDirectorOptions {
  plan: FloorPlan;
  looks: readonly PrototypeCharacter[];
  walkTilesPerSecond?: number;
  /** Seats agents on this floor. Default: the Executive Floor's headquarters seating. */
  assignSlots?: (agents: readonly LiveAgentInfo[]) => SlotAssignment;
  /** Task kind → workstation waypoint (Executive Floor: research desk, Chief's desk). */
  stationByKind?: Record<string, string>;
}

/**
 * Executive Floor seating: the Chief, the Central PM and the first research
 * agent get their offices; other headquarters agents are "not on this
 * floor"; sector and business agents belong to their sector floors.
 */
export function executiveSlots(looks: readonly PrototypeCharacter[]) {
  return (agents: readonly LiveAgentInfo[]): SlotAssignment => {
    const out: SlotAssignment = new Map();
    const used = new Set<string>();
    for (const agent of agents) {
      const key = slotFor(agent);
      const spec = key && !used.has(key) ? LIVE_SLOTS[key] : null;
      const look = spec ? looks.find((l) => l.id === spec.lookId) : undefined;
      if (spec && look) {
        used.add(key!);
        out.set(agent.id, { character: characterFor(agent, spec.rest, look), rest: spec.rest, desk: spec.desk });
      } else if (agent.businessId === null && !agent.sectorId) {
        out.set(agent.id, "overflow");
      }
    }
    return out;
  };
}

const MAX_TICK_MS = 250;

export class LiveDirector {
  private readonly grid: NavGrid;
  private readonly waypoints: Map<string, Waypoint>;
  private readonly assignSlots: (agents: readonly LiveAgentInfo[]) => SlotAssignment;
  private readonly stationByKind: Record<string, string>;
  private readonly walkSpeed: number;
  private readonly records = new Map<string, Rec>();
  private runtimeList: CharacterRuntime[] = [];
  private readonly listeners = new Set<() => void>();
  private tasks = new Map<string, LiveTaskInfo>();
  private runs = new Map<string, LiveRunHealth>();
  private clockMs = 0;
  private version = 0;
  private dirty = false;
  private connection: ConnectionStatus = "connecting";
  private offFloor: LiveAgentInfo[] = [];
  private lastServerTime: string | null = null;

  constructor(options: LiveDirectorOptions) {
    this.grid = buildNavGrid(options.plan);
    this.waypoints = new Map(options.plan.waypoints.map((w) => [w.id, w]));
    this.assignSlots = options.assignSlots ?? executiveSlots(options.looks);
    this.stationByKind = options.stationByKind ?? (options.assignSlots ? {} : EXECUTIVE_STATIONS);
    this.walkSpeed = options.walkTilesPerSecond ?? 2.4;
  }

  // ---- inputs from the stream ---------------------------------------------------

  /** Replaces everything with the server's current picture (refresh / large reconnect gap). */
  applySnapshot(snap: LiveSnapshot): void {
    this.records.clear();
    this.runtimeList = [];
    this.offFloor = [];
    this.tasks = new Map(snap.tasks.map((t) => [t.id, t]));
    this.runs = new Map(snap.runs.map((r) => [r.runId, r]));
    const slots = this.assignSlots(snap.agents);
    for (const agent of snap.agents) {
      const slot = slots.get(agent.id);
      if (!slot) continue; // works on another floor
      if (slot === "overflow") {
        this.offFloor.push(agent);
        continue;
      }
      const rest = this.wp(slot.rest);
      const runtime: CharacterRuntime = {
        id: agent.id,
        col: rest.tile.col,
        row: rest.tile.row,
        facing: rest.facing,
        posture: rest.posture,
        state: "idle",
        stateElapsedMs: 0,
        depth: rest.tile.col + rest.tile.row + 1,
        target: null,
      };
      const character = slot.character;
      const rec: Rec = { agent, character, slot: { rest: slot.rest, desk: slot.desk }, live: initialAgentState(agent.id), runtime, path: [], destination: null, at: rest, view: undefined as unknown as LiveCharacterView };
      this.records.set(agent.id, rec);
      this.runtimeList.push(runtime);
    }
    // Replay the recorded events, then place everyone instantly (no walking on refresh).
    for (const e of snap.events) this.reduce(e);
    for (const rec of this.records.values()) {
      rec.live = applyHealth(rec.live, snap.runs);
      this.place(rec, true);
    }
    this.lastServerTime = snap.serverTime;
    this.dirty = true;
    this.flush();
  }

  /** One live (or replayed-after-reconnect) event. Returns what the state machine did. */
  ingest(event: LiveEvent): ReduceOutcome {
    const outcome = this.reduce(event);
    if (outcome === "applied") {
      const rec = event.agentId ? this.records.get(event.agentId) : undefined;
      if (rec) this.place(rec, false);
      this.dirty = true;
      this.flush();
    }
    return outcome;
  }

  applyHealth(h: LiveHealth): void {
    for (const t of h.tasks) this.tasks.set(t.id, t);
    for (const r of h.runs) this.runs.set(r.runId, r);
    for (const rec of this.records.values()) {
      const next = applyHealth(rec.live, h.runs);
      if (next !== rec.live) {
        rec.live = next;
        this.place(rec, false);
      }
    }
    this.lastServerTime = h.serverTime;
    this.dirty = true;
    this.flush();
  }

  setConnection(status: ConnectionStatus): void {
    if (status === this.connection) return;
    this.connection = status;
    this.dirty = true;
    this.flush();
  }

  // ---- renderer interface ---------------------------------------------------------

  tick(dtMs: number): void {
    if (dtMs <= 0) return;
    const dt = Math.min(dtMs, MAX_TICK_MS);
    this.clockMs += dt;
    let arrived = false;
    for (const rec of this.records.values()) {
      rec.runtime.stateElapsedMs += dt;
      if (rec.runtime.state === "walking") arrived = this.walk(rec, dt) || arrived;
    }
    if (arrived) {
      this.dirty = true;
      this.flush();
    }
  }

  getSimTimeMs(): number {
    return this.clockMs;
  }

  runtimes(): readonly CharacterRuntime[] {
    return this.runtimeList;
  }

  getRuntime(id: string): CharacterRuntime | undefined {
    return this.records.get(id)?.runtime;
  }

  // ---- reads for React ---------------------------------------------------------------

  characters(): PrototypeCharacter[] {
    return [...this.records.values()].map((r) => r.character);
  }

  getView(agentId: string): LiveCharacterView | undefined {
    return this.records.get(agentId)?.view;
  }

  views(): LiveCharacterView[] {
    return [...this.records.values()].map((r) => r.view);
  }

  agentsOffFloor(): readonly LiveAgentInfo[] {
    return this.offFloor;
  }

  getConnection(): ConnectionStatus {
    return this.connection;
  }

  getServerTime(): string | null {
    return this.lastServerTime;
  }

  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // ---- internals --------------------------------------------------------------------

  private wp(id: string): Waypoint {
    const w = this.waypoints.get(id);
    if (!w) throw new Error(`Unknown waypoint "${id}"`);
    return w;
  }

  private reduce(e: LiveEvent): ReduceOutcome {
    const rec = e.agentId ? this.records.get(e.agentId) : undefined;
    if (!rec) return "ignored";
    const { state, outcome } = reduceEvent(rec.live, e);
    rec.live = state;
    return outcome;
  }

  /** Where the agent's current phase puts it. */
  private targetFor(rec: Rec): Waypoint {
    if (placeFor(rec.live.phase) === "rest") return this.wp(rec.slot.rest);
    const kind = rec.live.taskId ? this.tasks.get(rec.live.taskId)?.kind : undefined;
    const byKind = kind ? this.stationByKind[kind] : undefined;
    // Use the kind's station only when it is this agent's own desk type (no two agents share a desk).
    return this.wp(byKind && byKind === rec.slot.desk ? byKind : rec.slot.desk);
  }

  private place(rec: Rec, instant: boolean): void {
    const target = this.targetFor(rec);
    const rt = rec.runtime;
    const goal = rec.destination ?? rec.at;
    if (goal.id === target.id) {
      if (rt.state !== "walking") this.setState(rec, characterStateFor(rec.live.phase));
      return;
    }
    const from = { col: Math.round(rt.col), row: Math.round(rt.row) };
    const path = instant ? null : findPath(this.grid, from, target.tile);
    if (!path || path.length === 0) {
      this.arrive(rec, target);
      return;
    }
    rec.path = path;
    rec.destination = target;
    rt.posture = "stand";
    rt.facing = facingForStep(from, path[0]!);
    this.setState(rec, "walking");
  }

  private walk(rec: Rec, dt: number): boolean {
    const rt = rec.runtime;
    let budget = (this.walkSpeed * dt) / 1000;
    while (budget > 0 && rec.path.length > 0) {
      const next = rec.path[0]!;
      const dc = next.col - rt.col;
      const dr = next.row - rt.row;
      const dist = Math.abs(dc) + Math.abs(dr);
      if (dist <= budget) {
        rt.col = next.col;
        rt.row = next.row;
        budget -= dist;
        rec.path.shift();
        const following = rec.path[0];
        if (following) rt.facing = facingForStep(next, following);
      } else {
        rt.col += Math.sign(dc) * budget;
        rt.row += Math.sign(dr) * budget;
        budget = 0;
      }
    }
    const t = rec.path[0] ?? null;
    rt.target = t;
    rt.depth = Math.max(rt.col + rt.row, t ? t.col + t.row : 0) + 1;
    if (rec.path.length > 0) return false;
    this.arrive(rec, rec.destination!);
    return true;
  }

  private arrive(rec: Rec, w: Waypoint): void {
    const rt = rec.runtime;
    rt.col = w.tile.col;
    rt.row = w.tile.row;
    rt.depth = rt.col + rt.row + 1;
    rt.facing = w.facing;
    rt.posture = w.posture;
    rt.target = null;
    rec.path = [];
    rec.at = w;
    rec.destination = null;
    // A new target may have been decided while walking (e.g. fast events).
    const target = this.targetFor(rec);
    if (target.id !== w.id) {
      this.place(rec, false);
      return;
    }
    this.setState(rec, characterStateFor(rec.live.phase));
  }

  private setState(rec: Rec, state: CharacterState): void {
    if (rec.runtime.state !== state) {
      rec.runtime.state = state;
      rec.runtime.stateElapsedMs = 0;
    }
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const rec of this.records.values()) {
      const location = rec.destination ? `Walking to ${rec.destination.label}` : rec.at.label;
      rec.view = {
        agent: rec.agent,
        character: rec.character,
        live: rec.live,
        state: rec.runtime.state,
        location,
        task: rec.live.taskId ? (this.tasks.get(rec.live.taskId) ?? null) : null,
        run: rec.live.runId ? (this.runs.get(rec.live.runId) ?? null) : null,
      };
    }
    this.version += 1;
    for (const l of this.listeners) l();
  }
}

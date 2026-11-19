import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAgentEvent } from "@/agents/events/validate";
import { EXECUTIVE_FLOOR } from "../floor/executive-floor";
import { PROTOTYPE_CAST } from "./cast";
import { SimulationDirector } from "./director";
import { SIM_SCRIPTS, SIM_TASKS } from "./scripts";
import { CHARACTER_STATES, type CharacterState } from "./types";

function makeDirector() {
  return new SimulationDirector({
    plan: EXECUTIVE_FLOOR,
    cast: PROTOTYPE_CAST,
    scripts: SIM_SCRIPTS,
    tasks: SIM_TASKS,
    startEpochMs: Date.UTC(2026, 0, 1),
  });
}

/** Runs the simulation in 16 ms frames, calling `onFrame` after each. */
function run(director: SimulationDirector, ms: number, onFrame?: () => void) {
  for (let t = 0; t < ms; t += 16) {
    director.tick(16);
    onFrame?.();
  }
}

test("every scripted waypoint exists on the floor", () => {
  const ids = new Set(EXECUTIVE_FLOOR.waypoints.map((w) => w.id));
  for (const script of SIM_SCRIPTS) {
    for (const step of script.steps) if (step.kind === "goto") assert.ok(ids.has(step.waypoint), step.waypoint);
  }
  for (const c of PROTOTYPE_CAST) assert.ok(ids.has(c.homeWaypoint), c.homeWaypoint);
});

test("the cast collectively shows all eight character states", () => {
  const director = makeDirector();
  const seen = new Set<CharacterState>();
  run(director, 180_000, () => {
    for (const rt of director.runtimes()) seen.add(rt.state);
  });
  for (const state of CHARACTER_STATES) assert.ok(seen.has(state), `never entered ${state}`);
});

test("seated-only states happen on seats; walking always stands", () => {
  const director = makeDirector();
  run(director, 120_000, () => {
    for (const rt of director.runtimes()) {
      if (rt.state === "sitting") assert.equal(rt.posture, "sit", `${rt.id} sitting while standing`);
      if (rt.state === "walking") assert.equal(rt.posture, "stand", `${rt.id} walking while seated`);
    }
  });
});

test("characters only ever stand on walkable tiles", async () => {
  const { buildNavGrid } = await import("../navigation/grid");
  const grid = buildNavGrid(EXECUTIVE_FLOOR);
  const director = makeDirector();
  run(director, 120_000, () => {
    for (const rt of director.runtimes()) {
      const tiles = [
        { col: Math.floor(rt.col), row: Math.floor(rt.row) },
        { col: Math.ceil(rt.col), row: Math.ceil(rt.row) },
      ];
      for (const t of tiles) assert.ok(grid.isWalkable(t), `${rt.id} on blocked tile ${t.col},${t.row}`);
    }
  });
});

test("every emitted event is a valid, simulation-labelled execution event", () => {
  const director = makeDirector();
  const events = new Map<string, unknown>();
  run(director, 120_000, () => {
    for (const c of PROTOTYPE_CAST) {
      const e = director.getSnapshot(c.id)?.lastEvent;
      if (e) events.set(e.id, e);
    }
  });
  assert.ok(events.size > 10, "expected a steady stream of simulated events");
  for (const e of events.values()) {
    const result = validateAgentEvent(e);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.event.origin, "simulation");
  }
});

test("snapshots are stable between changes (safe for useSyncExternalStore)", () => {
  const director = makeDirector();
  const a = director.getSnapshot("sim-chief");
  director.tick(1);
  assert.equal(director.getSnapshot("sim-chief"), a);
});

test("pause stops time; speed scales it", () => {
  const director = makeDirector();
  director.setPaused(true);
  director.tick(1000);
  assert.equal(director.getSimTimeMs(), 0);
  director.setPaused(false);
  director.setSpeed(2);
  director.tick(100);
  assert.equal(director.getSimTimeMs(), 200);
});

test("history is capped and newest-first", () => {
  const director = makeDirector();
  run(director, 300_000);
  const history = director.getSnapshot("sim-research")!.history;
  assert.ok(history.length <= 30);
  for (let i = 1; i < history.length; i++) assert.ok(history[i - 1]!.at >= history[i]!.at);
});

test("history entry ids are unique across a long run", () => {
  const director = makeDirector();
  const seen = new Map<string, string>();
  run(director, 400_000, () => {
    for (const c of PROTOTYPE_CAST) {
      for (const h of director.getSnapshot(c.id)!.history) {
        const prev = seen.get(h.id);
        assert.ok(prev === undefined || prev === h.text, `duplicate id ${h.id}`);
        seen.set(h.id, h.text);
      }
    }
  });
});

test("board tasks move through statuses", () => {
  const director = makeDirector();
  const statuses = new Set<string>();
  run(director, 120_000, () => {
    for (const t of director.getTasks()) statuses.add(t.status);
  });
  for (const s of ["todo", "in-progress", "awaiting-approval", "done", "blocked"]) assert.ok(statuses.has(s), s);
});

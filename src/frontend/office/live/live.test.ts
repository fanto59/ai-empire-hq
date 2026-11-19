import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveEvent, LiveSnapshot } from "@/domain/live-office";
import { EXECUTIVE_FLOOR } from "../floor/executive-floor";
import { PROTOTYPE_CAST } from "../sim/cast";
import { LiveDirector } from "./director";
import { applyHealth, initialAgentState, reduceEvent, type AgentLiveState } from "./machine";

/** Pure tests: event → phase → character state/position. No network, no renderer. */
const AGENT = "agent-research";
const CHIEF = "agent-chief";
let streamId = 0;
const ev = (type: LiveEvent["type"], payload: LiveEvent["payload"] = {}, o: Partial<LiveEvent> = {}): LiveEvent => ({
  streamId: ++streamId,
  id: `e${streamId}`,
  type,
  origin: "live",
  occurredAt: new Date(Date.UTC(2026, 10, 19, 10, 0, streamId)).toISOString(),
  sequence: 0,
  runId: "run-1",
  taskId: "task-1",
  agentId: AGENT,
  businessId: "biz",
  payload,
  ...o,
});

function run(events: LiveEvent[], s: AgentLiveState = initialAgentState(AGENT)) {
  for (const e of events) s = reduceEvent(s, e).state;
  return s;
}

test("machine: each real event maps to exactly one phase", () => {
  let seq = 0;
  const e = (type: LiveEvent["type"], payload: LiveEvent["payload"] = {}) => ev(type, payload, { sequence: seq++ });
  const steps: [LiveEvent, string][] = [
    [e("run.started", { provider: "xai", model: "grok-4.7" }), "ready"],
    [e("run.step", { summary: "Model call 1" }), "working"],
    [e("tool.called", { tool: "web_search" }), "using-tool"],
    [e("tool.result", { tool: "web_search", ok: true }), "working"],
    [e("approval.requested", { action: "Publish", reason: "Needs owner" }), "awaiting-approval"],
    [e("approval.resolved", { decision: "approved" }), "ready"],
    [e("run.completed", { summary: "Done", notePath: "businesses/x/reports/r.md" }), "completed"],
  ];
  let s = initialAgentState(AGENT);
  assert.equal(s.phase, "offline", "no events = offline, never invented activity");
  for (const [event, phase] of steps) {
    s = reduceEvent(s, event).state;
    assert.equal(s.phase, phase, event.type);
  }
  assert.equal(s.model, "grok-4.7");
  assert.equal(s.notePath, "businesses/x/reports/r.md");
  assert.equal(s.events.length, steps.length);
});

test("machine: duplicates, replays and stale runs are ignored (idempotent replay)", () => {
  const started = ev("run.started", {}, { sequence: 0 });
  const step = ev("run.step", {}, { sequence: 1 });
  let s = run([started, step]);
  assert.equal(reduceEvent(s, step).outcome, "duplicate");
  assert.equal(reduceEvent(s, { ...started, origin: "replay" }).outcome, "duplicate");
  // A newer run replaces the old one; late events of the old run are stale.
  const run2 = ev("run.started", {}, { runId: "run-2", sequence: 0 });
  s = reduceEvent(s, run2).state;
  assert.equal(s.runId, "run-2");
  const late = { ...ev("run.failed", { errorCode: "X" }, { sequence: 2 }), occurredAt: started.occurredAt };
  assert.equal(reduceEvent(s, late).outcome, "stale");
  assert.equal(reduceEvent(s, ev("run.step", {}, { agentId: "someone-else" })).outcome, "ignored");
});

test("machine: failure and worker loss come from events or run health, never from guessing", () => {
  let s = run([ev("run.started", {}, { sequence: 0 }), ev("run.step", {}, { sequence: 1 })]);
  const health = (o: Record<string, unknown>) => [{ runId: "run-1", taskId: "task-1", agentId: AGENT, status: "running", attempt: 1, startedAt: null, heartbeatAt: null, leaseExpiresAt: null, stalled: false, costMicros: 0, ...o }];
  s = applyHealth(s, health({ stalled: true }));
  assert.equal(s.stalled, true);
  assert.equal(s.phase, "working", "a stalled worker is flagged, not declared failed");
  s = reduceEvent(s, ev("run.failed", { errorCode: "WORKER_LOST", message: "Worker stopped sending heartbeats" }, { sequence: 2 })).state;
  assert.equal(s.phase, "failed");
  assert.deepEqual(s.error, { code: "WORKER_LOST", message: "Worker stopped sending heartbeats" });
  assert.equal(s.stalled, false, "a terminal event clears the stalled flag");
  const paused = applyHealth(run([ev("run.started", {}, { runId: "r9", sequence: 0 })]), [{ ...health({ status: "suspended" })[0]!, runId: "r9" }]);
  assert.equal(paused.phase, "paused");
});

const agentInfo = (id: string, role: string, workType: string) => ({ id, slug: id, name: `Test ${id}`, role, businessId: null, workType, provider: "xai", model: "grok-4.7" });
const snapshot = (events: LiveEvent[] = [], extra: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  cursor: events.at(-1)?.streamId ?? 0,
  serverTime: "2026-11-19T10:00:00.000Z",
  agents: [agentInfo(AGENT, "specialist", "research"), agentInfo(CHIEF, "chief-ai-manager", "strategy"), agentInfo("agent-ops", "business-lead", "engineering")],
  events,
  tasks: [{ id: "task-1", title: "Test: research", kind: "research", state: "running", agentId: AGENT, lastError: null, resultSummary: null, notePath: null, updatedAt: "2026-11-19T10:00:00.000Z" }],
  runs: [],
  ...extra,
});
const director = () => new LiveDirector({ plan: EXECUTIVE_FLOOR, looks: PROTOTYPE_CAST });
const wp = (id: string) => EXECUTIVE_FLOOR.waypoints.find((w) => w.id === id)!;

test("director: agents with no events rest; a real start walks the agent to its workstation in the browser", () => {
  const d = director();
  d.applySnapshot(snapshot());
  assert.deepEqual(d.characters().map((c) => c.id).sort(), [CHIEF, AGENT].sort());
  assert.deepEqual(d.agentsOffFloor().map((a) => a.id), ["agent-ops"]);
  const rt = d.getRuntime(AGENT)!;
  assert.deepEqual([rt.col, rt.row, rt.state], [wp("research.side").tile.col, wp("research.side").tile.row, "idle"]);

  d.ingest(ev("run.started", { provider: "xai", model: "grok-4.7" }, { sequence: 0 }));
  assert.equal(rt.state, "walking", "starts walking immediately");
  for (let i = 0; i < 100 && rt.state === "walking"; i++) d.tick(100);
  assert.deepEqual([rt.col, rt.row], [wp("research.desk").tile.col, wp("research.desk").tile.row]);
  assert.equal(rt.state, "sitting", "at the workstation; not 'working' until the worker reports activity");

  d.ingest(ev("tool.called", { tool: "web_search" }, { sequence: 1 }));
  assert.equal(rt.state, "working");
  assert.equal(d.getView(AGENT)!.live.tool, "web_search");
  d.ingest(ev("approval.requested", { action: "Publish" }, { sequence: 2 }));
  assert.equal(rt.state, "waiting-approval");
  d.ingest(ev("run.completed", { summary: "ok" }, { sequence: 3 }));
  assert.equal(rt.state, "completed");
  assert.equal(d.getView(AGENT)!.task?.title, "Test: research");
});

test("director: refresh replays the snapshot instantly (no walking), and repeated replays change nothing", () => {
  const events = [ev("run.started", {}, { sequence: 0 }), ev("run.step", {}, { sequence: 1 }), ev("run.failed", { errorCode: "BUDGET_EXCEEDED", message: "Spending limit" }, { sequence: 2 })];
  const d = director();
  d.applySnapshot(snapshot(events));
  const rt = d.getRuntime(AGENT)!;
  assert.equal(rt.state, "failed");
  assert.deepEqual([rt.col, rt.row], [wp("research.desk").tile.col, wp("research.desk").tile.row], "placed directly at the desk");
  const v = d.getVersion();
  for (const e of events) assert.equal(d.ingest({ ...e, origin: "replay" }), "duplicate");
  assert.equal(d.getVersion(), v, "duplicate replays do not even re-render");
  assert.equal(d.getView(AGENT)!.live.error?.code, "BUDGET_EXCEEDED");
});

test("director: movement is computed per frame in the browser at a fixed speed (bounded work per tick)", () => {
  const d = director();
  d.applySnapshot(snapshot());
  const rt = d.getRuntime(CHIEF)!;
  d.ingest(ev("run.started", {}, { agentId: CHIEF, runId: "c1", taskId: "t-exec", sequence: 0 }));
  const before = { col: rt.col, row: rt.row };
  d.tick(10_000); // a huge frame gap (tab was hidden) is clamped
  const moved = Math.abs(rt.col - before.col) + Math.abs(rt.row - before.row);
  assert.ok(moved <= 2.4 * 0.25 + 1e-9, `moved ${moved} tiles in one clamped frame`);
});

test("director: connection status is tracked for the UI", () => {
  const d = director();
  assert.equal(d.getConnection(), "connecting");
  d.setConnection("reconnecting");
  assert.equal(d.getConnection(), "reconnecting");
});

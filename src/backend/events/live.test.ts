import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { createAnthropicProvider, type Messages } from "@/agents/providers/anthropic";
import type { LiveEvent, LiveSnapshot } from "@/domain/live-office";
import { EXECUTIVE_FLOOR } from "@/frontend/office/floor/executive-floor";
import { LiveDirector } from "@/frontend/office/live/director";
import { PROTOTYPE_CAST } from "@/frontend/office/sim/cast";
import { agentPermissions, agents, budgets, executionEvents, executionRuns, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { createApiToken } from "../auth/api-tokens";
import { monthStart } from "../budgets/spend-guard";
import { ExecutionQueue } from "../execution/queue";
import { ResearchWorker } from "../execution/research-worker";
import { KnowledgeService } from "../knowledge";
import { createResearchTask } from "../tasks/research";
import { TaskService } from "../tasks/service";
import { seedTestData } from "../testing/seed";
import { createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { loadSnapshot, readEventsAfter } from "./live-feed";
import { createLiveStream, handleLiveStream } from "./stream";

/**
 * Live office: event storage, lifecycle events, scoping, the SSE stream
 * (refresh, reconnect, replay) and - end to end - a real worker run driving
 * the office state machine. Scripted model, real database. No network.
 */
let tdb: TestDatabase;
let f: Fixture;
let n = 0;

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  // The queue is global across organizations: retire work left by earlier tests.
  await tdb.db.update(executionRuns).set({ status: "canceled" }).where(eq(executionRuns.status, "queued"));
  await tdb.db.update(tasks).set({ state: "canceled" }).where(and(eq(tasks.kind, "research"), eq(tasks.state, "assigned")));
  f = await createFixture(tdb.db, `live-org-${++n}`);
  await tdb.db.insert(agentPermissions).values(
    (["research.web_search", "research.web_fetch", "knowledge.write"] as const).map((permission) => ({ agentId: f.agents.research, permission, grantedBy: "test" })),
  );
  await tdb.db.update(agents).set({ modelProvider: "anthropic", modelName: "claude-opus-5-5" }).where(eq(agents.id, f.agents.research));
  const periodStart = monthStart(new Date());
  await tdb.db.insert(budgets).values([
    { organizationId: f.orgId, businessId: null, periodStart, limitMicros: 5_000_000 },
    { organizationId: f.orgId, businessId: f.bizA, periodStart, limitMicros: 5_000_000 },
  ]);
});

const usage = (searches = 0) => ({ input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 }, iterations: null });
const URL_ = "https://en.wikipedia.org/wiki/Hubble_Space_Telescope";
const goodScript = () => [
  {
    model: "claude-opus-5-5",
    stop_reason: "pause_turn",
    usage: usage(1),
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Hubble" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: URL_, title: "Hubble", encrypted_content: "x", page_age: null }] },
    ],
  },
  {
    model: "claude-opus-5-5",
    stop_reason: "tool_use",
    usage: usage(),
    content: [
      {
        type: "tool_use",
        id: "r1",
        name: "submit_report",
        input: { title: "Hubble overview", summary: "Test summary.", findings: [{ statement: "Hubble launched in 1990.", confidence: "high", source_ids: [1] }], uncertainties: ["Test uncertainty."], sources: [{ id: 1, title: "Hubble", url: URL_ }] },
      },
    ],
  },
];
const scripted = (script: unknown[]) => ({ create: async () => script.shift() ?? Promise.reject(new Error("script exhausted")) }) as unknown as Messages;

async function researchWorker(script: unknown[]) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "aehq-live-vault-"));
  const provider = createAnthropicProvider({ messages: () => scripted(script), status: () => ({ ready: true, keyConfigured: true, enabled: true, reason: "test" }) });
  return new ResearchWorker({
    db: tdb.db,
    knowledge: new KnowledgeService({ root: vault }),
    providers: () => provider,
    config: { effort: "medium", allowedDomains: ["wikipedia.org"], maxRunMicros: 1_000_000, maxSearches: 3, maxFetches: 1 },
    workerId: `live-w-${n}`,
    backoffBaseMs: 0,
  });
}

async function submitResearch() {
  const r = await createResearchTask(tdb.db, userCtx(f.orgId), { businessId: f.bizA, question: "When was the Hubble Space Telescope launched?" });
  return r.task.id;
}

const director = () => new LiveDirector({ plan: EXECUTIVE_FLOOR, looks: PROTOTYPE_CAST });

/** Reads SSE messages from a stream until `count` messages or the timeout. */
async function readMessages(stream: ReadableStream<Uint8Array>, count: number, timeoutMs = 3_000) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const out: { event: string; id: string | null; data: unknown }[] = [];
  const deadline = Date.now() + timeoutMs;
  while (out.length < count && Date.now() < deadline) {
    const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((res) => setTimeout(() => res({ done: true, value: undefined }), Math.max(1, deadline - Date.now())))]);
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
      if (!event) continue;
      out.push({ event, id: lines.find((l) => l.startsWith("id: "))?.slice(4) ?? null, data: JSON.parse(lines.find((l) => l.startsWith("data: "))!.slice(6)) });
    }
  }
  reader.releaseLock();
  return out;
}

// ---- storage ----------------------------------------------------------------------------

test("events store id, stream cursor, organization, agent, task, run and timestamp", async () => {
  const id = await submitResearch();
  await (await researchWorker(goodScript())).tick();
  const rows = await tdb.db.select().from(executionEvents).where(eq(executionEvents.taskId, id));
  assert.ok(rows.length >= 5);
  for (const r of rows) {
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    assert.equal(r.organizationId, f.orgId);
    assert.equal(r.agentId, f.agents.research);
    assert.equal(r.taskId, id);
    assert.ok(r.runId && r.occurredAt instanceof Date && r.streamId > 0);
  }
  const ids = rows.map((r) => r.streamId);
  assert.equal(new Set(ids).size, ids.length, "stream cursors are unique");
});

// ---- lifecycle events from the engine ---------------------------------------------------

test("approval requested/resolved, cancel and worker loss are recorded as real events; nothing is duplicated", async () => {
  const svc = new TaskService(tdb.db);
  const ctx = userCtx(f.orgId);
  const { task } = await svc.createTask(ctx, { title: "Test: publish", businessId: null, description: "Test.", requiresApproval: true });
  await svc.transition(ctx, task.id, { action: "assign", agentId: f.agents.pm });
  await svc.transition(ctx, task.id, { action: "start" });
  await svc.transition(ctx, task.id, { action: "wait", approval: { action: "Publish findings", reason: "Owner must approve" } });
  const detail = await svc.getTask(ctx, task.id);
  await svc.decideApproval(ctx, detail.approvals[0]!.id, "rejected");
  const types = (await tdb.db.select().from(executionEvents).where(eq(executionEvents.taskId, task.id))).sort((a, b) => a.sequence - b.sequence).map((e) => `${e.type}:${e.agentId === f.agents.pm}`);
  assert.deepEqual(types, ["approval.requested:true", "approval.resolved:true", "run.failed:true"]);

  // Cancel a running task.
  const t2 = (await svc.createTask(ctx, { title: "Test: cancel me", businessId: null, description: "Test." })).task;
  await svc.transition(ctx, t2.id, { action: "assign", agentId: f.agents.pm });
  await svc.transition(ctx, t2.id, { action: "start" });
  await svc.transition(ctx, t2.id, { action: "cancel", reason: "Not needed" });
  const [canceled] = await tdb.db.select().from(executionEvents).where(eq(executionEvents.taskId, t2.id));
  assert.equal(canceled!.type, "run.canceled");

  // Worker loss: the reaper records run.failed WORKER_LOST.
  const id = await submitResearch();
  let clock = Date.now();
  const queue = new ExecutionQueue(tdb.db, { now: () => new Date(clock), leaseMs: 1_000 });
  await queue.enqueueReady({ kinds: ["research"] });
  const claimed = (await queue.claim("dead-worker", { kinds: ["research"] }))!;
  assert.equal(claimed.task.id, id);
  await queue.recordEvent(claimed.run.id, "dead-worker", "run.started", { provider: "anthropic", model: "claude-opus-5-5" });
  clock += 5_000; // no heartbeats
  await queue.reapExpired();
  const evs = (await tdb.db.select().from(executionEvents).where(eq(executionEvents.runId, claimed.run.id))).sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(evs.map((e) => e.type), ["run.started", "run.failed"]);
  assert.equal((evs[1]!.payload as { errorCode: string }).errorCode, "WORKER_LOST");

  // A worker-reported failure is not duplicated by the engine.
  const id2 = await submitResearch();
  await (await researchWorker([])).tick(); // script exhausted → worker records run.failed itself
  const failed = await tdb.db.select().from(executionEvents).where(and(eq(executionEvents.taskId, id2), eq(executionEvents.type, "run.failed")));
  assert.equal(failed.length, 1);
});

test("the test-data seed records no execution events (no invented activity)", async () => {
  const fresh = await createTestDatabase();
  try {
    const { organizationId } = await seedTestData(fresh.db);
    const rows = await fresh.db.select().from(executionEvents).where(eq(executionEvents.organizationId, organizationId));
    assert.equal(rows.length, 0);
  } finally {
    await fresh.close();
  }
});

// ---- scoping ----------------------------------------------------------------------------

test("the feed shows only this organization's live events, within the caller's businesses", async () => {
  const id = await submitResearch();
  await (await researchWorker(goodScript())).tick();
  const all = await readEventsAfter(tdb.db, userCtx(f.orgId), 0, { limit: 1000 });
  assert.ok(all.some((e) => e.taskId === id));
  assert.ok(all.every((e) => e.origin === "live"));
  const other = await createFixture(tdb.db, `live-other-${n}`);
  assert.equal((await readEventsAfter(tdb.db, userCtx(other.orgId), 0)).length, 0, "other organizations see nothing");
  assert.equal((await readEventsAfter(tdb.db, userCtx(f.orgId, { businesses: [f.bizB], hq: false }), 0)).filter((e) => e.taskId === id).length, 0, "other businesses see nothing");
  // Test-origin events are never streamed.
  const [run] = await tdb.db.select().from(executionRuns).where(eq(executionRuns.taskId, id));
  await tdb.db.insert(executionEvents).values({ organizationId: f.orgId, agentId: f.agents.research, runId: run!.id, taskId: id, sequence: 999, type: "run.step", origin: "test", payload: {} });
  assert.ok((await readEventsAfter(tdb.db, userCtx(f.orgId), 0, { limit: 1000 })).every((e) => e.sequence !== 999));
  // Payloads are whitelisted (e.g. the Chief's full plan is never sent).
  assert.ok(all.every((e) => Object.values(e.payload).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))));
});

// ---- the stream: refresh, reconnect, replay ------------------------------------------------

test("stream: snapshot on connect, live events as they happen, replay after reconnect, snapshot on large gap", async () => {
  const id = await submitResearch();
  const ac = new AbortController();
  const stream = createLiveStream(tdb.db, userCtx(f.orgId), { signal: ac.signal, pollMs: 20, healthMs: 60_000 });
  const first = await readMessages(stream, 1);
  assert.equal(first[0]!.event, "snapshot");
  const snap = first[0]!.data as LiveSnapshot;
  assert.ok(snap.agents.some((a) => a.id === f.agents.research && a.workType === "research"));

  await (await researchWorker(goodScript())).tick();
  const live = await readMessages(stream, 6);
  ac.abort();
  const events = live.filter((m) => m.event === "agent-event").map((m) => m.data as LiveEvent);
  assert.deepEqual(events.slice(0, 3).map((e) => e.type), ["run.started", "run.step", "tool.called"]);
  assert.ok(events.every((e) => e.taskId === id && e.origin === "live"));
  assert.deepEqual(live.filter((m) => m.event === "agent-event").map((m) => Number(m.id)), events.map((e) => e.streamId), "SSE ids are the stream cursors");

  // Reconnect with Last-Event-ID = the 2nd event: the rest is replayed, nothing twice.
  const ac2 = new AbortController();
  const resumed = await readMessages(createLiveStream(tdb.db, userCtx(f.orgId), { lastEventId: events[1]!.streamId, signal: ac2.signal, pollMs: 20, healthMs: 60_000 }), 50, 600);
  ac2.abort();
  const replayed = resumed.filter((m) => m.event === "agent-event").map((m) => m.data as LiveEvent);
  assert.ok(replayed.length >= 3);
  assert.equal(replayed[0]!.streamId > events[1]!.streamId, true);
  assert.ok(replayed.every((e) => e.origin === "replay"));
  assert.ok(resumed.some((m) => m.event === "health"), "health follows a resume");

  // A cursor from the future (e.g. database reset) gets a fresh snapshot instead.
  const ac3 = new AbortController();
  const reset = await readMessages(createLiveStream(tdb.db, userCtx(f.orgId), { lastEventId: 10_000_000, signal: ac3.signal, pollMs: 20 }), 1);
  ac3.abort();
  assert.equal(reset[0]!.event, "snapshot");
});

test("stream: authentication is required (session or Bearer token with tasks:read)", async () => {
  const noSession = async () => null;
  const res = await handleLiveStream({ db: tdb.db, sessionContext: noSession }, new Request("http://localhost/api/v1/events/stream"));
  assert.equal(res.status, 401);
  const bad = await handleLiveStream({ db: tdb.db, sessionContext: noSession }, new Request("http://localhost/api/v1/events/stream", { headers: { authorization: "Bearer aehq_nope" } }));
  assert.equal(bad.status, 401);
  const { token } = await createApiToken(tdb.db, { organizationId: f.orgId, name: "t", principalKind: "user", scopes: ["tasks:write"], hqAccess: true });
  const noScope = await handleLiveStream({ db: tdb.db, sessionContext: noSession }, new Request("http://localhost/x", { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(noScope.status, 403);
  const { token: ok } = await createApiToken(tdb.db, { organizationId: f.orgId, name: "t2", principalKind: "user", scopes: ["tasks:read"], hqAccess: true });
  const ac = new AbortController();
  const good = await handleLiveStream({ db: tdb.db, sessionContext: noSession, streamOptions: { pollMs: 20 } }, new Request("http://localhost/x", { headers: { authorization: `Bearer ${ok}` }, signal: ac.signal }));
  assert.equal(good.status, 200);
  assert.match(good.headers.get("content-type") ?? "", /text\/event-stream/);
  const msgs = await readMessages(good.body!, 1);
  ac.abort();
  assert.equal(msgs[0]!.event, "snapshot");
});

// ---- end to end: real backend events drive the animation ------------------------------------

test("end to end: a real worker run drives the office - walk to the desk, work, complete; refresh shows the same", async () => {
  const id = await submitResearch();
  const d = director();
  d.applySnapshot(await loadSnapshot(tdb.db, userCtx(f.orgId)));
  const rt = d.getRuntime(f.agents.research)!;
  const desk = EXECUTIVE_FLOOR.waypoints.find((w) => w.id === "research.desk")!;
  assert.equal(String(rt.state), "idle", "before any run the agent rests");
  assert.notDeepEqual([rt.col, rt.row], [desk.tile.col, desk.tile.row]);

  const cursor = (await loadSnapshot(tdb.db, userCtx(f.orgId))).cursor;
  await (await researchWorker(goodScript())).tick();
  const events = await readEventsAfter(tdb.db, userCtx(f.orgId), cursor);
  assert.ok(events.length >= 5 && events.every((e) => e.taskId === id));

  // Feed the real events one by one, letting the browser animate in between.
  const seen: string[] = [];
  for (const e of events) {
    assert.equal(d.ingest(e), "applied");
    seen.push(`${e.type}→${rt.state}`);
    for (let i = 0; i < 200 && rt.state === "walking"; i++) d.tick(100);
  }
  assert.equal(seen[0], "run.started→walking", "the start sends the agent walking to its workstation");
  assert.ok(seen.includes("tool.called→working"), `working only after reported activity: ${seen.join(", ")}`);
  assert.equal(rt.state, "completed");
  assert.deepEqual([rt.col, rt.row], [desk.tile.col, desk.tile.row]);
  const view = d.getView(f.agents.research)!;
  assert.equal(view.live.phase, "completed");
  assert.match(view.live.notePath ?? "", /^businesses\/test-business-a\/reports\//, "output link comes from the real run.completed event");

  // Browser refresh: a new snapshot replays the run and lands on the same state instantly.
  const d2 = director();
  d2.applySnapshot(await loadSnapshot(tdb.db, userCtx(f.orgId)));
  const rt2 = d2.getRuntime(f.agents.research)!;
  assert.equal(rt2.state, "completed");
  assert.deepEqual([rt2.col, rt2.row], [desk.tile.col, desk.tile.row]);
  assert.ok((d2.getView(f.agents.research)!.run?.costMicros ?? 0) > 0, "cost comes from recorded usage");
  assert.equal(d2.getView(f.agents.research)!.task?.state, "completed");
});

test("end to end: approval and failure from the backend show as waiting-approval and failed", async () => {
  const svc = new TaskService(tdb.db);
  const ctx = userCtx(f.orgId);
  const d = director();
  d.applySnapshot(await loadSnapshot(tdb.db, ctx));
  const cursor = (await loadSnapshot(tdb.db, ctx)).cursor;

  // A research run that fails for a real reason (no budget left).
  await tdb.db.update(budgets).set({ limitMicros: 0 }).where(eq(budgets.organizationId, f.orgId));
  const id = await submitResearch();
  await (await researchWorker(goodScript())).tick();
  for (const e of await readEventsAfter(tdb.db, ctx, cursor)) {
    d.ingest(e);
    for (let i = 0; i < 200 && d.getRuntime(f.agents.research)!.state === "walking"; i++) d.tick(100);
  }
  assert.equal(d.getRuntime(f.agents.research)!.state, "failed");
  assert.equal(d.getView(f.agents.research)!.live.error?.code, "BUDGET_EXCEEDED");
  assert.equal((await tdb.db.select().from(tasks).where(eq(tasks.id, id)))[0]!.state, "failed");

  // The PM's task waits for approval (a real approval request).
  const t = (await svc.createTask(ctx, { title: "Test: needs approval", businessId: null, description: "Test.", requiresApproval: true })).task;
  await svc.transition(ctx, t.id, { action: "assign", agentId: f.agents.pm });
  await svc.transition(ctx, t.id, { action: "start" });
  const c2 = (await loadSnapshot(tdb.db, ctx)).cursor;
  await svc.transition(ctx, t.id, { action: "wait", approval: { action: "Send the summary", reason: "Owner sign-off" } });
  for (const e of await readEventsAfter(tdb.db, ctx, c2)) d.ingest(e);
  for (let i = 0; i < 200; i++) d.tick(100);
  const pm = d.getView(f.agents.pm)!;
  assert.equal(pm.state, "waiting-approval");
  assert.equal(pm.live.approval?.action, "Send the summary");
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { asc, eq, inArray } from "drizzle-orm";
import { executionEvents, executionRuns, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { ServiceError } from "../errors";
import { createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { TaskService } from "../tasks/service";
import { ExecutionQueue } from "./queue";

let tdb: TestDatabase;
let f: Fixture;
let svc: TaskService;
let queue: ExecutionQueue;
let clock: Date;
let n = 0;
const at = (s: string) => new Date(`2026-11-19T${s}.000Z`);

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  // The queue is global (workers serve every organization), so clear runs
  // left active by earlier tests.
  await tdb.db.update(executionRuns).set({ status: "canceled" }).where(inArray(executionRuns.status, ["queued", "running"]));
  clock = at("10:00:00");
  f = await createFixture(tdb.db, `queue-org-${++n}`);
  svc = new TaskService(tdb.db, { now: () => clock });
  queue = new ExecutionQueue(tdb.db, { now: () => clock, leaseMs: 60_000, backoffBaseMs: 30_000 });
});

async function assignedTask(over: Record<string, unknown> = {}) {
  const { task } = await svc.createTask(userCtx(f.orgId), { title: `Test job ${Math.random()}`, businessId: f.bizA, ...over });
  await svc.transition(userCtx(f.orgId), task.id, { action: "assign", agentId: f.agents.research });
  return task;
}
const runsOf = (taskId: string) => tdb.db.select().from(executionRuns).where(eq(executionRuns.taskId, taskId)).orderBy(asc(executionRuns.createdAt));
const taskRow = async (id: string) => (await tdb.db.select().from(tasks).where(eq(tasks.id, id)))[0]!;

test("enqueue is idempotent: one active run per task", async () => {
  const t = await assignedTask();
  const a = await queue.enqueue(t.id);
  const b = await queue.enqueue(t.id);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.run.id, b.run.id);
  assert.equal((await runsOf(t.id)).length, 1);
});

test("claim → heartbeat → complete", async () => {
  const t = await assignedTask();
  await queue.enqueue(t.id);
  const claimed = await queue.claim("worker-1");
  assert.ok(claimed);
  assert.equal(claimed.task.state, "running");
  assert.equal(claimed.run.status, "running");
  assert.equal(claimed.run.workerId, "worker-1");
  assert.equal(claimed.run.leaseExpiresAt?.toISOString(), "2026-11-19T10:01:00.000Z");
  assert.equal(await queue.claim("worker-2"), null, "nothing else to claim");

  clock = at("10:00:45");
  assert.equal(await queue.heartbeat(claimed.run.id, "worker-1"), true);
  assert.equal(await queue.heartbeat(claimed.run.id, "worker-2"), false, "only the owner can heartbeat");
  await queue.recordEvent(claimed.run.id, "worker-1", "run.step", { summary: "Test step" }, "test");
  await queue.recordEvent(claimed.run.id, "worker-1", "run.step", { summary: "Test step 2" }, "test");
  const done = await queue.complete(claimed.run.id, "worker-1", "Test result");
  assert.equal(done.state, "completed");
  const events = await tdb.db.select().from(executionEvents).where(eq(executionEvents.runId, claimed.run.id));
  assert.deepEqual(events.map((e) => e.sequence).sort(), [0, 1]);
  assert.ok(events.every((e) => e.origin === "test"));
});

test("dependencies gate enqueueReady", async () => {
  const dep = await assignedTask();
  const t = await assignedTask({ dependsOn: [dep.id] });
  assert.equal(await queue.enqueueReady({ organizationId: f.orgId }), 1, "only the dependency is ready");
  const c = await queue.claim("w");
  assert.equal(c?.task.id, dep.id);
  await queue.complete(c!.run.id, "w", "done");
  assert.equal(await queue.enqueueReady({ organizationId: f.orgId }), 1);
  assert.equal((await queue.claim("w"))?.task.id, t.id);
});

test("a retryable failure is retried with exponential backoff", async () => {
  const t = await assignedTask({ maxAttempts: 3 });
  await queue.enqueue(t.id);
  const c1 = await queue.claim("w");
  const afterFail = await queue.fail(c1!.run.id, "w", "Test: transient error");
  assert.equal(afterFail.state, "assigned", "back in line for another attempt");
  assert.equal(afterFail.attempt, 1);
  assert.equal(afterFail.lastError, "Test: transient error");

  assert.equal(await queue.claim("w"), null, "not available before the backoff");
  clock = at("10:00:30");
  const c2 = await queue.claim("w");
  assert.ok(c2, "available after 30s");
  assert.equal(c2.task.attempt, 2);
  await queue.fail(c2.run.id, "w", "Test: transient error");
  clock = at("10:01:29");
  assert.equal(await queue.claim("w"), null, "second backoff is 60s");
  clock = at("10:01:30");
  const c3 = await queue.claim("w");
  const final = await queue.fail(c3!.run.id, "w", "Test: still failing");
  assert.equal(final.state, "failed", "attempts exhausted");
  assert.equal(final.attempt, 3);
  assert.deepEqual((await runsOf(t.id)).map((r) => r.status), ["failed", "failed", "failed"]);
});

test("a non-retryable failure fails the task immediately", async () => {
  const t = await assignedTask({ maxAttempts: 5 });
  await queue.enqueue(t.id);
  const c = await queue.claim("w");
  const failed = await queue.fail(c!.run.id, "w", "Test: invalid input", { retryable: false });
  assert.equal(failed.state, "failed");
  assert.equal((await runsOf(t.id)).length, 1);
});

test("a dead worker's lease expires; the run times out and is retried", async () => {
  const t = await assignedTask();
  await queue.enqueue(t.id);
  const c = await queue.claim("worker-dead");
  clock = at("10:00:59");
  assert.equal(await queue.reapExpired(), 0, "lease still valid");
  clock = at("10:01:01");
  assert.equal(await queue.reapExpired(), 1);
  const row = await taskRow(t.id);
  assert.equal(row.state, "assigned");
  assert.match(row.lastError ?? "", /lease expired/);
  const runs = await runsOf(t.id);
  assert.deepEqual(runs.map((r) => r.status), ["timed_out", "queued"]);
  // The original worker wakes up late: it can no longer finish the run.
  await assert.rejects(queue.complete(c!.run.id, "worker-dead", "late"), (e: unknown) => e instanceof ServiceError && e.reason === "lease-lost");
  assert.equal(await queue.heartbeat(c!.run.id, "worker-dead"), false);
});

test("a run that exceeds the task timeout is timed out even while heartbeating", async () => {
  const t = await assignedTask({ timeoutSeconds: 90, maxAttempts: 1 });
  await queue.enqueue(t.id);
  const c = await queue.claim("w");
  clock = at("10:00:50");
  assert.equal(await queue.heartbeat(c!.run.id, "w"), true);
  clock = at("10:01:31");
  assert.equal(await queue.heartbeat(c!.run.id, "w"), false, "past the deadline");
  assert.equal(await queue.reapExpired(), 1);
  const row = await taskRow(t.id);
  assert.equal(row.state, "failed", "no attempts left");
  assert.match(row.lastError ?? "", /timeout/);
});

test("runs for tasks that moved on are discarded at claim time", async () => {
  const t = await assignedTask();
  await queue.enqueue(t.id);
  await svc.transition(userCtx(f.orgId), t.id, { action: "pause" });
  assert.equal(await queue.claim("w"), null);
  assert.deepEqual((await runsOf(t.id)).map((r) => r.status), ["canceled"]);
});

test("concurrent workers never claim the same run (real PostgreSQL)", async (t) => {
  if (!tdb.realPostgres) {
    t.skip("needs TEST_DATABASE_URL (PGlite is single-connection)");
    return;
  }
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const task = await assignedTask();
    await queue.enqueue(task.id);
    ids.push(task.id);
  }
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => queue.claim(`w${i}`).catch(() => null)));
  const claimed = results.filter((r) => r !== null);
  assert.equal(claimed.length, 5, "each run claimed exactly once");
  assert.equal(new Set(claimed.map((c) => c!.run.id)).size, 5);
});

test("concurrent enqueues create exactly one run (real PostgreSQL)", async (t) => {
  if (!tdb.realPostgres) {
    t.skip("needs TEST_DATABASE_URL");
    return;
  }
  const task = await assignedTask();
  await Promise.all(Array.from({ length: 8 }, () => queue.enqueue(task.id).catch(() => null)));
  assert.equal((await runsOf(task.id)).length, 1);
});

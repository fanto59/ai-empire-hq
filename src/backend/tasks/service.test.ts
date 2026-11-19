import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { approvalRequests, auditLogs, executionRuns, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { ServiceError } from "../errors";
import { agentCtx, createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { TaskService } from "./service";

let tdb: TestDatabase;
let f: Fixture;
let svc: TaskService;
let clock = new Date("2026-11-19T10:00:00.000Z");
let orgCounter = 0;

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  clock = new Date("2026-11-19T10:00:00.000Z");
  f = await createFixture(tdb.db, `test-org-${++orgCounter}`);
  svc = new TaskService(tdb.db, { now: () => clock });
});

const owner = () => userCtx(f.orgId);
const rejectsWith = async (p: Promise<unknown>, code: ServiceError["code"], reason?: string) =>
  assert.rejects(p, (e: unknown) => e instanceof ServiceError && e.code === code && (reason === undefined || e.reason === reason));

async function newTask(over: Record<string, unknown> = {}) {
  return (await svc.createTask(owner(), { title: "Test: market scan", businessId: f.bizA, projectId: f.projectA, ...over })).task;
}

// ---- creation -------------------------------------------------------------------

test("creates a queued task with defaults and an audit entry", async () => {
  const t = await newTask({ description: "Test description" });
  assert.equal(t.state, "queued");
  assert.equal(t.version, 1);
  assert.equal(t.attempt, 0);
  assert.equal(t.maxAttempts, 3);
  assert.equal(t.createdByKind, "user");
  const audit = await tdb.db.select().from(auditLogs).where(eq(auditLogs.targetId, t.id));
  assert.deepEqual(audit.map((a) => a.action), ["task.create"]);
});

test("task creation is idempotent per Idempotency-Key", async () => {
  const a = await svc.createTask(owner(), { title: "Test: once", businessId: f.bizA }, "test-key-0001");
  const b = await svc.createTask(owner(), { title: "Test: once", businessId: f.bizA }, "test-key-0001");
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.task.id, b.task.id);
  await rejectsWith(svc.createTask(owner(), { title: "x", businessId: f.bizA }, "bad key"), "invalid-input");
});

test("validates input and refuses secrets", async () => {
  await rejectsWith(svc.createTask(owner(), { title: "", businessId: f.bizA }), "invalid-input");
  await rejectsWith(svc.createTask(owner(), { title: "a\nb", businessId: f.bizA }), "invalid-input");
  await rejectsWith(svc.createTask(owner(), { title: "x", businessId: "not-a-uuid" }), "invalid-input");
  await rejectsWith(svc.createTask(owner(), { title: "x", businessId: f.bizA, priority: 9 }), "invalid-input");
  await rejectsWith(svc.createTask(owner(), { title: "x", businessId: f.bizB, projectId: f.projectA }), "invalid-input");
  await rejectsWith(svc.createTask(owner(), { title: "x", businessId: f.bizA, description: "api_key=sk-ant-abcdefghijklmnopqrstuvwxyz" }), "invalid-input");
});

test("business isolation: callers cannot see or create outside their businesses", async () => {
  const t = await newTask();
  const bOnly = userCtx(f.orgId, { businesses: [f.bizB], hq: false });
  await rejectsWith(svc.getTask(bOnly, t.id), "not-found");
  assert.equal((await svc.listTasks(bOnly)).length, 0);
  await rejectsWith(svc.createTask(bOnly, { title: "x", businessId: f.bizA }), "forbidden");
  await rejectsWith(svc.createTask(bOnly, { title: "x", businessId: null }), "forbidden");
  await rejectsWith(svc.transition(bOnly, t.id, { action: "cancel" }), "not-found");
  const otherOrg = await createFixture(tdb.db, `other-org-${orgCounter}`);
  await rejectsWith(svc.getTask(userCtx(otherOrg.orgId), t.id), "not-found");
});

test("scopes are enforced", async () => {
  const readOnly = userCtx(f.orgId, { scopes: new Set(["tasks:read"]) });
  await rejectsWith(svc.createTask(readOnly, { title: "x", businessId: f.bizA }), "forbidden");
  const t = await newTask();
  await rejectsWith(svc.transition(readOnly, t.id, { action: "cancel" }), "forbidden");
});

// ---- assignment -------------------------------------------------------------------

test("assigns an active agent from the same business with task.execute", async () => {
  const t = await newTask();
  const assigned = await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  assert.equal(assigned.state, "assigned");
  assert.equal(assigned.assigneeAgentId, f.agents.research);
  assert.equal(assigned.version, 2);
});

test("assignment guards: other business, disabled, missing permission, HQ mismatch", async () => {
  const t = await newTask();
  await rejectsWith(svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.ops }), "forbidden", "business-mismatch");
  await rejectsWith(svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.disabled }), "conflict", "agent-inactive");
  await rejectsWith(svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.noPerm }), "forbidden", "permission-missing");
  await rejectsWith(svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.chief }), "forbidden", "business-mismatch");
  await rejectsWith(svc.transition(owner(), t.id, { action: "assign" }), "invalid-input");
  const hq = (await svc.createTask(owner(), { title: "Test: HQ review", businessId: null })).task;
  assert.equal((await svc.transition(owner(), hq.id, { action: "assign", agentId: f.agents.chief })).state, "assigned");
});

// ---- transitions ---------------------------------------------------------------------

test("rejects invalid transitions and stale versions", async () => {
  const t = await newTask();
  await rejectsWith(svc.transition(owner(), t.id, { action: "complete" }), "invalid-transition");
  await rejectsWith(svc.transition(owner(), t.id, { action: "start" }), "invalid-transition");
  await rejectsWith(svc.transition(owner(), t.id, { action: "dance" as never }), "invalid-input");
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  await rejectsWith(svc.transition(owner(), t.id, { action: "start", expectedVersion: 1 }), "conflict", "version-mismatch");
  const started = await svc.transition(owner(), t.id, { action: "start", expectedVersion: 2 });
  assert.equal(started.state, "running");
});

test("dependencies must be completed before start", async () => {
  const dep = await newTask({ title: "Test: dependency" });
  const t = await newTask({ dependsOn: [dep.id] });
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  await rejectsWith(svc.transition(owner(), t.id, { action: "start" }), "conflict", "dependencies-incomplete");
  for (const action of ["assign", "start", "complete"] as const) {
    await svc.transition(owner(), dep.id, { action, agentId: action === "assign" ? f.agents.research : undefined });
  }
  assert.equal((await svc.transition(owner(), t.id, { action: "start" })).state, "running");
  const detail = await svc.getTask(owner(), t.id);
  assert.deepEqual(detail.dependencies.map((d) => d.state), ["completed"]);
});

test("completion: full lifecycle with a recorded run and history", async () => {
  const t = await newTask();
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  const agent = agentCtx(f.orgId, f.agents.research, f.bizA);
  await svc.transition(agent, t.id, { action: "start" });
  clock = new Date("2026-11-19T10:05:00.000Z");
  const done = await svc.transition(agent, t.id, { action: "complete", result: "Test result: 3 candidates." });
  assert.equal(done.state, "completed");
  assert.equal(done.attempt, 1);
  assert.equal(done.resultSummary, "Test result: 3 candidates.");
  assert.equal(done.finishedAt?.toISOString(), "2026-11-19T10:05:00.000Z");
  const detail = await svc.getTask(owner(), t.id);
  assert.deepEqual(detail.runs.map((r) => r.status), ["succeeded"]);
  assert.deepEqual(detail.history.map((h) => h.action), ["task.create", "task.assign", "task.start", "task.complete"]);
  assert.deepEqual(detail.availableActions, []);
  await rejectsWith(svc.transition(owner(), t.id, { action: "cancel" }), "invalid-transition");
});

test("approval-gated completion: wait → human approval → resume → complete", async () => {
  const t = await newTask({ requiresApproval: true });
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  const agent = agentCtx(f.orgId, f.agents.research, f.bizA);
  await svc.transition(agent, t.id, { action: "start" });
  await rejectsWith(svc.transition(agent, t.id, { action: "complete" }), "conflict", "approval-required");
  await svc.transition(agent, t.id, { action: "wait", approval: { action: "Publish findings", reason: "Test: needs owner sign-off" } });
  await rejectsWith(svc.transition(owner(), t.id, { action: "resume" }), "conflict", "approval-pending");
  const [approval] = await tdb.db.select().from(approvalRequests).where(eq(approvalRequests.taskId, t.id));
  await rejectsWith(svc.decideApproval({ ...agent, scopes: new Set(["approvals:decide"]) }, approval!.id, "approved"), "forbidden");
  await svc.decideApproval(owner(), approval!.id, "approved");
  await svc.transition(owner(), t.id, { action: "resume" });
  assert.equal((await svc.transition(agent, t.id, { action: "complete" })).state, "completed");
  const runs = await tdb.db.select().from(executionRuns).where(eq(executionRuns.taskId, t.id));
  assert.deepEqual(runs.map((r) => r.status).sort(), ["succeeded", "suspended"]);
});

test("a rejected approval fails the task", async () => {
  const t = await newTask({ requiresApproval: true });
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  await svc.transition(owner(), t.id, { action: "start" });
  await svc.transition(owner(), t.id, { action: "wait", approval: { action: "Spend", reason: "Test" } });
  const [approval] = await tdb.db.select().from(approvalRequests).where(eq(approvalRequests.taskId, t.id));
  const after = await svc.decideApproval(owner(), approval!.id, "rejected");
  assert.equal(after.state, "failed");
  assert.equal(after.lastError, "Approval was rejected.");
});

test("agents may only act on their own tasks with limited actions", async () => {
  const t = await newTask();
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  const other = agentCtx(f.orgId, f.agents.noPerm, f.bizA);
  await rejectsWith(svc.transition(other, t.id, { action: "start" }), "forbidden");
  const agent = agentCtx(f.orgId, f.agents.research, f.bizA);
  await rejectsWith(svc.transition(agent, t.id, { action: "cancel" }), "forbidden");
});

// ---- failure handling ------------------------------------------------------------------

test("failure: records the error, allows retry until attempts run out", async () => {
  const t = await newTask({ maxAttempts: 2 });
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  await svc.transition(owner(), t.id, { action: "start" });
  const failed = await svc.transition(owner(), t.id, { action: "fail", error: "Test: source unavailable" });
  assert.equal(failed.state, "failed");
  assert.equal(failed.lastError, "Test: source unavailable");
  assert.equal((await svc.transition(owner(), t.id, { action: "retry" })).state, "assigned");
  await svc.transition(owner(), t.id, { action: "start" });
  const failedAgain = await svc.transition(owner(), t.id, { action: "fail", error: "Test: still down" });
  assert.equal(failedAgain.attempt, 2);
  await rejectsWith(svc.transition(owner(), t.id, { action: "retry" }), "invalid-transition", "attempts-exhausted");
  const detail = await svc.getTask(owner(), t.id);
  assert.deepEqual(detail.runs.map((r) => r.status), ["failed", "failed"]);
  assert.deepEqual(detail.availableActions, []);
});

test("cancel ends active runs and expires pending approvals", async () => {
  const t = await newTask();
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  await svc.transition(owner(), t.id, { action: "start" });
  await svc.transition(owner(), t.id, { action: "wait", approval: { action: "x", reason: "Test" } });
  const canceled = await svc.transition(owner(), t.id, { action: "cancel", reason: "Test: no longer needed" });
  assert.equal(canceled.state, "canceled");
  const [approval] = await tdb.db.select().from(approvalRequests).where(eq(approvalRequests.taskId, t.id));
  assert.equal(approval!.status, "expired");
});

test("pause and resume", async () => {
  const t = await newTask();
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  await svc.transition(owner(), t.id, { action: "start" });
  assert.equal((await svc.transition(owner(), t.id, { action: "pause" })).state, "paused");
  assert.equal((await svc.transition(owner(), t.id, { action: "resume" })).state, "assigned");
});

test("audit logs are append-only at the database level", async () => {
  const t = await newTask();
  await assert.rejects(tdb.db.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.targetId, t.id)));
  await assert.rejects(tdb.db.delete(auditLogs).where(eq(auditLogs.targetId, t.id)));
  const [row] = await tdb.db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(eq(auditLogs.targetId, t.id));
  assert.equal(row!.n, 1);
});

test("the database rejects a second active run for a task", async () => {
  const t = await newTask();
  await svc.transition(owner(), t.id, { action: "assign", agentId: f.agents.research });
  await svc.transition(owner(), t.id, { action: "start" });
  await assert.rejects(
    tdb.db.insert(executionRuns).values({ taskId: t.id, attempt: 1, status: "queued", idempotencyKey: "test-dup" }),
  );
  const [row] = await tdb.db.select({ state: tasks.state }).from(tasks).where(eq(tasks.id, t.id));
  assert.equal(row!.state, "running");
});

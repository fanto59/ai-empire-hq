import assert from "node:assert/strict";
import { test } from "node:test";
import { TASK_ACTIONS, TASK_STATES, availableActions, isTerminal, planTransition, retryDelayMs, type TaskLifecycleView, type TaskState } from "./task-lifecycle";

const view = (state: TaskState, over: Partial<TaskLifecycleView> = {}): TaskLifecycleView => ({
  state,
  assigneeAgentId: "agent-1",
  attempt: 0,
  maxAttempts: 3,
  ...over,
});

test("the happy path: queued → assigned → running → completed", () => {
  assert.deepEqual(planTransition(view("queued"), "assign"), { ok: true, from: "queued", to: "assigned" });
  assert.deepEqual(planTransition(view("assigned"), "start"), { ok: true, from: "assigned", to: "running" });
  assert.deepEqual(planTransition(view("running"), "complete"), { ok: true, from: "running", to: "completed" });
});

test("terminal states accept no actions", () => {
  for (const s of ["completed", "canceled"] as const) assert.deepEqual(availableActions(view(s)), []);
  assert.ok(isTerminal(view("completed")));
  assert.ok(isTerminal(view("failed", { attempt: 3 })));
  assert.ok(!isTerminal(view("failed", { attempt: 1 })));
});

test("invalid transitions are rejected with a reason", () => {
  const r = planTransition(view("queued"), "complete");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.code === "invalid-transition" && r.message.includes("queued"));
  assert.equal(planTransition(view("completed"), "cancel").ok, false);
  assert.equal(planTransition(view("waiting"), "complete").ok, false);
});

test("start needs an assignee and remaining attempts", () => {
  assert.deepEqual(planTransition(view("assigned", { assigneeAgentId: null }), "start"), {
    ok: false,
    code: "no-assignee",
    message: "Assign the task before starting it.",
  });
  assert.equal(planTransition(view("assigned", { attempt: 3 }), "start").ok, false);
});

test("retry returns to assigned (or queued) only while attempts remain", () => {
  assert.deepEqual(planTransition(view("failed", { attempt: 1 }), "retry"), { ok: true, from: "failed", to: "assigned" });
  assert.deepEqual(planTransition(view("failed", { attempt: 1, assigneeAgentId: null }), "retry"), { ok: true, from: "failed", to: "queued" });
  const exhausted = planTransition(view("failed", { attempt: 3 }), "retry");
  assert.ok(!exhausted.ok && exhausted.code === "attempts-exhausted");
});

test("resume goes back to running from waiting, and to the right queue from paused", () => {
  assert.equal((planTransition(view("waiting"), "resume") as { to: string }).to, "running");
  assert.equal((planTransition(view("paused"), "resume") as { to: string }).to, "assigned");
  assert.equal((planTransition(view("paused", { assigneeAgentId: null }), "resume") as { to: string }).to, "queued");
});

test("every (state, action) pair yields a definite answer", () => {
  for (const s of TASK_STATES) {
    for (const a of TASK_ACTIONS) {
      const r = planTransition(view(s), a);
      if (r.ok) assert.ok(TASK_STATES.includes(r.to));
      else assert.ok(r.message.length > 0);
    }
  }
});

test("retry backoff grows exponentially and is capped", () => {
  assert.equal(retryDelayMs(1), 30_000);
  assert.equal(retryDelayMs(2), 60_000);
  assert.equal(retryDelayMs(3), 120_000);
  assert.equal(retryDelayMs(20), 30 * 60_000);
});

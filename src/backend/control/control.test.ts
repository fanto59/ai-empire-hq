import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { actionProposals, agentPermissions, auditLogs, budgets, executionRuns, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { BudgetExceededError, SpendGuard, monthStart } from "../budgets/spend-guard";
import { ExecutionQueue } from "../execution/queue";
import { TaskService } from "../tasks/service";
import { agentCtx, createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { withIdempotency } from "./common";
import { cancelAgentWork, cancelTask, pauseAgent, requestResumeNewWork, resumeAgent, setBudgetLimit, suspendNewWork } from "./operations";
import { approveProposal, executeProposal, hashPayload, proposeAction, rejectProposal, TOKEN_TTL_MS } from "./proposals";
import { errorReport, runHistory } from "./reports";

let tdb: TestDatabase;
let f: Fixture;
let n = 0;
const T0 = new Date("2026-11-20T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
let k = 0;
const key = () => `test-key-${n}-${++k}`;

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  // The queue is global: retire work left by earlier tests.
  await tdb.db.update(executionRuns).set({ status: "canceled" }).where(eq(executionRuns.status, "queued"));
  await tdb.db.update(tasks).set({ state: "canceled" }).where(eq(tasks.state, "assigned"));
  f = await createFixture(tdb.db, `control-${++n}`);
});

const owner = () => userCtx(f.orgId);
const run = (fn: () => Promise<import("@/domain/control").ControlResult>, k2 = key()) => withIdempotency(tdb.db, owner(), k2, "test", fn);

async function assignedTask(agentId = f.agents.pm, businessId: string | null = null) {
  const svc = new TaskService(tdb.db);
  const { task } = await svc.createTask(owner(), { title: "Test: control", businessId, description: "Test." });
  await svc.transition(owner(), task.id, { action: "assign", agentId });
  return task.id;
}

// ---- unauthorized requests ---------------------------------------------------------------------

test("unauthorized: agents, tokens without the permission, and limited tokens are refused - nothing changes", async () => {
  const agent = agentCtx(f.orgId, f.agents.research, f.bizA);
  const noScope = userCtx(f.orgId, { scopes: new Set(["tasks:read"]) });
  const limited = userCtx(f.orgId, { businesses: [f.bizA], hq: false });
  const attempts: [string, () => Promise<unknown>][] = [];
  for (const [name, ctx] of [["agent", agent], ["no-scope", noScope], ["limited", limited]] as const) {
    attempts.push([`${name} suspend`, () => suspendNewWork(tdb.db, ctx, "x")]);
    attempts.push([`${name} pause`, () => pauseAgent(tdb.db, ctx, f.agents.pm, "x")]);
    attempts.push([`${name} budget`, () => setBudgetLimit(tdb.db, ctx, { scope: { kind: "organization" }, usd: 0 })]);
    attempts.push([`${name} cancel`, () => cancelTask(tdb.db, ctx, "00000000-0000-0000-0000-000000000000", "x")]);
  }
  for (const [label, fn] of attempts) {
    const r = await withIdempotency(tdb.db, owner(), key(), "test", fn as never);
    assert.equal(r.accepted, false, label);
    assert.equal(r.code, "unauthorized", `${label}: ${r.message}`);
    assert.equal(r.auditId, null);
  }
  // Approvals and execution are people-only too.
  const p = await proposeAction(tdb.db, owner(), { kind: "external_message", summary: "Email the venue", payload: { to: "venue", text: "Hello" } });
  await assert.rejects(approveProposal(tdb.db, agent, p.id), /Only people/);
  await assert.rejects(approveProposal(tdb.db, noScope, p.id), /approvals:decide/);
  await assert.rejects(executeProposal(tdb.db, agent, { proposalId: p.id, token: "apv_x", payload: {} }), /Only people/);
  const [row] = await tdb.db.select().from(actionProposals).where(eq(actionProposals.id, p.id));
  assert.equal(row!.status, "pending");
});

// ---- approval tokens tied to the exact action ------------------------------------------------------

test("approval tokens: bound to the exact payload, single use; raising a budget needs one", async () => {
  const proposal = await setBudgetLimit(tdb.db, owner(), { scope: { kind: "organization" }, usd: 5 }, T0);
  assert.equal(proposal.accepted, true);
  assert.equal(proposal.code, "needs-approval");
  assert.equal((await tdb.db.select().from(budgets).where(eq(budgets.organizationId, f.orgId))).length, 0, "nothing changed yet");
  const [p] = await tdb.db.select().from(actionProposals).where(and(eq(actionProposals.organizationId, f.orgId), eq(actionProposals.kind, "budget_increase")));
  const payload = p!.payload as Record<string, unknown>;
  assert.equal(p!.payloadHash, hashPayload(payload));

  const approved = await approveProposal(tdb.db, owner(), p!.id, at(1000));
  assert.equal(approved.accepted, true);
  const token = approved.approvalToken!;
  assert.match(token, /^apv_/);
  const [stored] = await tdb.db.select().from(actionProposals).where(eq(actionProposals.id, p!.id));
  assert.ok(stored!.tokenHash && !stored!.tokenHash.includes(token), "only the token's hash is stored");

  const tampered = await executeProposal(tdb.db, owner(), { proposalId: p!.id, token, payload: { ...payload, toMicros: 500_000_000 } }, at(2000));
  assert.deepEqual([tampered.accepted, tampered.code], [false, "payload-mismatch"]);
  assert.ok(tampered.auditId, "refusals are audited");
  const wrongToken = await executeProposal(tdb.db, owner(), { proposalId: p!.id, token: `apv_${"A".repeat(43)}`, payload }, at(2000));
  assert.deepEqual([wrongToken.accepted, wrongToken.code], [false, "invalid-token"]);
  const ok = await executeProposal(tdb.db, owner(), { proposalId: p!.id, token, payload }, at(3000));
  assert.equal(ok.accepted, true, ok.message);
  const [b] = await tdb.db.select().from(budgets).where(eq(budgets.organizationId, f.orgId));
  assert.equal(b!.limitMicros, 5_000_000);
  await assert.rejects(executeProposal(tdb.db, owner(), { proposalId: p!.id, token, payload }, at(4000)), /already executed/);
  // Lowering applies immediately (safety-reducing).
  const lower = await setBudgetLimit(tdb.db, owner(), { scope: { kind: "organization" }, usd: 1 }, at(5000));
  assert.equal(lower.accepted, true);
  assert.ok(lower.auditId);
});

test("expired approvals: tokens expire after 15 minutes, pending proposals after 72 hours", async () => {
  const p = await proposeAction(tdb.db, owner(), { kind: "resume_new_work", summary: "Resume work", payload: { organizationId: f.orgId } }, T0);
  const { approvalToken } = await approveProposal(tdb.db, owner(), p.id, T0);
  const late = await executeProposal(tdb.db, owner(), { proposalId: p.id, token: approvalToken, payload: { organizationId: f.orgId } }, at(TOKEN_TTL_MS + 1));
  assert.deepEqual([late.accepted, late.code], [false, "expired"]);
  const [row] = await tdb.db.select().from(actionProposals).where(eq(actionProposals.id, p.id));
  assert.equal(row!.status, "expired", "the expiry is recorded, not just refused");

  const stale = await proposeAction(tdb.db, owner(), { kind: "external_message", summary: "Old idea", payload: { text: "x" } }, T0);
  const r = await approveProposal(tdb.db, owner(), stale.id, at(73 * 3_600_000));
  assert.deepEqual([r.accepted, r.code], [false, "expired"]);
  const rejected = await proposeAction(tdb.db, owner(), { kind: "external_message", summary: "Rejected idea", payload: { text: "y" } }, T0);
  await rejectProposal(tdb.db, owner(), rejected.id, at(10));
  await assert.rejects(approveProposal(tdb.db, owner(), rejected.id, at(20)), /already rejected/);
});

test("external actions (money, contracts, messages, publishing, deploys) never execute: no integration is connected", async () => {
  await tdb.db.insert(agentPermissions).values({ agentId: f.agents.chief, permission: "approval.request", grantedBy: "test" }).onConflictDoNothing();
  for (const kind of ["financial_transfer", "binding_commitment", "external_message", "public_publish", "production_deploy"]) {
    const payload = { description: `Test ${kind}`, amountMicros: 1_000_000 };
    const p = await proposeAction(tdb.db, agentCtx(f.orgId, f.agents.chief, f.bizA), { kind, summary: `Agent proposes ${kind}`, payload });
    assert.equal(p.proposedByKind, "agent", "agents may propose");
    const { approvalToken } = await approveProposal(tdb.db, owner(), p.id);
    const r = await executeProposal(tdb.db, owner(), { proposalId: p.id, token: approvalToken, payload });
    assert.deepEqual([r.accepted, r.code], [false, "no-integration"], kind);
    assert.match(r.message, /nothing was sent, paid, signed, published or deployed/);
  }
  assert.equal((await tdb.db.select().from(actionProposals).where(and(eq(actionProposals.organizationId, f.orgId), eq(actionProposals.status, "executed")))).length, 0);
});

// ---- duplicate actions ------------------------------------------------------------------------------

test("duplicate actions: a repeated request key applies nothing twice and says so", async () => {
  const k1 = key();
  const first = await run(() => pauseAgent(tdb.db, owner(), f.agents.pm, "Test"), k1);
  const second = await run(() => pauseAgent(tdb.db, owner(), f.agents.pm, "Test"), k1);
  assert.equal(first.accepted, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.auditId, first.auditId);
  const audits = await tdb.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, f.agents.pm), eq(auditLogs.action, "control.agent_paused")));
  assert.equal(audits.length, 1, "applied once");
  // A new request for the same state change is refused as a duplicate action.
  const again = await run(() => pauseAgent(tdb.db, owner(), f.agents.pm, "Test"));
  assert.deepEqual([again.accepted, again.code], [false, "duplicate"]);
  const s1 = await run(() => suspendNewWork(tdb.db, owner(), "Test"));
  const s2 = await run(() => suspendNewWork(tdb.db, owner(), "Test"));
  assert.deepEqual([s1.accepted, s2.accepted, s2.code], [true, false, "duplicate"]);
  const missing = await withIdempotency(tdb.db, owner(), undefined, "test", async () => {
    throw new Error("must not run");
  });
  assert.deepEqual([missing.accepted, missing.code], [false, "invalid-key"]);
});

// ---- budget exhaustion -------------------------------------------------------------------------------

test("budget exhaustion: per-agent and per-provider budgets stop calls when used up", async () => {
  const period = monthStart(new Date());
  await tdb.db.insert(budgets).values([
    { organizationId: f.orgId, periodStart: period, limitMicros: 10_000_000 },
    { organizationId: f.orgId, businessId: f.bizA, periodStart: period, limitMicros: 10_000_000 },
  ]);
  const guard = (provider: string) => new SpendGuard(tdb.db, { organizationId: f.orgId, businessId: f.bizA, agentId: f.agents.research, runId: null, provider, maxRunMicros: 10_000_000 });
  // Agent budget: $0.05; two $0.03 calls → the second is refused.
  await tdb.db.insert(budgets).values({ organizationId: f.orgId, agentId: f.agents.research, periodStart: period, limitMicros: 50_000 });
  const g = guard("anthropic");
  const r1 = await g.reserve(30_000);
  await g.settle(r1, { micros: 30_000, model: "m", inputTokens: 1, outputTokens: 1 });
  await assert.rejects(g.reserve(30_000), (e: unknown) => e instanceof BudgetExceededError && /This agent/.test(e.message));
  // Provider budget: xai capped at $0.01.
  await tdb.db.insert(budgets).values({ organizationId: f.orgId, provider: "xai", periodStart: period, limitMicros: 10_000 });
  await assert.rejects(guard("xai").reserve(20_000), (e: unknown) => e instanceof BudgetExceededError && /xai provider/.test(e.message));
  // Organization budget lowered to $0 from the control center: everything stops.
  const lowered = await setBudgetLimit(tdb.db, owner(), { scope: { kind: "organization" }, usd: 0 });
  assert.equal(lowered.accepted, true);
  await assert.rejects(guard("openai").reserve(1), (e: unknown) => e instanceof BudgetExceededError && /The organization/.test(e.message));
  const [agentBudget] = await tdb.db.select().from(budgets).where(eq(budgets.agentId, f.agents.research));
  assert.equal(agentBudget!.spentMicros, 30_000, "refused reservations leave no trace");
});

// ---- emergency suspension, pause and cancel --------------------------------------------------------------

test("emergency suspension stops new work everywhere; lifting it needs an approved proposal", async () => {
  const taskId = await assignedTask();
  const queue = new ExecutionQueue(tdb.db);
  await queue.enqueueReady({ organizationId: f.orgId });
  assert.equal((await suspendNewWork(tdb.db, owner(), "Test incident")).accepted, true);
  assert.equal(await queue.claim("w-test"), null, "workers claim nothing while suspended");
  await assert.rejects(new TaskService(tdb.db).transition(owner(), taskId, { action: "start" }), /suspended/);

  const resume = await requestResumeNewWork(tdb.db, owner());
  assert.equal(resume.code, "needs-approval");
  assert.equal(await queue.claim("w-test"), null, "still suspended until executed");
  const [p] = await tdb.db.select().from(actionProposals).where(and(eq(actionProposals.organizationId, f.orgId), eq(actionProposals.kind, "resume_new_work")));
  const { approvalToken } = await approveProposal(tdb.db, owner(), p!.id);
  const done = await executeProposal(tdb.db, owner(), { proposalId: p!.id, token: approvalToken, payload: p!.payload });
  assert.equal(done.accepted, true);
  const claimed = await queue.claim("w-test");
  assert.equal(claimed?.task.id, taskId);
});

test("pausing an agent holds its queued work; canceling stops running work at the next heartbeat", async () => {
  const taskId = await assignedTask();
  const queue = new ExecutionQueue(tdb.db);
  await queue.enqueueReady({ organizationId: f.orgId });
  await pauseAgent(tdb.db, owner(), f.agents.pm, "Test");
  assert.equal(await queue.claim("w-test"), null, "a paused agent's work does not start");
  await resumeAgent(tdb.db, owner(), f.agents.pm);
  const claimed = await queue.claim("w-test");
  assert.equal(claimed?.task.id, taskId);
  assert.equal(await queue.heartbeat(claimed!.run.id, "w-test"), true);
  const r = await cancelAgentWork(tdb.db, owner(), f.agents.pm, "Stop now");
  assert.equal(r.accepted, true);
  assert.equal(await queue.heartbeat(claimed!.run.id, "w-test"), false, "the worker learns it must stop");
  const [t] = await tdb.db.select().from(tasks).where(eq(tasks.id, taskId));
  assert.equal(t!.state, "canceled");
  const nothing = await run(() => cancelAgentWork(tdb.db, owner(), f.agents.pm, "again"));
  assert.deepEqual([nothing.accepted, nothing.code], [false, "nothing-to-do"]);
});

test("reports: execution history and grouped errors come from stored runs and events", async () => {
  const taskId = await assignedTask();
  const queue = new ExecutionQueue(tdb.db);
  await queue.enqueueReady({ organizationId: f.orgId });
  const c = (await queue.claim("w-r"))!;
  await queue.recordEvent(c.run.id, "w-r", "run.failed", { errorCode: "BUDGET_EXCEEDED", message: "Spending limit reached" });
  await queue.fail(c.run.id, "w-r", "Spending limit reached", { retryable: false });
  const hist = await runHistory(tdb.db, f.orgId);
  assert.equal(hist[0]!.taskId, taskId);
  assert.equal(hist[0]!.status, "failed");
  const errors = await errorReport(tdb.db, f.orgId);
  assert.deepEqual([errors[0]!.code, errors[0]!.count], ["BUDGET_EXCEEDED", 1]);
  assert.equal((await tdb.db.select().from(auditLogs).where(like(auditLogs.action, "control.%"))).every((a) => a.actorKind === "user"), true);
});

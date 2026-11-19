import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, sql } from "drizzle-orm";
import { CHIEF_TOOLS, MAX_WORK_REQUESTS } from "@/agents/chief/tools";
import { validatePlan } from "@/agents/chief/plan";
import { createAnthropicProvider, type Messages } from "@/agents/providers/anthropic";
import {
  agentPermissions,
  agents,
  agentTaskContexts,
  approvalRequests,
  auditLogs,
  budgets,
  executionEvents,
  executionRuns,
  tasks,
} from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { agentCtx, createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { monthStart } from "../budgets/spend-guard";
import { ServiceError } from "../errors";
import { KnowledgeService, ownerContext } from "../knowledge";
import { createExecutiveTask } from "../tasks/executive";
import { TaskService } from "../tasks/service";
import { ChiefToolbox } from "./chief-toolbox";
import { ChiefWorker } from "./chief-worker";

/**
 * Chief AI Manager: permission boundaries and execution, against a real
 * database and vault with a SCRIPTED model (no network, no cost).
 */
let tdb: TestDatabase;
let vault: string;
let knowledge: KnowledgeService;
let f: Fixture;
let n = 0;

const usage = { input_tokens: 1500, output_tokens: 250, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, iterations: null };
const toolUse = (id: string, name: string, input: unknown) => ({ model: "claude-opus-5-5", stop_reason: "tool_use", usage, content: [{ type: "tool_use", id, name, input }] });
const PLAN = {
  objective: "Grow Test Business A responsibly.",
  summary: "Test summary.",
  priorities: [{ rank: 1, title: "Finish the market scan", rationale: "It unblocks other work.", business: "Test Business A" }],
  opportunities: ["Test opportunity."],
  risks: [{ risk: "Test risk.", severity: "medium", mitigation: "Test mitigation." }],
  execution_plan: [
    { step: 1, owner: "central-project-manager", action: "Schedule the remaining research tasks.", needs_owner_approval: false },
    { step: 2, owner: "owner", action: "Approve a $5 research budget for next month.", needs_owner_approval: false },
  ],
  decisions_for_owner: ["Approve next month's research budget."],
  recommendation: "Complete the market scan before starting new projects.",
};

function scripted(script: unknown[], seen?: unknown[][]): Messages {
  return {
    create: async (params: { messages: unknown[] }) => {
      seen?.push(structuredClone(params.messages));
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error("script exhausted");
      return structuredClone(next);
    },
  } as unknown as Messages;
}

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  // The queue is global across organizations: retire work left by earlier tests.
  await tdb.db.update(executionRuns).set({ status: "canceled" }).where(eq(executionRuns.status, "queued"));
  await tdb.db.update(tasks).set({ state: "canceled" }).where(and(eq(tasks.kind, "executive"), eq(tasks.state, "assigned")));
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "aehq-chief-vault-"));
  knowledge = new KnowledgeService({ root: vault });
  f = await createFixture(tdb.db, `chief-org-${++n}`);
  await tdb.db.insert(agentPermissions).values(
    (["org.read", "task.request", "knowledge.write"] as const).map((permission) => ({ agentId: f.agents.chief, permission, grantedBy: "test" })),
  );
  await tdb.db.insert(budgets).values({ organizationId: f.orgId, businessId: null, periodStart: monthStart(new Date()), limitMicros: 5_000_000 });
  // These tests script Claude responses: assign the Chief to Claude.
  await tdb.db.update(agents).set({ modelProvider: "anthropic", modelName: "claude-opus-5-5" }).where(eq(agents.id, f.agents.chief));
});

const worker = (messages: () => Messages) => {
  const anthropic = createAnthropicProvider({ messages, status: () => ({ ready: true, keyConfigured: true, enabled: true, reason: "test" }) });
  const providers = (id: "anthropic" | "openai" | "xai") => {
    if (id !== "anthropic") throw new Error(`provider ${id} must not be used`);
    return anthropic;
  };
  return new ChiefWorker({ db: tdb.db, knowledge, providers, config: { effort: "medium", maxRunMicros: 1_000_000 }, workerId: `chief-${n}`, backoffBaseMs: 0 });
};
const taskRow = async (id: string) => (await tdb.db.select().from(tasks).where(eq(tasks.id, id)))[0]!;
const toolbox = (taskId: string, canRequestWork = true) =>
  new ChiefToolbox(tdb.db, knowledge, { organizationId: f.orgId, chiefAgentId: f.agents.chief, chiefSlug: "test-chief", executiveTaskId: taskId, canRequestWork, now: () => new Date() });
async function objective(goal = "Review the organization and propose how to grow Test Business A this quarter.") {
  const r = await createExecutiveTask(tdb.db, userCtx(f.orgId), goal);
  assert.equal(r.task.state, "assigned", r.note);
  return r.task.id;
}

// ---- the tool surface ----------------------------------------------------------

test("the Chief's tools contain no way to approve, spend, sign, change permissions or decide approvals", () => {
  const names = CHIEF_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_budget_status",
    "get_task",
    "list_businesses",
    "list_projects",
    "list_reports",
    "list_tasks",
    "read_report",
    "request_work_from_project_manager",
    "submit_plan",
  ]);
  for (const n of names) assert.doesNotMatch(n, /approve|decide|set_|grant|permission|contract|sign|spend|pay|delete|update|assign|bash|shell|sql|exec/);
  assert.ok(CHIEF_TOOLS.every((t) => t.inputSchema.additionalProperties === false), "all tool inputs are strict schemas (adapters send them as strict tools)");
});

// ---- end to end ------------------------------------------------------------------

test("objective → reads records → requests work → plan, events, cost, briefing → completed", async () => {
  const id = await objective();
  await worker(() =>
    scripted([
      toolUse("t1", "list_tasks", { state: null, business_id: null }),
      toolUse("t2", "request_work_from_project_manager", { title: "Prepare Q1 roadmap", description: "Draft the Q1 roadmap for Test Business A.", business_id: f.bizA, priority: 2 }),
      toolUse("t3", "submit_plan", PLAN),
    ]),
  ).tick();

  const t = await taskRow(id);
  assert.equal(t.state, "completed", t.lastError ?? "");
  assert.match(t.resultSummary ?? "", /Complete the market scan/);

  const events = await tdb.db.select().from(executionEvents).where(eq(executionEvents.taskId, id)).orderBy(asc(executionEvents.occurredAt), asc(executionEvents.sequence));
  assert.deepEqual(
    events.map((e) => e.type),
    ["run.started", "run.step", "tool.called", "tool.result", "run.step", "tool.called", "tool.result", "run.step", "run.completed"],
  );
  const done = events.at(-1)!.payload as { plan: typeof PLAN; costMicros: number; notePath: string };
  assert.equal(done.plan.recommendation, PLAN.recommendation);
  assert.ok(done.costMicros > 0, "cost recorded");
  assert.equal(done.plan.execution_plan[1]!.needs_owner_approval, true, "spending step forced to need owner approval");

  // The requested work: general (never executed by a worker), needs owner approval, routed to the PM.
  const [requested] = await tdb.db.select().from(tasks).where(sql`${tasks.title} like 'Requested by Chief AI Manager:%' and ${tasks.organizationId} = ${f.orgId}`);
  assert.equal(requested!.kind, "general");
  assert.equal(requested!.requiresApproval, true);
  assert.equal(requested!.assigneeAgentId, f.agents.pm);

  const note = await knowledge.readNote(ownerContext(), done.notePath);
  assert.match(note.path, /^hq\/reports\//);
  assert.deepEqual(note.meta.tasks, [id]);
  assert.match(note.body, /Decisions for the owner/);
});

// ---- permission boundaries -----------------------------------------------------------

test("forbidden actions are refused and logged, and nothing changes", async () => {
  const id = await objective();
  // A pending approval and the current budget/permissions, to prove they stay untouched.
  const other = (await new TaskService(tdb.db).createTask(userCtx(f.orgId), { title: "Test: gated", businessId: f.bizA, requiresApproval: true })).task;
  const owner = userCtx(f.orgId);
  const svc = new TaskService(tdb.db);
  await svc.transition(owner, other.id, { action: "assign", agentId: f.agents.research });
  await svc.transition(owner, other.id, { action: "start" });
  await svc.transition(owner, other.id, { action: "wait", approval: { action: "Spend", reason: "Test" } });
  const before = {
    budget: (await tdb.db.select().from(budgets).where(eq(budgets.organizationId, f.orgId)))[0]!.limitMicros,
    perms: (await tdb.db.select({ n: sql<number>`count(*)::int` }).from(agentPermissions))[0]!.n,
  };

  const attempts = ["approve_spending", "set_budget", "grant_permission", "decide_approval", "execute_contract", "bash"];
  await worker(() => scripted([...attempts.map((name, i) => toolUse(`x${i}`, name, {})), toolUse("p", "submit_plan", PLAN)])).tick();

  assert.equal((await taskRow(id)).state, "completed");
  const denied = await tdb.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, id), eq(auditLogs.action, "agent.tool.denied")));
  assert.deepEqual(denied.map((d) => (d.metadata as { tool: string }).tool).sort(), [...attempts].sort());
  const [approval] = await tdb.db.select().from(approvalRequests).where(eq(approvalRequests.taskId, other.id));
  assert.equal(approval!.status, "pending");
  assert.equal((await tdb.db.select().from(budgets).where(eq(budgets.organizationId, f.orgId)))[0]!.limitMicros, before.budget);
  assert.equal((await tdb.db.select({ n: sql<number>`count(*)::int` }).from(agentPermissions))[0]!.n, before.perms);
});

test("the Chief's identity cannot approve, assign or drive other tasks through the task service", async () => {
  const other = (await new TaskService(tdb.db).createTask(userCtx(f.orgId), { title: "Test: someone else's", businessId: f.bizA })).task;
  const chief = { ...agentCtx(f.orgId, f.agents.chief, f.bizA), businesses: "*" as const, hq: true };
  const rejects = (p: Promise<unknown>) => assert.rejects(p, (e: unknown) => e instanceof ServiceError && e.code === "forbidden");
  await rejects(new TaskService(tdb.db).transition(chief, other.id, { action: "assign", agentId: f.agents.research }));
  await rejects(new TaskService(tdb.db).transition(chief, other.id, { action: "cancel" }));
  await rejects(new TaskService(tdb.db).decideApproval({ ...chief, scopes: new Set(["approvals:decide"]) }, "00000000-0000-4000-8000-000000000000", "approved"));
});

test("read tools are read-only", async () => {
  const id = await objective();
  const snapshot = async () => JSON.stringify(await tdb.db.select({ id: tasks.id, v: tasks.version, s: tasks.state }).from(tasks).orderBy(asc(tasks.id)));
  const before = await snapshot();
  const tb = toolbox(id);
  for (const [name, input] of [
    ["list_businesses", {}],
    ["list_projects", { business_id: null }],
    ["list_tasks", { state: "assigned", business_id: null }],
    ["get_task", { task_id: id }],
    ["list_reports", { business_id: null }],
    ["get_budget_status", {}],
  ] as const) {
    const r = await tb.execute(name, input);
    assert.equal(r.ok, true, `${name}: ${r.content}`);
  }
  assert.equal(await snapshot(), before);
});

test("restricted notes stay hidden from the Chief", async () => {
  const id = await objective();
  const note = await knowledge.createNote(ownerContext(), { kind: "report", business: null, title: "Owner-only memo", body: "Private.", confidentiality: "restricted" });
  const tb = toolbox(id);
  const list = await tb.execute("list_reports", { business_id: null });
  assert.ok(!list.content.includes("Owner-only memo"));
  const read = await tb.execute("read_report", { path: note.path });
  assert.equal(read.ok, false);
});

test("work requests: bounded, idempotent, always general + approval-gated, and need task.request", async () => {
  const id = await objective();
  await tdb.db.insert(agentTaskContexts).values({ taskId: id, agentId: f.agents.chief, messages: [] });
  const tb = toolbox(id);
  const req = (title: string, extra: Record<string, unknown> = {}) =>
    tb.execute("request_work_from_project_manager", { title, description: "Test request description.", business_id: null, priority: 3, ...extra });

  assert.equal((await req("Same title")).ok, true);
  assert.match((await req("Same title")).summary, /already requested/);
  const bad = await req("Bad business", { business_id: "not-an-id" });
  assert.equal(bad.ok, false);
  for (let i = 2; i <= MAX_WORK_REQUESTS; i++) assert.equal((await req(`Request ${i}`)).ok, true);
  const over = await req("One too many");
  assert.equal(over.ok, false);
  assert.match(over.content, /limit/);

  const created = await tdb.db.select().from(tasks).where(sql`${tasks.title} like 'Requested by Chief AI Manager:%' and ${tasks.organizationId} = ${f.orgId}`);
  assert.equal(created.length, MAX_WORK_REQUESTS);
  assert.ok(created.every((t) => t.kind === "general" && t.requiresApproval && t.assigneeAgentId === f.agents.pm));

  const noPerm = await toolbox(id, false).execute("request_work_from_project_manager", { title: "x", description: "Test request description.", business_id: null, priority: 3 });
  assert.equal(noPerm.ok, false);
});

test("only an active HQ Chief AI Manager with org.read can execute objectives", async () => {
  // Assigned to the Central PM (an HQ agent with task.execute) - refused.
  const r = await new TaskService(tdb.db).createTask(userCtx(f.orgId), { title: "Objective: x", kind: "executive", businessId: null, description: "Plan the next quarter for the test org." });
  await new TaskService(tdb.db).transition(userCtx(f.orgId), r.task.id, { action: "assign", agentId: f.agents.pm });
  let calls = 0;
  await worker(() => ({ create: async () => (calls++, toolUse("p", "submit_plan", PLAN)) }) as unknown as Messages).tick();
  assert.equal((await taskRow(r.task.id)).state, "failed");
  assert.match((await taskRow(r.task.id)).lastError ?? "", /only be executed by the active, headquarters-level Chief AI Manager/);
  assert.equal(calls, 0, "no model call was made");

  // Executive objectives are HQ tasks: a business-scoped agent cannot even be assigned.
  await assert.rejects(new TaskService(tdb.db).createTask(userCtx(f.orgId), { title: "x", kind: "executive", businessId: f.bizA, description: "A business objective." }), /headquarters tasks/);

  // Without org.read the Chief is refused too.
  await tdb.db.delete(agentPermissions).where(and(eq(agentPermissions.agentId, f.agents.chief), eq(agentPermissions.permission, "org.read")));
  const id = (await new TaskService(tdb.db).createTask(userCtx(f.orgId), { title: "Objective: y", kind: "executive", businessId: null, description: "Another objective for testing." })).task.id;
  await new TaskService(tdb.db).transition(userCtx(f.orgId), id, { action: "assign", agentId: f.agents.chief });
  await worker(() => scripted([toolUse("p", "submit_plan", PLAN)])).tick();
  assert.match((await taskRow(id)).lastError ?? "", /org\.read/);
});

test("persistent task context: a retried attempt resumes the saved conversation", async () => {
  const id = await objective();
  const overloaded = new Anthropic.InternalServerError(529, { type: "overloaded_error" }, "Overloaded", new Headers());
  await worker(() => scripted([toolUse("t1", "list_businesses", {}), overloaded])).tick();
  let t = await taskRow(id);
  assert.equal(t.state, "assigned", "transient failure → retry");
  const [ctx] = await tdb.db.select().from(agentTaskContexts).where(eq(agentTaskContexts.taskId, id));
  const saved = ctx!.messages as { session: { provider: string; history: unknown[] }; pending: { toolResults?: unknown[] } };
  assert.equal(saved.session.provider, "anthropic");
  assert.equal(saved.session.history.length, 2, "objective + assistant tool call saved");
  assert.equal(saved.pending.toolResults?.length, 1, "the tool result waiting to be sent is saved too");

  const seen: unknown[][] = [];
  await worker(() => scripted([toolUse("p", "submit_plan", PLAN)], seen)).tick();
  t = await taskRow(id);
  assert.equal(t.state, "completed");
  assert.equal(seen[0]!.length, 3, "the second attempt started from the saved context, not from scratch");
  const events = await tdb.db.select({ type: executionEvents.type, payload: executionEvents.payload }).from(executionEvents).where(eq(executionEvents.taskId, id));
  assert.ok(events.some((e) => (e.payload as { summary?: string }).summary === "Resuming from saved task context."));
});

test("no organization budget means no Chief activity", async () => {
  await tdb.db.update(budgets).set({ limitMicros: 0 }).where(eq(budgets.organizationId, f.orgId));
  const id = await objective();
  let calls = 0;
  await worker(() => ({ create: async () => (calls++, toolUse("p", "submit_plan", PLAN)) }) as unknown as Messages).tick();
  assert.equal(calls, 0);
  assert.match((await taskRow(id)).lastError ?? "", /Spending limit reached/);
});

test("plan guardrail: steps about spending, contracts, permissions or approvals always need the owner", () => {
  const plan = validatePlan({
    ...PLAN,
    execution_plan: [
      { step: 1, owner: "chief-ai-manager", action: "Sign the vendor contract", needs_owner_approval: false },
      { step: 2, owner: "central-project-manager", action: "Grant the research agent new permissions", needs_owner_approval: false },
      { step: 3, owner: "central-project-manager", action: "Write the weekly summary", needs_owner_approval: false },
    ],
  });
  assert.deepEqual(plan.execution_plan.map((s) => s.needs_owner_approval), [true, true, false]);
});

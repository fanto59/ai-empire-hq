import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { BUSINESS_TOOLS } from "@/agents/business/tools";
import { createAnthropicProvider, type Messages } from "@/agents/providers/anthropic";
import { actionProposals, agentPermissions, agents, auditLogs, budgets, executionEvents, executionRuns, modelUsage, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { monthStart } from "../budgets/spend-guard";
import { KnowledgeService, ownerContext } from "../knowledge";
import { assignWork, listAssignableAgents } from "../tasks/assignments";
import { TaskService } from "../tasks/service";
import { BusinessToolbox } from "./business-toolbox";
import { BusinessWorker } from "./business-worker";

/**
 * Sector & business agents: scope, safety and execution against a real
 * database and vault, with a SCRIPTED model (no network, no cost).
 */
let tdb: TestDatabase;
let vault: string;
let knowledge: KnowledgeService;
let f: Fixture;
let lead: string;
let manager: string;
let n = 0;

const usage = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, iterations: null };
const toolUse = (id: string, name: string, input: unknown) => ({ model: "claude-opus-5-5", stop_reason: "tool_use", usage, content: [{ type: "tool_use", id, name, input }] });
const RESULT = {
  summary: "Drafted a checklist for the next event based on the profile.",
  deliverable_markdown: "## Event checklist\n\n- Confirm the date (not in the profile yet)\n- Confirm the venue",
  next_steps: ["Owner fills in the venue list."],
  open_questions: ["Which venue is booked?"],
};

function scripted(script: unknown[], calls?: { n: number }): Messages {
  return {
    create: async () => {
      if (calls) calls.n++;
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
  await tdb.db.update(executionRuns).set({ status: "canceled" }).where(eq(executionRuns.status, "queued"));
  await tdb.db.update(tasks).set({ state: "canceled" }).where(and(eq(tasks.kind, "business"), eq(tasks.state, "assigned")));
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "aehq-biz-vault-"));
  knowledge = new KnowledgeService({ root: vault });
  f = await createFixture(tdb.db, `biz-org-${++n}`);
  const rows = await tdb.db
    .insert(agents)
    .values([
      { organizationId: f.orgId, businessId: f.bizA, slug: "test-lead-a", displayName: "Test Lead A", role: "business-lead", status: "active", modelProvider: "anthropic", modelName: "claude-opus-5-5" },
      { organizationId: f.orgId, sectorId: f.sectorId, slug: "test-sector-mgr", displayName: "Test Sector Manager", role: "sector-manager", status: "active", modelProvider: "anthropic", modelName: "claude-opus-5-5" },
    ])
    .returning();
  lead = rows[0]!.id;
  manager = rows[1]!.id;
  await tdb.db.insert(agentPermissions).values(
    [lead, manager].flatMap((agentId) =>
      (["task.read", "task.execute", "knowledge.read", "knowledge.write", "approval.request"] as const).map((permission) => ({ agentId, permission, grantedBy: "test" })),
    ),
  );
  const period = monthStart(new Date());
  await tdb.db.insert(budgets).values([
    { organizationId: f.orgId, periodStart: period, limitMicros: 5_000_000 },
    { organizationId: f.orgId, businessId: f.bizA, periodStart: period, limitMicros: 2_000_000 },
  ]);
  await knowledge.createNote(ownerContext(), { kind: "business", business: "test-business-a", title: "Test Business A", body: "## What we do\nTest: weekend events." });
  await knowledge.createNote(ownerContext(), { kind: "business", business: "test-business-b", title: "Test Business B", body: "## What we do\nTest: SECRET-B plans." });
});

const worker = (messages: () => Messages) => {
  const anthropic = createAnthropicProvider({ messages, status: () => ({ ready: true, keyConfigured: true, enabled: true, reason: "test" }) });
  const providers = (id: "anthropic" | "openai" | "xai") => {
    if (id !== "anthropic") throw new Error(`provider ${id} must not be used`);
    return anthropic;
  };
  return new BusinessWorker({ db: tdb.db, knowledge, providers, config: { effort: "medium", maxRunMicros: 1_000_000 }, workerId: `biz-${n}`, backoffBaseMs: 0 });
};
const taskRow = async (id: string) => (await tdb.db.select().from(tasks).where(eq(tasks.id, id)))[0]!;
const assign = async (agentId: string, instructions = "Draft a checklist for our next event.", businessId?: string) =>
  (await assignWork(tdb.db, userCtx(f.orgId), { agentId, instructions, businessId })).task.id;

// ---- tool surface ----------------------------------------------------------------

test("business agents have no web, shell, messaging, spending or approval tools", () => {
  const names = BUSINESS_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_business_profile", "get_task", "list_notes", "list_projects", "list_tasks", "propose_outside_action", "read_note", "save_draft_note", "submit_result"]);
  for (const name of names) assert.doesNotMatch(name, /web|search|fetch|bash|shell|sql|exec|send|email|pay|approve|decide|budget|permission|assign|publish|deploy/);
  assert.ok(BUSINESS_TOOLS.every((t) => t.inputSchema.additionalProperties === false));
});

test("owner assignments to sector managers and business leads become runnable business work", async () => {
  const list = await listAssignableAgents(tdb.db, f.orgId);
  const cap = Object.fromEntries(list.map((a) => [a.slug, a.capability]));
  assert.equal(cap["test-lead-a"], "runs-work");
  assert.equal(cap["test-sector-mgr"], "runs-work");
  assert.equal(cap["test-pm"], "tracked-only", "the Central PM is not run by this worker");
  const t = await taskRow(await assign(lead));
  assert.equal(t.kind, "business");
  assert.equal(t.state, "assigned");
});

// ---- end to end --------------------------------------------------------------------

test("assignment → reads profile → draft + proposal → deliverable note → completed, with cost recorded", async () => {
  const id = await assign(lead);
  await worker(() =>
    scripted([
      toolUse("t1", "get_business_profile", { business: null }),
      toolUse("t2", "save_draft_note", { title: "Venue questions", body: "Questions to confirm with the owner before booking." }),
      toolUse("t3", "propose_outside_action", { kind: "external_message", summary: "Email the venue to confirm", details: "Ask about availability.", counterparty: null, amount_usd: null }),
      toolUse("t4", "submit_result", RESULT),
    ]),
  ).tick();

  const t = await taskRow(id);
  assert.equal(t.state, "completed", t.lastError ?? "");
  assert.equal(t.resultSummary, RESULT.summary);

  const events = await tdb.db.select().from(executionEvents).where(eq(executionEvents.taskId, id)).orderBy(asc(executionEvents.occurredAt), asc(executionEvents.sequence));
  const types = events.map((e) => e.type);
  assert.equal(types[0], "run.started");
  assert.equal(types.at(-1), "run.completed");
  assert.equal(types.filter((x) => x === "tool.called").length, 3);
  const done = events.at(-1)!.payload as { notePath: string; costMicros: number; drafts: string[]; proposals: string[]; openQuestions: string[] };
  assert.ok(done.costMicros > 0);
  assert.equal(done.drafts.length, 1);
  assert.equal(done.proposals.length, 1);
  assert.deepEqual(done.openQuestions, RESULT.open_questions);

  const note = await knowledge.readNote(ownerContext(), done.notePath);
  assert.match(note.path, /^businesses\/test-business-a\/reports\//);
  assert.equal(note.meta.status, "draft");
  assert.match(note.body, /AI-generated draft/);
  assert.match(note.body, /Which venue is booked\?/);

  const [proposal] = await tdb.db.select().from(actionProposals).where(eq(actionProposals.organizationId, f.orgId));
  assert.equal(proposal!.status, "pending", "proposals wait for the owner; nothing is executed");
  assert.equal(proposal!.proposedBy, lead);

  const usageRows = await tdb.db.select().from(modelUsage).where(eq(modelUsage.agentId, lead));
  assert.equal(usageRows.length, 4, "one usage row per real model call");
  const [biz] = await tdb.db.select().from(budgets).where(and(eq(budgets.organizationId, f.orgId), eq(budgets.businessId, f.bizA)));
  assert.ok(biz!.spentMicros > 0, "charged to the business budget");
});

// ---- nothing runs on its own ----------------------------------------------------------

test("only business work runs: tracked general tasks, approval-gated tasks and other roles are never claimed", async () => {
  const svc = new TaskService(tdb.db);
  const owner = userCtx(f.orgId);
  const general = (await svc.createTask(owner, { title: "Test: tracked", businessId: f.bizA, description: "An older tracked task." })).task;
  await svc.transition(owner, general.id, { action: "assign", agentId: lead });
  const gated = (await svc.createTask(owner, { title: "Test: gated", kind: "business", businessId: f.bizA, description: "Needs approval first.", requiresApproval: true })).task;
  await svc.transition(owner, gated.id, { action: "assign", agentId: lead });
  const calls = { n: 0 };
  assert.equal(await worker(() => scripted([], calls)).tick(), "idle");
  assert.equal(calls.n, 0, "no model call");
  assert.equal((await taskRow(general.id)).state, "assigned");
  assert.equal((await taskRow(gated.id)).state, "assigned");
});

test("without a business budget nothing is spent and the task fails clearly", async () => {
  await tdb.db.delete(budgets).where(and(eq(budgets.organizationId, f.orgId), eq(budgets.businessId, f.bizA)));
  const id = await assign(lead);
  const calls = { n: 0 };
  await worker(() => scripted([toolUse("t1", "submit_result", RESULT)], calls)).tick();
  const t = await taskRow(id);
  assert.equal(t.state, "failed");
  assert.match(t.lastError ?? "", /limit|budget/i);
  assert.equal(calls.n, 0, "the budget check happens before the model call");
});

test("a paused agent's work is not run", async () => {
  const id = await assign(lead);
  await tdb.db.update(agents).set({ status: "disabled" }).where(eq(agents.id, lead));
  const calls = { n: 0 };
  await worker(() => scripted([], calls)).tick();
  assert.equal(calls.n, 0);
  assert.equal((await taskRow(id)).state, "assigned", "the queue only claims runs of active agents");
});

// ---- scope: businesses stay distinct ---------------------------------------------------

const toolboxFor = async (agentId: string, taskId: string, businessIds: string[], over: Partial<{ canWriteDrafts: boolean; canPropose: boolean }> = {}) => {
  const [agent] = await tdb.db.select().from(agents).where(eq(agents.id, agentId));
  const slugs = new Map(businessIds.map((id) => [id, id === f.bizA ? "test-business-a" : "test-business-b"]));
  return new BusinessToolbox(
    tdb.db,
    knowledge,
    {
      organizationId: f.orgId,
      agentId,
      agentSlug: agent!.slug,
      agentSectorId: agent!.sectorId,
      businessIds,
      taskId,
      taskBusiness: { id: f.bizA, slug: "test-business-a", name: "Test Business A", sectorId: f.sectorId },
      canWriteDrafts: over.canWriteDrafts ?? true,
      canPropose: over.canPropose ?? true,
      now: () => new Date(),
    },
    slugs,
  );
};

test("a business agent cannot read another business's profile, tasks or notes", async () => {
  const mine = await assign(lead);
  const theirs = (await new TaskService(tdb.db).createTask(userCtx(f.orgId), { title: "Test: B's task", businessId: f.bizB })).task;
  const tb = await toolboxFor(lead, mine, [f.bizA]);

  const profile = await tb.execute("get_business_profile", { business: "test-business-b" });
  assert.equal(profile.ok, false);
  assert.doesNotMatch(profile.content, /SECRET-B/);
  assert.equal((await tb.execute("get_task", { task_id: theirs.id })).ok, false);
  assert.equal((await tb.execute("read_note", { path: "businesses/test-business-b/business.md" })).ok, false);

  const listed = await tb.execute("list_tasks", { state: null });
  assert.doesNotMatch(listed.content, new RegExp(theirs.id));
  const notes = await tb.execute("list_notes", { business: null });
  assert.doesNotMatch(notes.content, /test-business-b/);
  assert.match((await tb.execute("get_business_profile", { business: null })).content, /weekend events/);
});

test("a sector manager reads its sector's businesses but writes drafts only in the task's business", async () => {
  const t = await assign(manager, "Compare the two businesses' plans.", f.bizA);
  const tb = await toolboxFor(manager, t, [f.bizA, f.bizB]);
  assert.match((await tb.execute("get_business_profile", { business: "test-business-b" })).content, /SECRET-B/);
  const draft = await tb.execute("save_draft_note", { title: "Comparison", body: "A comparison draft for the owner to review." });
  assert.equal(draft.ok, true, draft.content);
  assert.match(draft.content, /businesses\/test-business-a\//);
});

test("drafts and proposals are bounded and need their permissions", async () => {
  const t = await assign(lead);
  const noPerms = await toolboxFor(lead, t, [f.bizA], { canWriteDrafts: false, canPropose: false });
  assert.equal((await noPerms.execute("save_draft_note", { title: "X", body: "A body that is long enough." })).ok, false);
  assert.equal((await noPerms.execute("propose_outside_action", { kind: "financial_transfer", summary: "Pay", details: "", counterparty: null, amount_usd: 10 })).ok, false);

  const tb = await toolboxFor(lead, t, [f.bizA]);
  for (let i = 0; i < 3; i++) assert.equal((await tb.execute("save_draft_note", { title: `Draft ${i}`, body: "A body that is long enough." })).ok, true);
  assert.equal((await tb.execute("save_draft_note", { title: "Too many", body: "A body that is long enough." })).ok, false);
  for (let i = 0; i < 2; i++) assert.equal((await tb.execute("propose_outside_action", { kind: "public_publish", summary: `Post ${i}`, details: "d", counterparty: null, amount_usd: null })).ok, true);
  assert.equal((await tb.execute("propose_outside_action", { kind: "public_publish", summary: "Post 3", details: "d", counterparty: null, amount_usd: null })).ok, false);
  const rows = await tdb.db.select().from(actionProposals).where(eq(actionProposals.organizationId, f.orgId));
  assert.ok(rows.every((r) => r.status === "pending"));
});

test("unknown tools are refused and audited", async () => {
  const id = await assign(lead);
  await worker(() => scripted([toolUse("x1", "send_email", {}), toolUse("x2", "web_search", {}), toolUse("t", "submit_result", RESULT)])).tick();
  assert.equal((await taskRow(id)).state, "completed");
  const denied = await tdb.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, id), eq(auditLogs.action, "agent.tool.denied")));
  assert.deepEqual(denied.map((d) => (d.metadata as { tool: string }).tool).sort(), ["send_email", "web_search"]);
  const proposals = await tdb.db.select().from(actionProposals).where(inArray(actionProposals.organizationId, [f.orgId]));
  assert.equal(proposals.length, 0);
});

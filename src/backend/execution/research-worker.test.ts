import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq } from "drizzle-orm";
import { createAnthropicProvider, type Messages } from "@/agents/providers/anthropic";
import { createCompatProvider } from "@/agents/providers/openai-compatible";
import type { ProviderStatus } from "@/agents/providers/types";
import type { ResearchConfig } from "@/infrastructure/config/env";
import { agentPermissions, agents, auditLogs, budgets, executionEvents, executionRuns, knowledgeDocuments, modelUsage, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { monthStart } from "../budgets/spend-guard";
import { KnowledgeService, ownerContext } from "../knowledge";
import { createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { createResearchTask } from "../tasks/research";
import { ResearchWorker } from "./research-worker";

/**
 * Worker integration tests: real database (PGlite or TEST_DATABASE_URL),
 * real knowledge service on a throwaway vault, and a SCRIPTED model client
 * (no network, no cost). The live API test is research-worker.e2e.test.ts.
 */
let tdb: TestDatabase;
let vault: string;
let f: Fixture;
let n = 0;

const config: ResearchConfig = {
  effort: "medium",
  allowedDomains: ["wikipedia.org"],
  maxRunMicros: 1_000_000,
  maxSearches: 3,
  maxFetches: 1,
};

const usage = (searches = 0) => ({
  input_tokens: 2000,
  output_tokens: 300,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 },
  iterations: null,
});
const goodScript = () => [
  {
    model: "claude-opus-5-5",
    stop_reason: "pause_turn",
    usage: usage(1),
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Hubble Space Telescope launch" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://en.wikipedia.org/wiki/Hubble_Space_Telescope", title: "Hubble Space Telescope", encrypted_content: "x", page_age: null }] },
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
        input: {
          title: "Hubble Space Telescope overview",
          summary: "Test summary.",
          findings: [{ statement: "Hubble launched in 1990.", confidence: "high", source_ids: [1] }],
          uncertainties: ["Test uncertainty."],
          sources: [{ id: 1, title: "Hubble Space Telescope", url: "https://en.wikipedia.org/wiki/Hubble_Space_Telescope" }],
        },
      },
    ],
  },
];

function scripted(script: unknown[]): Messages {
  return { create: async () => (script.shift() ?? Promise.reject(new Error("script exhausted"))) } as unknown as Messages;
}

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  await tdb.db.update(executionRuns).set({ status: "canceled" }).where(eq(executionRuns.status, "queued"));
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "aehq-worker-vault-"));
  f = await createFixture(tdb.db, `worker-org-${++n}`);
  await tdb.db.insert(agentPermissions).values(
    (["research.web_search", "research.web_fetch", "knowledge.write"] as const).map((permission) => ({ agentId: f.agents.research, permission, grantedBy: "test" })),
  );
  // These tests script Claude responses: assign the agent to Claude.
  await tdb.db.update(agents).set({ modelProvider: "anthropic", modelName: "claude-opus-5-5" }).where(eq(agents.id, f.agents.research));
});

const READY: ProviderStatus = { ready: true, keyConfigured: true, enabled: true, reason: "test" };

async function setBudgets(limitMicros = 5_000_000) {
  const periodStart = monthStart(new Date());
  await tdb.db.insert(budgets).values([
    { organizationId: f.orgId, businessId: null, periodStart, limitMicros },
    { organizationId: f.orgId, businessId: f.bizA, periodStart, limitMicros },
  ]);
}

/** Provider lookup that serves Claude from a scripted client and records every provider requested. */
function lookup(messages: () => Messages, status: ProviderStatus = READY) {
  const requested: string[] = [];
  const anthropic = createAnthropicProvider({ messages, status: () => status });
  const fn = (id: "anthropic" | "openai" | "xai") => {
    requested.push(id);
    if (id !== "anthropic") throw new Error(`provider ${id} must not be used`);
    return anthropic;
  };
  return Object.assign(fn, { requested });
}

function worker(messages: () => Messages, extra: Partial<ConstructorParameters<typeof ResearchWorker>[0]> = {}) {
  return new ResearchWorker({ db: tdb.db, knowledge: new KnowledgeService({ root: vault }), providers: lookup(messages), config, workerId: `w-${n}`, backoffBaseMs: 0, ...extra });
}

async function submit(question = "When was the Hubble Space Telescope launched, and what does it observe?") {
  const r = await createResearchTask(tdb.db, userCtx(f.orgId), { businessId: f.bizA, question });
  assert.equal(r.task.state, "assigned", r.note);
  return r.task.id;
}

const taskRow = async (id: string) => (await tdb.db.select().from(tasks).where(eq(tasks.id, id)))[0]!;
const eventsOf = async (id: string) =>
  (await tdb.db.select().from(executionEvents).where(eq(executionEvents.taskId, id)).orderBy(asc(executionEvents.occurredAt), asc(executionEvents.sequence))).map((e) => `${e.type}:${e.origin}`);

test("end to end with a scripted model: claim → events → report in vault → completed", async () => {
  await setBudgets();
  const id = await submit();
  const w = worker(() => scripted(goodScript()));
  assert.equal(await w.tick(), "processed");
  assert.equal(await w.tick(), "idle");

  const t = await taskRow(id);
  assert.equal(t.state, "completed", t.lastError ?? "");
  assert.match(t.resultSummary ?? "", /Report saved to businesses\/test-business-a\/reports\/.*hubble-space-telescope-overview/);
  assert.match(t.resultSummary ?? "", /1\/1 sources verified/);

  const events = await eventsOf(id);
  assert.deepEqual(events, ["run.started:live", "run.step:live", "tool.called:live", "tool.result:live", "run.step:live", "run.completed:live"]);

  const audit = await tdb.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, id)));
  assert.ok(audit.some((a) => a.action === "agent.tool.web_search"));
  assert.ok(audit.some((a) => a.action === "agent.tool.submit_report"));

  const usageRows = await tdb.db.select().from(modelUsage).where(eq(modelUsage.organizationId, f.orgId));
  assert.equal(usageRows.length, 2);
  const [bizBudget] = await tdb.db.select().from(budgets).where(eq(budgets.businessId, f.bizA));
  assert.equal(bizBudget!.spentMicros, usageRows.reduce((a, u) => a + u.costMicros, 0), "reservations settled to actual cost");

  const [doc] = await tdb.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.taskId, id));
  const note = await new KnowledgeService({ root: vault }).readNote(ownerContext(), doc!.vaultPath);
  assert.deepEqual(note.meta.tasks, [id]);
  assert.equal(note.meta.authorKind, "agent");
  assert.equal(note.meta.agent, "test-research");
  assert.match(note.body, /AI-generated research report/);
  assert.match(note.body, /## Uncertain or unverified/);
});

test("no budget: fails before any API call, error surfaced on the task", async () => {
  const id = await submit();
  let calls = 0;
  const w = worker(() => ({ create: async () => (calls++, goodScript()[0]) }) as unknown as Messages);
  await w.tick();
  const t = await taskRow(id);
  assert.equal(t.state, "failed");
  assert.match(t.lastError ?? "", /Spending limit reached/);
  assert.equal(calls, 0);
  assert.deepEqual(await eventsOf(id), ["run.started:live", "run.failed:live"]);
});

test("provider not configured: clear, non-retryable failure", async () => {
  await setBudgets();
  const id = await submit();
  const providers = lookup(() => scripted(goodScript()), { ready: false, keyConfigured: false, enabled: true, reason: "No API key for the app (AEHQ_ANTHROPIC_API_KEY is not set)." });
  await worker(() => scripted([]), { providers }).tick();
  const t = await taskRow(id);
  assert.equal(t.state, "failed");
  assert.match(t.lastError ?? "", /Claude \(Anthropic\) is not configured: .*AEHQ_ANTHROPIC_API_KEY/);
});

test("each task uses exactly ONE provider: the one assigned to its agent", async () => {
  await setBudgets();
  const id = await submit();
  const providers = lookup(() => scripted(goodScript()));
  await worker(() => scripted([]), { providers }).tick();
  assert.equal((await taskRow(id)).state, "completed");
  assert.deepEqual(providers.requested, ["anthropic"]);
  const rows = await tdb.db.select().from(modelUsage).where(eq(modelUsage.organizationId, f.orgId));
  assert.ok(rows.length > 0 && rows.every((r) => r.provider === "anthropic"));
});

test("reassigned to Grok: the same task type runs on xAI and usage is recorded as xai", async () => {
  await setBudgets();
  await tdb.db.update(agents).set({ modelProvider: "xai", modelName: "grok-4.7" }).where(eq(agents.id, f.agents.research));
  const id = await submit();
  const url = "https://en.wikipedia.org/wiki/Hubble_Space_Telescope";
  const reply = (output: unknown[]) => ({ id: "r", model: "grok-4.7", status: "completed", output, usage: { input_tokens: 1500, output_tokens: 200, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }, incomplete_details: null, error: null });
  const script = [
    reply([
      { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", query: "Hubble", sources: [{ type: "url", url }] } },
      { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Found it.", annotations: [{ type: "url_citation", url, title: "Hubble", start_index: 0, end_index: 1 }] }] },
      { type: "function_call", id: "fc1", call_id: "call1", name: "submit_report", arguments: JSON.stringify((goodScript()[1] as { content: { input: unknown }[] }).content[0]!.input), status: "completed" },
    ]),
  ];
  const requested: string[] = [];
  const xai = createCompatProvider("xai", { responses: () => ({ create: async () => script.shift() }) as never, status: () => READY });
  const providers = (p: "anthropic" | "openai" | "xai") => {
    requested.push(p);
    if (p !== "xai") throw new Error(`provider ${p} must not be used`);
    return xai;
  };
  await worker(() => scripted([]), { providers }).tick();
  const t = await taskRow(id);
  assert.equal(t.state, "completed", t.lastError ?? "");
  assert.match(t.resultSummary ?? "", /1\/1 sources verified/);
  assert.deepEqual(requested, ["xai"]);
  const rows = await tdb.db.select().from(modelUsage).where(eq(modelUsage.organizationId, f.orgId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.provider, "xai");
  assert.equal(rows[0]!.model, "grok-4.7");
  // 1500 in x $2 + 200 out x $6 per MTok + 1 search x $0.025 = 0.003 + 0.0012 + 0.025
  assert.equal(rows[0]!.costMicros, 29_200);
});

test("transient API errors are retried; the second attempt succeeds", async () => {
  await setBudgets();
  const id = await submit();
  let attempt = 0;
  const w = worker(() => {
    attempt++;
    if (attempt === 1) return { create: async () => Promise.reject(new Anthropic.InternalServerError(529, { type: "overloaded_error" }, "Overloaded", new Headers())) } as unknown as Messages;
    return scripted(goodScript());
  });
  await w.tick();
  let t = await taskRow(id);
  assert.equal(t.state, "assigned", "back in the queue after a transient failure");
  assert.match(t.lastError ?? "", /server error .*will retry/);
  await w.tick();
  t = await taskRow(id);
  assert.equal(t.state, "completed");
  assert.equal(t.attempt, 2);
});

test("timeouts abort the in-flight API call and fail the attempt", async () => {
  await setBudgets();
  const id = await submit();
  await tdb.db.update(tasks).set({ timeoutSeconds: 1, maxAttempts: 1 }).where(eq(tasks.id, id));
  const hanging = {
    create: (_p: unknown, opts: { signal: AbortSignal }) =>
      new Promise((_r, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted")))),
  } as unknown as Messages;
  await worker(() => hanging).tick();
  const t = await taskRow(id);
  assert.equal(t.state, "failed");
  assert.match(t.lastError ?? "", /time limit/);
  const [bizBudget] = await tdb.db.select().from(budgets).where(eq(budgets.businessId, f.bizA));
  assert.equal(bizBudget!.spentMicros, 0, "the reservation was released");
});

test("agents without research capability are refused", async () => {
  await setBudgets();
  const id = await submit();
  await tdb.db.delete(agentPermissions).where(and(eq(agentPermissions.agentId, f.agents.research), eq(agentPermissions.permission, "research.web_search")));
  await tdb.db.delete(agentPermissions).where(and(eq(agentPermissions.agentId, f.agents.research), eq(agentPermissions.permission, "research.web_fetch")));
  await worker(() => scripted(goodScript())).tick();
  const t = await taskRow(id);
  assert.equal(t.state, "failed");
  assert.match(t.lastError ?? "", /no approved research capability/);
});

test("research task validation: question length and business required", async () => {
  await assert.rejects(createResearchTask(tdb.db, userCtx(f.orgId), { businessId: f.bizA, question: "short" }), /10-2,000 characters/);
  const other = await createResearchTask(tdb.db, userCtx(f.orgId), { businessId: f.bizB, question: "A question for a business without a research agent." });
  assert.equal(other.task.state, "queued");
  assert.match(other.note, /no active Research Agent/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnthropicProvider, type Messages } from "../providers/anthropic";
import { estimateCostMicros, priceOf, worstCaseMicros } from "../providers/cost";
import { runResearch, ResearchError, type ResearchHooks, type ToolActivity } from "./agent";
import { renderReportMarkdown, verifyReport } from "./report";

/**
 * Unit tests with a SCRIPTED fake Messages client (no network, no cost).
 * They verify the loop's control flow; the live end-to-end test lives in
 * src/backend/execution/research-worker.e2e.test.ts.
 */
type Resp = Record<string, unknown>;
const usage = (o: Partial<Record<string, number>> = {}) => ({
  input_tokens: o.input ?? 1000,
  output_tokens: o.output ?? 200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: o.searches ?? 0, web_fetch_requests: o.fetches ?? 0 },
  iterations: null,
});
const reportInput = {
  title: "Test report",
  summary: "A summary.",
  findings: [
    { statement: "Verified fact.", confidence: "high", source_ids: [1] },
    { statement: "Weak claim.", confidence: "low", source_ids: [] },
  ],
  uncertainties: ["Launch date differs between sources."],
  sources: [
    { id: 1, title: "Retrieved page", url: "https://en.wikipedia.org/wiki/Example" },
    { id: 2, title: "Made-up page", url: "https://en.wikipedia.org/wiki/Not_Retrieved" },
  ],
};
const searchTurn: Resp = {
  model: "claude-opus-5-5",
  stop_reason: "pause_turn",
  usage: usage({ searches: 1, input: 3000 }),
  content: [
    { type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "example" } },
    { type: "web_search_tool_result", tool_use_id: "srv1", content: [{ type: "web_search_result", url: "https://en.wikipedia.org/wiki/Example", title: "Example", encrypted_content: "x", page_age: null }] },
  ],
};
const reportTurn: Resp = {
  model: "claude-opus-5-5",
  stop_reason: "tool_use",
  usage: usage(),
  content: [{ type: "tool_use", id: "tu1", name: "submit_report", input: reportInput }],
};

function fake(script: Resp[]) {
  const calls: Record<string, unknown>[] = [];
  const messages = {
    create: async (params: Record<string, unknown>) => {
      calls.push(structuredClone(params));
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      return next;
    },
  } as unknown as Messages;
  return { messages, calls };
}

function hooks(opts: { budgetMicros?: number } = {}) {
  let remaining = opts.budgetMicros ?? 10_000_000;
  const reserved = new Map<string, number>();
  const events: string[] = [];
  const tools: ToolActivity[] = [];
  let n = 0;
  const h: ResearchHooks = {
    async reserve(micros) {
      if (micros > remaining) throw new Error("budget exceeded");
      remaining -= micros;
      const id = `r${++n}`;
      reserved.set(id, micros);
      return id;
    },
    async settle(id, actual) {
      remaining += reserved.get(id)! - actual.micros;
      reserved.delete(id);
    },
    async release(id) {
      remaining += reserved.get(id)!;
      reserved.delete(id);
    },
    async event(type) {
      events.push(type);
    },
    async toolActivity(a) {
      tools.push(a);
    },
  };
  return { h, events, tools, remaining: () => remaining, open: () => reserved.size };
}

const base = (messages: Messages, h: ResearchHooks) => ({
  provider: createAnthropicProvider({ messages: () => messages }),
  model: "claude-opus-5-5",
  question: "What is an example?",
  allowedDomains: ["wikipedia.org"],
  capabilities: { webSearch: true, webFetch: true },
  signal: new AbortController().signal,
  deadline: Date.now() + 60_000,
  hooks: h,
});

test("search → pause_turn resume → structured report with verified/unverified sources", async () => {
  const { messages, calls } = fake([structuredClone(searchTurn), structuredClone(reportTurn)]);
  const k = hooks();
  const out = await runResearch(base(messages, k.h));
  assert.equal(out.modelCalls, 2);
  assert.equal(out.searches, 1);
  assert.deepEqual(out.report.sources.map((s) => s.verified), [true, false]);
  assert.deepEqual(out.report.uncertainFindings.map((f) => f.statement), ["Weak claim."]);
  assert.equal(k.open(), 0, "all reservations settled");
  assert.deepEqual(k.events, ["run.step", "tool.called", "tool.result", "run.step"]);
  assert.deepEqual(k.tools.map((t) => `${t.tool}:${t.allowed}`), ["web_search:true", "submit_report:true"]);

  // Request shape: only approved tools, domain-restricted, explicit model/effort.
  const first = calls[0]!;
  assert.equal(first.model, "claude-opus-5-5");
  assert.deepEqual(first.output_config, { effort: "medium" });
  const tools = first.tools as { name: string; allowed_domains?: string[]; strict?: boolean }[];
  assert.deepEqual(tools.map((t) => t.name).sort(), ["submit_report", "web_fetch", "web_search"]);
  assert.ok(tools.filter((t) => t.name.startsWith("web_")).every((t) => t.allowed_domains?.join() === "wikipedia.org"));
  assert.equal(tools.find((t) => t.name === "submit_report")!.strict, true);
  // pause_turn was resumed by re-sending the assistant turn, without an extra user message.
  const second = calls[1]!.messages as { role: string }[];
  assert.deepEqual(second.map((m) => m.role), ["user", "assistant"]);
});

test("capabilities are an allowlist: tools the agent was not granted are not offered", async () => {
  const { messages, calls } = fake([structuredClone(reportTurn)]);
  await runResearch({ ...base(messages, hooks().h), capabilities: { webSearch: true, webFetch: false } });
  const names = (calls[0]!.tools as { name: string }[]).map((t) => t.name);
  assert.deepEqual(names.sort(), ["submit_report", "web_search"]);
});

test("unknown tool calls are refused and logged", async () => {
  const sneaky: Resp = { model: "claude-opus-5-5", stop_reason: "tool_use", usage: usage(), content: [{ type: "tool_use", id: "x1", name: "bash", input: { command: "ls" } }] };
  const { messages, calls } = fake([sneaky, structuredClone(reportTurn)]);
  const k = hooks();
  await runResearch(base(messages, k.h));
  assert.deepEqual(k.tools[0], { tool: "bash", allowed: false, detail: "not an approved capability" });
  const reply = (calls[1]!.messages as { content: { is_error?: boolean }[] }[]).at(-1)!.content[0]!;
  assert.equal(reply.is_error, true);
});

test("spending limit: a call whose worst case exceeds the budget is never sent", async () => {
  const { messages, calls } = fake([structuredClone(reportTurn)]);
  await assert.rejects(runResearch(base(messages, hooks({ budgetMicros: 1_000 }).h)), /budget exceeded/);
  assert.equal(calls.length, 0);
});

test("refusal and max_tokens fail without retry; missing report fails after one nudge", async () => {
  const refusal: Resp = { model: "claude-opus-5-5", stop_reason: "refusal", stop_details: { category: "cyber" }, usage: usage(), content: [] };
  await assert.rejects(runResearch(base(fake([refusal]).messages, hooks().h)), (e: unknown) => e instanceof ResearchError && e.code === "refusal" && !e.retryable);
  const cut: Resp = { model: "claude-opus-5-5", stop_reason: "max_tokens", usage: usage(), content: [] };
  await assert.rejects(runResearch(base(fake([cut]).messages, hooks().h)), (e: unknown) => e instanceof ResearchError && e.code === "max-tokens");
  const chat: Resp = { model: "claude-opus-5-5", stop_reason: "end_turn", usage: usage(), content: [{ type: "text", text: "Here is my answer." }] };
  await assert.rejects(runResearch(base(fake([chat, structuredClone(chat)]).messages, hooks().h)), (e: unknown) => e instanceof ResearchError && e.code === "no-report");
});

test("an invalid report is sent back for correction", async () => {
  const bad: Resp = { ...structuredClone(reportTurn), content: [{ type: "tool_use", id: "tu0", name: "submit_report", input: { ...reportInput, findings: [] } }] };
  const { messages } = fake([bad, structuredClone(reportTurn)]);
  const out = await runResearch(base(messages, hooks().h));
  assert.equal(out.modelCalls, 2);
});

test("an aborted signal (timeout) stops the loop and releases the reservation", async () => {
  const ac = new AbortController();
  const k = hooks();
  const messages = {
    create: async () => {
      ac.abort();
      throw new Error("aborted");
    },
  } as unknown as Messages;
  await assert.rejects(runResearch({ ...base(messages, k.h), signal: ac.signal }), (e: unknown) => e instanceof ResearchError && e.code === "timeout" && e.retryable);
  assert.equal(k.open(), 0);
});

test("pricing is conservative and in micro-dollars", () => {
  const u = (o: Partial<Record<string, number>>) => ({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, webSearches: 0, webFetches: 0, ...o });
  assert.equal(estimateCostMicros("anthropic", u({ inputTokens: 1_000_000 }), priceOf("claude-opus-5-5")), 4_000_000);
  assert.equal(estimateCostMicros("anthropic", u({ webSearches: 3 }), priceOf("claude-opus-5-5")), 30_000);
  assert.ok(priceOf("unknown-model").outputPerMTok >= priceOf("claude-fable-5-2").outputPerMTok);
  assert.ok(worstCaseMicros("anthropic", 3000, 16_000, 5, priceOf("claude-opus-5-5")) > 16_000 * 20);
});

test("report markdown marks AI origin, uncertain findings and unverified sources", () => {
  const r = verifyReport(reportInput, new Set(["https://en.wikipedia.org/wiki/Example"]));
  const md = renderReportMarkdown(r, { question: "Q?", model: "claude-opus-5-5", taskId: "t1", costLabel: "$0.01", completedAt: "now" });
  assert.match(md, /AI-generated research report/);
  assert.match(md, /Weak claim/);
  assert.match(md, /Source \[2\] was not retrieved during this run and is unverified/);
  assert.match(md, /\| 1 \| \[Retrieved page\]\(https:\/\/en\.wikipedia\.org\/wiki\/Example\) \| yes \|/);
});

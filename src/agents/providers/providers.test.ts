import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createAnthropicClient, createAnthropicProvider, type Messages } from "./anthropic";
import { MODELS, SMOKE_TEST_MODELS, WORK_TYPES, findModel } from "./catalog";
import { estimateCostMicros, priceOf } from "./cost";
import { ProviderError, toProviderError } from "./errors";
import { createCompatClient, createCompatProvider, hostAllowed } from "./openai-compatible";
import { clearAvailabilityCache, modelAvailability } from "./registry";
import type { ModelProvider, ProviderStatus, SessionSpec } from "./types";

/** Adapter unit tests with scripted SDK clients: no network, no cost. */
const READY: ProviderStatus = { ready: true, keyConfigured: true, enabled: true, reason: "test" };
const signal = new AbortController().signal;
const opts = { signal, timeoutMs: 5_000 };
const spec = (o: Partial<SessionSpec> = {}): SessionSpec => ({
  model: "gpt-6.2-sol",
  system: "You are a test.",
  tools: [{ name: "submit", description: "Submit.", inputSchema: { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" } } } }],
  maxOutputTokens: 1000,
  effort: "low",
  ...o,
});

function fakeResponses(script: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    api: () => ({
      create: async (params: Record<string, unknown>) => {
        calls.push(structuredClone(params));
        return script.shift();
      },
    }) as never,
  };
}

const oaUsage = (input = 1000, output = 100, cached = 0) => ({ input_tokens: input, output_tokens: output, input_tokens_details: { cached_tokens: cached }, output_tokens_details: { reasoning_tokens: 0 } });
const resp = (output: unknown[], extra: Record<string, unknown> = {}) => ({ id: "r", model: "gpt-6.2-sol", status: "completed", output, usage: oaUsage(), incomplete_details: null, error: null, ...extra });

// ---- catalog ------------------------------------------------------------------

test("catalog: initial work types use one provider each, and every default is assignable", () => {
  assert.deepEqual(
    Object.values(WORK_TYPES).map((w) => w.provider),
    ["anthropic", "openai", "xai"],
  );
  for (const w of Object.values(WORK_TYPES)) assert.equal(findModel(w.model)?.assignable, true, w.model);
  for (const [p, m] of Object.entries(SMOKE_TEST_MODELS)) assert.equal(findModel(m)?.provider, p);
  // Smoke-test models are the cheapest assignable model of their provider.
  for (const [p, m] of Object.entries(SMOKE_TEST_MODELS)) {
    const cheapest = MODELS.filter((x) => x.provider === p && x.assignable).sort((a, b) => a.price.outputPerMTok - b.price.outputPerMTok)[0]!;
    assert.equal(m, cheapest.id);
  }
  assert.equal(new Set(MODELS.map((m) => m.id)).size, MODELS.length, "unique model IDs");
});

test("cost: cached input, long context and web searches are priced; unknown models get the top rate", () => {
  const u = (o: Partial<Record<string, number>>) => ({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, webSearches: 0, webFetches: 0, ...o });
  assert.equal(estimateCostMicros("openai", u({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000 }), priceOf("gpt-6.2-sol")), 2_200_000);
  assert.equal(estimateCostMicros("xai", u({ inputTokens: 100_000 }), priceOf("grok-4.7")), 200_000);
  assert.equal(estimateCostMicros("xai", u({ inputTokens: 300_000 }), priceOf("grok-4.7")), 1_200_000, "long context doubles the rate");
  assert.equal(estimateCostMicros("openai", u({ webSearches: 2 }), priceOf("gpt-6.2-sol")), 50_000);
  assert.ok(priceOf("made-up-model").outputPerMTok >= Math.max(...MODELS.map((m) => m.price.outputPerMTok)));
});

// ---- OpenAI / xAI adapter --------------------------------------------------------

test("openai: safe request shape (store=false, strict tools, domain-limited search, effort, structured output)", async () => {
  const f = fakeResponses([resp([{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"answer":"ok"}', annotations: [] }] }])]);
  const p = createCompatProvider("openai", { responses: f.api, status: () => READY });
  const s = p.openSession(spec({ webSearch: { allowedDomains: ["wikipedia.org"], maxUses: 2, fetch: false, maxFetches: 0 }, output: { name: "answer", schema: { type: "object" } } }));
  const out = await s.send({ text: "Hi" }, opts);
  const req = f.calls[0]!;
  assert.equal(req.store, false);
  assert.equal(req.instructions, "You are a test.");
  assert.deepEqual(req.include, ["reasoning.encrypted_content", "web_search_call.action.sources"]);
  assert.deepEqual(req.reasoning, { effort: "low" });
  const tools = req.tools as { type: string; strict?: boolean; filters?: { allowed_domains: string[] } }[];
  assert.deepEqual(tools.map((t) => t.type), ["function", "web_search"]);
  assert.equal(tools[0]!.strict, true);
  assert.deepEqual(tools[1]!.filters, { allowed_domains: ["wikipedia.org"] });
  assert.equal((req.text as { format: { type: string; strict: boolean } }).format.strict, true);
  assert.equal(out.stop, "end");
  assert.deepEqual(out.structured, { answer: "ok" });
  assert.equal(out.costMicros, Math.ceil((1000 * 2 + 100 * 10) / 1e6 * 1e6));
});

test("openai: tool calls round-trip; reasoning is replayed (encrypted) for OpenAI, not for xAI", async () => {
  const turn1 = resp([
    { type: "reasoning", id: "rs1", summary: [], encrypted_content: "enc" },
    { type: "function_call", id: "fc", call_id: "c1", name: "submit", arguments: '{"a":"x"}', status: "completed" },
  ]);
  const turn2 = resp([{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: "done", annotations: [] }] }]);
  for (const id of ["openai", "xai"] as const) {
    const f = fakeResponses([structuredClone(turn1), structuredClone(turn2)]);
    const s = createCompatProvider(id, { responses: f.api, status: () => READY }).openSession(spec({ model: id === "openai" ? "gpt-6.2-sol" : "grok-4.7" }));
    const t1 = await s.send({ text: "go" }, opts);
    assert.equal(t1.stop, "tool-calls");
    assert.deepEqual(t1.toolCalls, [{ id: "c1", name: "submit", input: { a: "x" } }]);
    await s.send({ toolResults: [{ callId: "c1", content: "bad", isError: true }] }, opts);
    const input = f.calls[1]!.input as { type?: string; output?: string }[];
    assert.deepEqual(
      input.map((i) => i.type ?? "message"),
      id === "openai" ? ["message", "reasoning", "function_call", "function_call_output"] : ["message", "function_call", "function_call_output"],
    );
    assert.equal(input.at(-1)!.output, "ERROR: bad");
    if (id === "xai") {
      assert.equal(f.calls[0]!.include, undefined, "xAI: no OpenAI-only include options");
      assert.equal(f.calls[0]!.reasoning, undefined, "xAI: no reasoning-effort parameter");
    }
  }
});

test("openai: refusals, truncation, off-allowlist sources and unexpected tools are handled", async () => {
  const refusal = resp([{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "I can't help with that." }] }]);
  const truncated = resp([], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
  const filtered = resp([], { status: "incomplete", incomplete_details: { reason: "content_filter" } });
  const mixed = resp([
    { type: "web_search_call", id: "ws", status: "completed", action: { type: "search", query: "q", sources: [{ type: "url", url: "https://en.wikipedia.org/wiki/A" }, { type: "url", url: "https://evil.example.com/x" }] } },
    { type: "code_interpreter_call", id: "ci", status: "completed", code: "rm -rf /", container_id: "c", outputs: [] },
    { type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: "x", annotations: [] }] },
  ]);
  const f = fakeResponses([refusal, truncated, filtered, mixed]);
  const p = createCompatProvider("openai", { responses: f.api, status: () => READY });
  const s = () => p.openSession(spec({ webSearch: { allowedDomains: ["wikipedia.org"], maxUses: 3, fetch: false, maxFetches: 0 } }));
  assert.equal((await s().send({ text: "a" }, opts)).stop, "refusal");
  assert.equal((await s().send({ text: "a" }, opts)).stop, "max-tokens");
  assert.equal((await s().send({ text: "a" }, opts)).stop, "refusal");
  const m = await s().send({ text: "a" }, opts);
  assert.deepEqual(m.retrievedUrls, ["https://en.wikipedia.org/wiki/A"]);
  assert.deepEqual(m.disallowed, ["source outside approved domains: evil.example.com", "code_interpreter_call"]);
  assert.equal(m.usage.webSearches, 1);
  assert.ok(hostAllowed("https://commons.wikipedia.org/x", ["wikipedia.org"]));
  assert.ok(!hostAllowed("https://wikipedia.org.evil.com/x", ["wikipedia.org"]));
});

test("a failed response becomes a retryable ProviderError", async () => {
  const f = fakeResponses([resp([], { status: "failed", error: { code: "server_error", message: "boom" } })]);
  const s = createCompatProvider("xai", { responses: f.api, status: () => READY }).openSession(spec({ model: "grok-4.7" }));
  await assert.rejects(s.send({ text: "a" }, opts), (e: unknown) => e instanceof ProviderError && e.kind === "server" && e.retryable);
});

// ---- Anthropic adapter ----------------------------------------------------------

test("anthropic: structured output format, cache pricing and refusal fallback", async () => {
  const calls: Record<string, unknown>[] = [];
  const messages = {
    create: async (p: Record<string, unknown>) => {
      calls.push(structuredClone(p));
      return {
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        stop_details: null,
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0, server_tool_use: null, iterations: null },
        content: [{ type: "text", text: '{"answer":"ok"}' }],
      };
    },
  } as unknown as Messages;
  const s = createAnthropicProvider({ messages: () => messages }).openSession(spec({ model: "claude-opus-5-5", tools: [], output: { name: "a", schema: { type: "object" } } }));
  const out = await s.send({ text: "Hi" }, opts);
  assert.deepEqual(calls[0]!.output_config, { effort: "low", format: { type: "json_schema", schema: { type: "object" } } });
  assert.deepEqual(calls[0]!.fallbacks, [{ model: "claude-opus-4-8" }]);
  assert.equal(calls[0]!.tools, undefined, "no tools sent when none are declared");
  assert.deepEqual(out.structured, { answer: "ok" });
  // Actual cost uses the model that served the call ($4 in / $0.20 cached / $20 out)...
  assert.equal(out.costMicros, 1000 * 4 + 10_000 * 0.2 + 100 * 20);
  // ...while the budget reservation prices the refusal fallback in (Opus 4.8 is dearer).
  assert.ok(s.worstCaseNextMicros(0) >= Math.ceil((20_000 * 5 + 1000 * 25) / 1e6 * 1e6));

  const haiku = createAnthropicProvider({ messages: () => messages }).openSession(spec({ model: "claude-haiku-5-5", tools: [] }));
  await haiku.send({ text: "Hi" }, opts);
  assert.equal(calls[1]!.fallbacks, undefined, "Haiku has no server-side refusal fallback");
});

// ---- errors ------------------------------------------------------------------------

test("SDK errors from both SDKs map to the same provider-neutral kinds", () => {
  const h = new Headers();
  const cases: [unknown, string, boolean][] = [
    [new Anthropic.AuthenticationError(401, {}, "x", h), "authentication", false],
    [new OpenAI.AuthenticationError(401, {}, "x", h), "authentication", false],
    [new OpenAI.NotFoundError(404, {}, "x", h), "model-not-found", false],
    [new OpenAI.RateLimitError(429, {}, "x", h), "rate-limited", true],
    [new Anthropic.InternalServerError(529, {}, "x", h), "server", true],
    [new OpenAI.InternalServerError(503, {}, "x", h), "server", true],
    [new OpenAI.BadRequestError(400, {}, "x", h), "bad-request", false],
    [new OpenAI.APIConnectionError({ message: "down" }), "connection", true],
    [new OpenAI.APIConnectionTimeoutError(), "timeout", true],
  ];
  for (const [err, kind, retryable] of cases) {
    const e = toProviderError("openai", err) as ProviderError;
    assert.equal(e.kind, kind);
    assert.equal(e.retryable, retryable);
  }
  const plain = new Error("not an SDK error");
  assert.equal(toProviderError("xai", plain), plain, "unknown errors pass through unchanged");
  assert.match((toProviderError("xai", new OpenAI.AuthenticationError(401, {}, "x", h)) as Error).message, /AEHQ_XAI_API_KEY/);
});

// ---- credential isolation ------------------------------------------------------------

test("clients use ONLY the app's AEHQ_* keys and pinned endpoints, ignoring the SDKs' own env variables", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      AGENT_EXECUTION_ENABLED: "true",
      PROVIDER_ANTHROPIC_ENABLED: "true",
      PROVIDER_OPENAI_ENABLED: "true",
      PROVIDER_XAI_ENABLED: "true",
      AEHQ_ANTHROPIC_API_KEY: "app-anthropic-key",
      AEHQ_OPENAI_API_KEY: "app-openai-key",
      AEHQ_XAI_API_KEY: "app-xai-key",
      ANTHROPIC_API_KEY: "session-key",
      ANTHROPIC_BASE_URL: "https://proxy.invalid",
      OPENAI_API_KEY: "other-openai-key",
      OPENAI_BASE_URL: "https://proxy.invalid/v1",
      OPENAI_ORG_ID: "org-other",
      OPENAI_PROJECT_ID: "proj-other",
    });
    const a = createAnthropicClient();
    assert.equal(a.apiKey, "app-anthropic-key");
    assert.equal(a.baseURL, "https://api.anthropic.com");
    const o = createCompatClient("openai");
    assert.equal(o.apiKey, "app-openai-key");
    assert.equal(o.baseURL, "https://api.openai.com/v1");
    assert.equal(o.organization, null);
    assert.equal(o.project, null);
    const x = createCompatClient("xai");
    assert.equal(x.apiKey, "app-xai-key");
    assert.equal(x.baseURL, "https://api.x.ai/v1");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("without the switches and a key, providers refuse to build a client", async () => {
  for (const p of [createCompatProvider("openai"), createCompatProvider("xai"), createAnthropicProvider()]) {
    assert.equal(p.status().ready, false);
    await assert.rejects(p.openSession(spec()).send({ text: "x" }, opts), (e: unknown) => e instanceof ProviderError && e.kind === "not-configured");
  }
});

// ---- availability ------------------------------------------------------------------

test("model availability comes from the provider's live list; unconfigured providers are unverified", async () => {
  clearAvailabilityCache();
  const fake = (id: "anthropic" | "openai" | "xai", ready: boolean, ids: string[]): ModelProvider => ({
    id,
    restrictions: [],
    status: () => ({ ...READY, ready, reason: ready ? "ok" : "No API key" }),
    listModels: async () => ids,
    openSession: () => {
      throw new Error("not used");
    },
  });
  const lookup = (id: "anthropic" | "openai" | "xai") =>
    id === "anthropic" ? fake(id, true, ["claude-opus-5-5", "claude-haiku-5-5"]) : id === "openai" ? fake(id, true, ["gpt-6.2-sol"]) : fake(id, false, []);
  const a = await modelAvailability(lookup, { refresh: true });
  assert.equal(a.get("claude-opus-5-5")!.state, "available");
  assert.equal(a.get("claude-fable-5-2")!.state, "unavailable");
  assert.equal(a.get("gpt-6.2-sol")!.state, "available");
  assert.equal(a.get("gpt-6.2-astra")!.state, "unavailable");
  assert.equal(a.get("grok-4.7")!.state, "unverified");
  assert.match(a.get("grok-4.7")!.detail, /No API key/);
  clearAvailabilityCache();
});

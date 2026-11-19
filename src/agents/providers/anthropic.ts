import Anthropic from "@anthropic-ai/sdk";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { findModel } from "./catalog";
import { estimateCostMicros, maxPriceOf, worstCaseMicros } from "./cost";
import { ProviderNotConfiguredError, toProviderError } from "./errors";
import type { ChatSession, HostedToolActivity, ModelProvider, ProviderStatus, SessionSnapshot, SessionSpec, ToolCall, TurnInput, TurnResult } from "./types";

/**
 * ANTHROPIC ADAPTER (official @anthropic-ai/sdk, Messages API, manual loop).
 *
 * Credential isolation from any other Claude credential on the machine (for
 * example a Claude Code session running alongside):
 * - The key comes ONLY from AEHQ_ANTHROPIC_API_KEY and is passed explicitly,
 *   so the SDK never falls back to ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
 *   `ant` profiles or workload-identity variables.
 * - The endpoint is pinned to https://api.anthropic.com (ANTHROPIC_BASE_URL is ignored).
 * - The key is never logged, stored, or returned.
 */
export const ANTHROPIC_API_URL = "https://api.anthropic.com";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Messages = Pick<Anthropic["beta"]["messages"], "create">;
type ModelsApi = Pick<Anthropic["models"], "list">;

export const ANTHROPIC_RESTRICTIONS = [
  "Uses only the app's key (AEHQ_ANTHROPIC_API_KEY); endpoint pinned to api.anthropic.com.",
  "Tools: strict client functions declared by the agent, plus web search / web fetch limited to approved domains.",
  "No code execution, computer use, files, memory or MCP tools are ever sent.",
  "Refusals (stop_reason refusal) end the task; Opus/Fable/Sonnet use a priced server-side refusal fallback model.",
] as const;

export function anthropicStatus(source: NodeJS.ProcessEnv = process.env): ProviderStatus {
  const c = loadRuntimeConfig(source);
  const keyConfigured = c.providerKeys.anthropic;
  const enabled = c.providers.anthropic.enabled;
  if (!c.agentExecutionEnabled) return { ready: false, keyConfigured, enabled, reason: "Agent execution is disabled (AGENT_EXECUTION_ENABLED)." };
  if (!enabled) return { ready: false, keyConfigured, enabled, reason: "The Anthropic provider is disabled (PROVIDER_ANTHROPIC_ENABLED)." };
  if (!keyConfigured) return { ready: false, keyConfigured, enabled, reason: "No API key for the app (AEHQ_ANTHROPIC_API_KEY is not set)." };
  return { ready: true, keyConfigured, enabled, reason: "Key configured (validated on first use)." };
}

/** Builds the SDK client from the app key only (exported for the isolation test). */
export function createAnthropicClient(): Anthropic {
  const status = anthropicStatus();
  if (!status.ready) throw new ProviderNotConfiguredError("anthropic", status.reason);
  return new Anthropic({ apiKey: process.env.AEHQ_ANTHROPIC_API_KEY!.trim(), baseURL: ANTHROPIC_API_URL, maxRetries: 2, timeout: 10 * 60_000 });
}

export function createAnthropicProvider(deps: { messages?: () => Messages; models?: () => ModelsApi; status?: () => ProviderStatus } = {}): ModelProvider {
  const messages = deps.messages ?? (() => createAnthropicClient().beta.messages);
  const models = deps.models ?? (() => createAnthropicClient().models);
  return {
    id: "anthropic",
    restrictions: ANTHROPIC_RESTRICTIONS,
    status: deps.status ?? (() => anthropicStatus()),
    async listModels(signal) {
      try {
        const ids: string[] = [];
        for await (const m of models().list({ limit: 100 }, { signal })) ids.push(m.id);
        return ids;
      } catch (e) {
        throw toProviderError("anthropic", e);
      }
    },
    openSession: (spec, resume) => new AnthropicSession(messages, spec, resume),
  };
}

class AnthropicSession implements ChatSession {
  readonly provider = "anthropic" as const;
  readonly model: string;
  private readonly messages: () => Messages;
  private client: Messages | undefined;
  private readonly spec: SessionSpec;
  private readonly history: Anthropic.Beta.BetaMessageParam[];
  private readonly fallback: string | undefined;
  private searches = 0;
  private fetches = 0;

  constructor(messages: () => Messages, spec: SessionSpec, resume?: SessionSnapshot | null) {
    this.messages = messages;
    this.spec = spec;
    this.model = spec.model;
    this.fallback = findModel(spec.model)?.refusalFallback;
    this.history = resume && resume.provider === "anthropic" && resume.model === spec.model ? (resume.history as Anthropic.Beta.BetaMessageParam[]) : [];
  }

  snapshot(): SessionSnapshot {
    return { provider: "anthropic", model: this.model, history: this.history };
  }

  worstCaseNextMicros(pendingInputChars: number): number {
    const chars = this.spec.system.length + JSON.stringify(this.history).length + JSON.stringify(this.spec.tools ?? []).length + pendingInputChars;
    const searchesLeft = this.spec.webSearch ? Math.max(0, this.spec.webSearch.maxUses - this.searches) : 0;
    return worstCaseMicros("anthropic", chars, this.spec.maxOutputTokens, searchesLeft, maxPriceOf([this.model, this.fallback]));
  }

  async send(input: TurnInput, opts: { signal: AbortSignal; timeoutMs: number }): Promise<TurnResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const r of input.toolResults ?? []) content.push({ type: "tool_result", tool_use_id: r.callId, is_error: r.isError ?? false, content: r.content });
    if (input.text) content.push({ type: "text", text: input.text });
    // No new content = continue a paused turn (pause_turn): resend unchanged.
    if (content.length > 0) this.history.push({ role: "user", content });

    const tools = this.buildTools();
    let response: Anthropic.Beta.BetaMessage;
    try {
      this.client ??= this.messages();
      response = await this.client.create(
        {
          model: this.model,
          max_tokens: this.spec.maxOutputTokens,
          system: this.spec.system,
          messages: this.history,
          ...(tools.length > 0 ? { tools, tool_choice: { type: "auto" as const } } : {}),
          output_config: {
            ...(this.spec.effort ? { effort: this.spec.effort } : {}),
            ...(this.spec.output ? { format: { type: "json_schema" as const, schema: this.spec.output.schema } } : {}),
          },
          cache_control: { type: "ephemeral" },
          ...(this.fallback ? { betas: [FALLBACK_BETA], fallbacks: [{ model: this.fallback }] } : {}),
        },
        { signal: opts.signal, timeout: opts.timeoutMs },
      );
    } catch (e) {
      throw toProviderError("anthropic", e);
    }

    const u = response.usage;
    const usage = {
      inputTokens: u.input_tokens,
      cachedInputTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      outputTokens: u.output_tokens,
      webSearches: u.server_tool_use?.web_search_requests ?? 0,
      webFetches: u.server_tool_use?.web_fetch_requests ?? 0,
    };
    this.searches += usage.webSearches;
    this.fetches += usage.webFetches;
    const modelsSeen = [response.model, ...(u.iterations ?? []).map((it) => ("model" in it ? (it.model as string | null) : null))];
    const costMicros = estimateCostMicros("anthropic", usage, maxPriceOf(modelsSeen));

    this.history.push({ role: "assistant", content: response.content });
    const { hostedTools, retrievedUrls, disallowed } = readHostedTools(response.content);
    const toolCalls: ToolCall[] = response.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const stop =
      response.stop_reason === "refusal"
        ? "refusal"
        : response.stop_reason === "max_tokens"
          ? "max-tokens"
          : response.stop_reason === "pause_turn"
            ? "paused"
            : toolCalls.length > 0
              ? "tool-calls"
              : "end";
    return {
      provider: "anthropic",
      model: String(response.model),
      stop,
      refusalDetail: response.stop_details?.category ?? undefined,
      text,
      toolCalls,
      structured: this.spec.output && stop === "end" ? parseJson(text) : undefined,
      usage,
      costMicros,
      hostedTools,
      retrievedUrls,
      disallowed,
    };
  }

  private buildTools(): Anthropic.Beta.BetaToolUnion[] {
    const tools: Anthropic.Beta.BetaToolUnion[] = [];
    const ws = this.spec.webSearch;
    if (ws && ws.allowedDomains.length > 0) {
      const searchesLeft = ws.maxUses - this.searches;
      const fetchesLeft = ws.maxFetches - this.fetches;
      if (searchesLeft > 0) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: searchesLeft, allowed_domains: ws.allowedDomains });
      if (ws.fetch && fetchesLeft > 0) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: fetchesLeft, allowed_domains: ws.allowedDomains, max_content_tokens: 20_000 });
    }
    for (const t of this.spec.tools ?? []) {
      tools.push({ name: t.name, description: t.description, strict: true, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema });
    }
    return tools;
  }
}

const HOSTED_OK = new Set(["text", "thinking", "redacted_thinking", "tool_use", "server_tool_use", "web_search_tool_result", "web_fetch_tool_result", "fallback"]);

function readHostedTools(content: Anthropic.Beta.BetaContentBlock[]) {
  const hostedTools: HostedToolActivity[] = [];
  const retrievedUrls: string[] = [];
  const disallowed: string[] = [];
  const pending = new Map<string, { tool: "web_search" | "web_fetch"; detail: string }>();
  for (const block of content) {
    if (!HOSTED_OK.has(block.type)) {
      disallowed.push(block.type);
      continue;
    }
    if (block.type === "server_tool_use") {
      const i = (block.input ?? {}) as Record<string, unknown>;
      if (block.name !== "web_search" && block.name !== "web_fetch") {
        disallowed.push(block.name);
        continue;
      }
      pending.set(block.id, { tool: block.name, detail: String(i.query ?? i.url ?? "").slice(0, 300) });
    } else if (block.type === "web_search_tool_result") {
      const c = block.content;
      const p = pending.get(block.tool_use_id);
      if (Array.isArray(c)) {
        for (const r of c) retrievedUrls.push(r.url);
        hostedTools.push({ callId: block.tool_use_id, tool: "web_search", detail: p?.detail ?? "", ok: true, resultSummary: `${c.length} results` });
      } else {
        hostedTools.push({ callId: block.tool_use_id, tool: "web_search", detail: p?.detail ?? "", ok: false, resultSummary: `error: ${c.error_code}` });
      }
    } else if (block.type === "web_fetch_tool_result") {
      const c = block.content as unknown as { type: string; url?: string; error_code?: string };
      const ok = c.type === "web_fetch_result" && typeof c.url === "string";
      if (ok) retrievedUrls.push(c.url!);
      const p = pending.get(block.tool_use_id);
      hostedTools.push({ callId: block.tool_use_id, tool: "web_fetch", detail: p?.detail ?? c.url ?? "", ok, resultSummary: ok ? `fetched ${c.url}` : `error: ${c.error_code ?? "unknown"}` });
    }
  }
  return { hostedTools, retrievedUrls, disallowed };
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

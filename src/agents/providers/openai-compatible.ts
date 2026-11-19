import OpenAI from "openai";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseIncludable,
  ResponseInputItem,
  ResponseOutputItem,
  WebSearchTool,
} from "openai/resources/responses/responses";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { findModel, type ProviderId } from "./catalog";
import { estimateCostMicros, priceOf, worstCaseMicros } from "./cost";
import { PROVIDER_KEY_VARS, ProviderError, ProviderNotConfiguredError, toProviderError } from "./errors";
import { parseJson } from "./anthropic";
import type { ChatSession, HostedToolActivity, ModelProvider, ProviderStatus, SessionSnapshot, SessionSpec, ToolCall, TurnInput, TurnResult } from "./types";

/**
 * OPENAI + xAI ADAPTER (official `openai` SDK, Responses API).
 *
 * OpenAI is called at https://api.openai.com/v1. xAI documents its API as
 * OpenAI-SDK compatible and shows the official OpenAI JavaScript client with
 * baseURL https://api.x.ai/v1, so the same SDK is used for both (one
 * dependency instead of two).
 *
 * Credential isolation: the key comes ONLY from AEHQ_OPENAI_API_KEY /
 * AEHQ_XAI_API_KEY and is passed explicitly; the base URL is pinned, and
 * organization / project / admin key / webhook secret are set to null so
 * OPENAI_* environment variables are never picked up.
 *
 * Safety:
 * - `store: false` - providers do not keep the conversation server-side; the
 *   transcript is resent each turn (OpenAI reasoning is passed back encrypted).
 * - Only strict function tools and web search (domain allowlist) are sent.
 *   Any other output item (code interpreter, shell, computer, MCP, image
 *   generation, ...) is refused and reported.
 * - Retrieved URLs outside the allowlist are discarded and reported, so they
 *   can never count as a verified source.
 */
type ResponsesApi = Pick<OpenAI["responses"], "create">;
type ModelsApi = Pick<OpenAI["models"], "list">;

interface CompatConfig {
  id: Extract<ProviderId, "openai" | "xai">;
  baseURL: string;
  /** Encrypted reasoning must be requested to replay reasoning with store=false. */
  replayReasoning: boolean;
  include: ResponseIncludable[];
}

export const OPENAI_API_URL = "https://api.openai.com/v1";
export const XAI_API_URL = "https://api.x.ai/v1";

const CONFIGS: Record<"openai" | "xai", CompatConfig> = {
  openai: { id: "openai", baseURL: OPENAI_API_URL, replayReasoning: true, include: ["reasoning.encrypted_content", "web_search_call.action.sources"] },
  xai: { id: "xai", baseURL: XAI_API_URL, replayReasoning: false, include: [] },
};

const ENV_FLAG: Record<"openai" | "xai", string> = { openai: "PROVIDER_OPENAI_ENABLED", xai: "PROVIDER_XAI_ENABLED" };
const NAME: Record<"openai" | "xai", string> = { openai: "OpenAI", xai: "xAI" };

export function compatRestrictions(id: "openai" | "xai"): readonly string[] {
  return [
    `Uses only the app's key (${PROVIDER_KEY_VARS[id]}); endpoint pinned to ${CONFIGS[id].baseURL}.`,
    "store=false: the provider does not keep conversations; nothing is shared through stored responses.",
    "Tools: strict client functions declared by the agent, plus web search limited to approved domains.",
    "Any other tool output (code interpreter, shell, computer use, MCP, image generation) is refused.",
    "Sources outside the approved domains are discarded and cannot be cited as verified.",
  ];
}

export function compatStatus(id: "openai" | "xai", source: NodeJS.ProcessEnv = process.env): ProviderStatus {
  const c = loadRuntimeConfig(source);
  const keyConfigured = c.providerKeys[id];
  const enabled = c.providers[id].enabled;
  if (!c.agentExecutionEnabled) return { ready: false, keyConfigured, enabled, reason: "Agent execution is disabled (AGENT_EXECUTION_ENABLED)." };
  if (!enabled) return { ready: false, keyConfigured, enabled, reason: `The ${NAME[id]} provider is disabled (${ENV_FLAG[id]}).` };
  if (!keyConfigured) return { ready: false, keyConfigured, enabled, reason: `No API key for the app (${PROVIDER_KEY_VARS[id]} is not set).` };
  return { ready: true, keyConfigured, enabled, reason: "Key configured (validated on first use)." };
}

/** Builds the SDK client from the app key only (exported for the isolation test). */
export function createCompatClient(id: "openai" | "xai"): OpenAI {
  const status = compatStatus(id);
  if (!status.ready) throw new ProviderNotConfiguredError(id, status.reason);
  return new OpenAI({
    apiKey: process.env[PROVIDER_KEY_VARS[id]]!.trim(),
    baseURL: CONFIGS[id].baseURL,
    organization: null,
    project: null,
    adminAPIKey: null,
    webhookSecret: null,
    maxRetries: 2,
    timeout: 10 * 60_000,
    logLevel: "warn",
  });
}

export function createCompatProvider(
  id: "openai" | "xai",
  deps: { responses?: () => ResponsesApi; models?: () => ModelsApi; status?: () => ProviderStatus } = {},
): ModelProvider {
  const responses = deps.responses ?? (() => createCompatClient(id).responses);
  const models = deps.models ?? (() => createCompatClient(id).models);
  return {
    id,
    restrictions: compatRestrictions(id),
    status: deps.status ?? (() => compatStatus(id)),
    async listModels(signal) {
      try {
        const ids: string[] = [];
        for await (const m of models().list({ signal })) ids.push(m.id);
        return ids;
      } catch (e) {
        throw toProviderError(id, e);
      }
    },
    openSession: (spec, resume) => new CompatSession(CONFIGS[id], responses, spec, resume),
  };
}

const ALLOWED_OUTPUT = new Set(["message", "reasoning", "function_call", "web_search_call"]);

export function hostAllowed(url: string, domains: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

class CompatSession implements ChatSession {
  readonly provider: "openai" | "xai";
  readonly model: string;
  private readonly cfg: CompatConfig;
  private readonly responses: () => ResponsesApi;
  private client: ResponsesApi | undefined;
  private readonly spec: SessionSpec;
  private readonly history: ResponseInputItem[];
  private searches = 0;

  constructor(cfg: CompatConfig, responses: () => ResponsesApi, spec: SessionSpec, resume?: SessionSnapshot | null) {
    this.cfg = cfg;
    this.provider = cfg.id;
    this.responses = responses;
    this.spec = spec;
    this.model = spec.model;
    this.history = resume && resume.provider === cfg.id && resume.model === spec.model ? (resume.history as ResponseInputItem[]) : [];
  }

  snapshot(): SessionSnapshot {
    return { provider: this.provider, model: this.model, history: this.history };
  }

  worstCaseNextMicros(pendingInputChars: number): number {
    const chars = this.spec.system.length + JSON.stringify(this.history).length + JSON.stringify(this.spec.tools ?? []).length + pendingInputChars;
    return worstCaseMicros(this.provider, chars, this.spec.maxOutputTokens, this.searchesLeft(), priceOf(this.model));
  }

  private searchesLeft(): number {
    return this.spec.webSearch && this.spec.webSearch.allowedDomains.length > 0 ? Math.max(0, this.spec.webSearch.maxUses - this.searches) : 0;
  }

  async send(input: TurnInput, opts: { signal: AbortSignal; timeoutMs: number }): Promise<TurnResult> {
    for (const r of input.toolResults ?? []) {
      this.history.push({ type: "function_call_output", call_id: r.callId, output: r.isError ? `ERROR: ${r.content}` : r.content });
    }
    if (input.text) this.history.push({ role: "user", content: input.text });

    const tools: (FunctionTool | WebSearchTool)[] = (this.spec.tools ?? []).map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      strict: true,
    }));
    const searchesLeft = this.searchesLeft();
    if (searchesLeft > 0) tools.push({ type: "web_search", filters: { allowed_domains: this.spec.webSearch!.allowedDomains } });
    const info = findModel(this.model);

    const params: ResponseCreateParamsNonStreaming = {
      model: this.model,
      instructions: this.spec.system,
      input: this.history,
      max_output_tokens: this.spec.maxOutputTokens,
      store: false,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" as const } : {}),
      ...(searchesLeft > 0 ? { max_tool_calls: searchesLeft + (this.spec.tools?.length ? 8 : 0) } : {}),
      ...(this.cfg.include.length > 0 ? { include: this.cfg.include } : {}),
      ...(this.spec.effort && info?.effort ? { reasoning: { effort: this.spec.effort } } : {}),
      ...(this.spec.output ? { text: { format: { type: "json_schema" as const, name: this.spec.output.name, schema: this.spec.output.schema, strict: true } } } : {}),
    };

    let response: Response;
    try {
      this.client ??= this.responses();
      response = await this.client.create(params, { signal: opts.signal, timeout: opts.timeoutMs });
    } catch (e) {
      throw toProviderError(this.provider, e);
    }
    if (response.status === "failed") {
      throw new ProviderError(this.provider, "server", `${NAME[this.provider]} could not complete the response: ${(response.error?.message ?? "unknown error").slice(0, 200)}`);
    }

    const output = response.output ?? [];
    const disallowed: string[] = [];
    const hostedTools: HostedToolActivity[] = [];
    const retrievedUrls: string[] = [];
    const domains = this.spec.webSearch?.allowedDomains ?? [];
    const keepUrl = (url: string) => {
      if (hostAllowed(url, domains)) retrievedUrls.push(url);
      else disallowed.push(`source outside approved domains: ${safeHost(url)}`);
    };
    const toolCalls: ToolCall[] = [];
    let refusal: string | undefined;
    let text = "";
    let searchCalls = 0;
    let pageOpens = 0;

    for (const item of output) {
      if (!ALLOWED_OUTPUT.has(item.type)) {
        disallowed.push(item.type);
        continue;
      }
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "refusal") refusal = part.refusal;
          else if (part.type === "output_text") {
            text += part.text;
            for (const a of part.annotations ?? []) if (a.type === "url_citation") keepUrl(a.url);
          }
        }
      } else if (item.type === "function_call") {
        toolCalls.push({ id: item.call_id, name: item.name, input: parseJson(item.arguments) ?? { _unparseable: item.arguments.slice(0, 200) } });
      } else if (item.type === "web_search_call") {
        searchCalls++;
        const a = item.action as { type?: string; query?: string; url?: string; sources?: { url: string }[] } | undefined;
        if (a?.type === "open_page") pageOpens++;
        for (const s of a?.sources ?? []) keepUrl(s.url);
        if (a?.url) keepUrl(a.url);
        hostedTools.push({
          callId: item.id,
          tool: a?.type === "open_page" ? "web_fetch" : "web_search",
          detail: String(a?.query ?? a?.url ?? "").slice(0, 300),
          ok: item.status === "completed",
          resultSummary: item.status === "completed" ? `${a?.sources?.length ?? 0} sources` : `status: ${item.status}`,
        });
      }
    }
    // xAI may also list citations at the top level of the response.
    const extra = (response as unknown as { citations?: unknown }).citations;
    if (Array.isArray(extra)) for (const c of extra) if (typeof c === "string") keepUrl(c);
    this.searches += searchCalls;

    // Replay: keep the turn in the transcript (reasoning only when it can be replayed).
    this.history.push(...(output.filter((o) => this.replayable(o)) as unknown as ResponseInputItem[]));

    const u = response.usage;
    const cached = u?.input_tokens_details?.cached_tokens ?? 0;
    const usage = {
      inputTokens: Math.max(0, (u?.input_tokens ?? 0) - cached),
      cachedInputTokens: cached,
      cacheWriteTokens: 0,
      outputTokens: u?.output_tokens ?? 0,
      webSearches: searchCalls,
      webFetches: pageOpens,
    };
    const incomplete = response.incomplete_details?.reason;
    const stop =
      refusal !== undefined || incomplete === "content_filter"
        ? "refusal"
        : incomplete === "max_output_tokens"
          ? "max-tokens"
          : toolCalls.length > 0
            ? "tool-calls"
            : "end";
    return {
      provider: this.provider,
      model: response.model || this.model,
      stop,
      refusalDetail: refusal?.slice(0, 200) ?? (incomplete === "content_filter" ? "content filter" : undefined),
      text,
      toolCalls,
      structured: this.spec.output && stop === "end" ? parseJson(text) : undefined,
      usage,
      costMicros: estimateCostMicros(this.provider, usage, priceOf(this.model)),
      hostedTools,
      retrievedUrls: [...new Set(retrievedUrls)],
      disallowed,
    };
  }

  private replayable(o: ResponseOutputItem): boolean {
    if (o.type === "message" || o.type === "function_call") return true;
    if (o.type === "reasoning") return this.cfg.replayReasoning;
    if (o.type === "web_search_call") return this.provider === "openai";
    return false;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.slice(0, 100);
  } catch {
    return "invalid URL";
  }
}

import type { ProviderId } from "./catalog";

/**
 * COMMON MODEL-PROVIDER INTERFACE for Claude (Anthropic), OpenAI and Grok (xAI).
 *
 * Agents talk to a `ChatSession`: one conversation with one model, driven
 * turn by turn. Each adapter translates to its provider's official SDK and
 * keeps the provider's native transcript internally (serializable through
 * `snapshot()` so a task can resume after a retry).
 *
 * What the interface covers:
 * - requests (system prompt, user text, effort, output limit, timeout/abort)
 * - structured responses (`output` JSON schema → `TurnResult.structured`)
 * - tool use (strict client function tools → `toolCalls`; results sent back)
 * - read-only web search with a domain allowlist (provider-hosted)
 * - errors (`ProviderError` with a kind and retry decision, see errors.ts)
 * - retries (transient errors are retried by the SDK with backoff; the
 *   execution queue retries whole attempts)
 * - token usage + estimated cost per call (`TurnResult.usage`, cost.ts)
 * - model availability (`ModelProvider.listModels`, live from the provider)
 * - provider-specific safety restrictions (`ModelProvider.restrictions`)
 *
 * Adapters NEVER expose other provider features (code execution, files,
 * computer use, MCP, image generation, ...): only what is declared here.
 */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema; must be strict-compatible (all properties required, no extras). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
}

export interface SessionSpec {
  model: string;
  system: string;
  tools?: ToolSpec[];
  /** Ask for a JSON response matching this schema (instead of free text). */
  output?: { name: string; schema: Record<string, unknown> };
  /** Provider-hosted, read-only web search limited to these domains. */
  webSearch?: { allowedDomains: string[]; maxUses: number; fetch: boolean; maxFetches: number };
  maxOutputTokens: number;
  effort?: "low" | "medium" | "high";
}

export interface TurnInput {
  text?: string;
  toolResults?: ToolResult[];
}

export interface TokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  webSearches: number;
  webFetches: number;
}

/** Provider-hosted tool activity (web search / page fetch) seen in a turn. */
export interface HostedToolActivity {
  callId: string;
  tool: "web_search" | "web_fetch";
  detail: string;
  ok: boolean;
  resultSummary: string;
}

export type StopKind = "end" | "tool-calls" | "max-tokens" | "refusal" | "paused";

export interface TurnResult {
  provider: ProviderId;
  /** The model that actually served the turn (may be a refusal fallback). */
  model: string;
  stop: StopKind;
  refusalDetail?: string;
  text: string;
  toolCalls: ToolCall[];
  /** Parsed JSON when `output` was requested and the reply parsed. */
  structured?: unknown;
  usage: TokenUsage;
  /** Estimated cost of this call in micro-dollars (catalog prices). */
  costMicros: number;
  hostedTools: HostedToolActivity[];
  /** URLs actually retrieved by hosted web tools in this turn. */
  retrievedUrls: string[];
  /** Tools the model tried to use that are not allowed (refused by the adapter). */
  disallowed: string[];
}

export interface ChatSession {
  readonly provider: ProviderId;
  readonly model: string;
  /** Upper bound of the next call's cost, for budget reservation. */
  worstCaseNextMicros(pendingInputChars: number): number;
  send(input: TurnInput, opts: { signal: AbortSignal; timeoutMs: number }): Promise<TurnResult>;
  /** Serializable transcript for persistent task context. */
  snapshot(): SessionSnapshot;
}

export interface SessionSnapshot {
  provider: ProviderId;
  model: string;
  history: unknown[];
}

export interface ProviderStatus {
  ready: boolean;
  reason: string;
  keyConfigured: boolean;
  enabled: boolean;
}

export interface ModelProvider {
  readonly id: ProviderId;
  status(): ProviderStatus;
  /** Live list of model IDs the app's key can use (throws ProviderError). */
  listModels(signal?: AbortSignal): Promise<string[]>;
  openSession(spec: SessionSpec, resume?: SessionSnapshot | null): ChatSession;
  /** Human-readable safety restrictions this adapter enforces. */
  readonly restrictions: readonly string[];
}

import type { ModelProviderId } from "@/domain/agent";

/**
 * Provider-agnostic model interface for Claude (Anthropic), OpenAI, and
 * Grok (xAI). Adapters are NOT implemented yet - no SDKs are installed and no
 * network calls are made. This contract exists so the execution runtime can be
 * built against one interface.
 *
 * Adapter rules (see docs/SECURITY.md):
 * - Read API keys lazily, server-side only, from the secret store / env.
 * - Never log prompts containing secrets, never log keys.
 * - Respect AGENT_EXECUTION_ENABLED and the per-provider enable flag.
 * - Enforce per-run token and cost budgets before calling the provider.
 */
export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  /** Abort long-running calls (user cancel, budget exceeded, shutdown). */
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: "end" | "max-tokens" | "tool-use" | "other";
}

export interface ModelProvider {
  readonly id: ModelProviderId;
  isEnabled(): boolean;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export class ProviderDisabledError extends Error {
  constructor(provider: ModelProviderId) {
    super(`Model provider "${provider}" is disabled.`);
    this.name = "ProviderDisabledError";
  }
}

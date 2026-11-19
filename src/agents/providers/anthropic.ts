import Anthropic from "@anthropic-ai/sdk";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import type { Messages } from "../research/agent";

/**
 * ANTHROPIC PROVIDER - the only place the app's Claude API key is read.
 *
 * Isolation from any other Claude credential on the machine (for example a
 * Claude Code session running alongside):
 * - The key comes ONLY from AEHQ_ANTHROPIC_API_KEY. It is passed explicitly,
 *   so the SDK does not fall back to ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
 *   `ant` profiles or workload-identity variables.
 * - The endpoint is pinned to https://api.anthropic.com, so ANTHROPIC_BASE_URL
 *   is ignored.
 * - The key is never logged, stored, or returned.
 */
export const ANTHROPIC_API_URL = "https://api.anthropic.com";

export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export function anthropicStatus(): { ready: boolean; reason: string } {
  const c = loadRuntimeConfig();
  if (!c.agentExecutionEnabled) return { ready: false, reason: "Agent execution is disabled (AGENT_EXECUTION_ENABLED)." };
  if (!c.providers.anthropic.enabled) return { ready: false, reason: "The Anthropic provider is disabled (PROVIDER_ANTHROPIC_ENABLED)." };
  if (!c.anthropicKeyConfigured) return { ready: false, reason: "No API key for the app (AEHQ_ANTHROPIC_API_KEY is not set)." };
  return { ready: true, reason: "Key configured (validated on first use)." };
}

/** Creates the Messages client for agent runs. Throws when not configured. */
export function createAnthropicMessages(): Messages {
  const status = anthropicStatus();
  if (!status.ready) throw new ProviderNotConfiguredError(status.reason);
  const client = new Anthropic({
    apiKey: process.env.AEHQ_ANTHROPIC_API_KEY!.trim(),
    baseURL: ANTHROPIC_API_URL,
    maxRetries: 2,
    timeout: 10 * 60_000,
  });
  return client.beta.messages;
}

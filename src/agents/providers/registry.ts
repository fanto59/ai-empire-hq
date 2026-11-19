import type { ModelProviderId } from "@/domain/agent";
import { ProviderDisabledError, type ModelProvider } from "./types";

/**
 * Placeholder provider: always disabled, never makes network calls.
 * Anthropic is used by the Research Agent through anthropic.ts (tool-use
 * loop); OpenAI and xAI remain disabled placeholders.
 */
function disabledProvider(id: ModelProviderId): ModelProvider {
  return {
    id,
    isEnabled: () => false,
    generate: async () => {
      throw new ProviderDisabledError(id);
    },
  };
}

const providers: Record<ModelProviderId, ModelProvider> = {
  anthropic: disabledProvider("anthropic"),
  openai: disabledProvider("openai"),
  xai: disabledProvider("xai"),
};

export function getProvider(id: ModelProviderId): ModelProvider {
  return providers[id];
}

export const PROVIDER_LABELS: Record<ModelProviderId, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  xai: "Grok (xAI)",
};

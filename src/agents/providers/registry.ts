import { MODELS, PROVIDER_LABELS, type ProviderId } from "./catalog";
import { createAnthropicProvider } from "./anthropic";
import { ProviderError } from "./errors";
import { createCompatProvider } from "./openai-compatible";
import type { ModelProvider } from "./types";

/**
 * PROVIDER REGISTRY (server-only). One adapter per provider; each reads only
 * its own AEHQ_* key at call time. Nothing here returns a key.
 */
export { PROVIDER_LABELS };
export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openai", "xai"];

const providers: Record<ProviderId, ModelProvider> = {
  anthropic: createAnthropicProvider(),
  openai: createCompatProvider("openai"),
  xai: createCompatProvider("xai"),
};

export function getProvider(id: ProviderId): ModelProvider {
  return providers[id];
}

export type ProviderLookup = (id: ProviderId) => ModelProvider;

export interface ModelAvailability {
  /** "available": the provider's live model list includes it. */
  state: "available" | "unavailable" | "unverified";
  checkedAt: string | null;
  detail: string;
}

const CACHE_MS = 10 * 60_000;
const cache = new Map<ProviderId, { at: number; ids: Set<string> | null; detail: string }>();

/**
 * Live model availability per provider, cached for 10 minutes. When the
 * provider is not configured, every model is "unverified" (and assignments
 * cannot be verified until a key is set).
 */
export async function modelAvailability(lookup: ProviderLookup = getProvider, opts: { refresh?: boolean; now?: number } = {}): Promise<Map<string, ModelAvailability>> {
  const now = opts.now ?? Date.now();
  const out = new Map<string, ModelAvailability>();
  await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const provider = lookup(id);
      let entry = cache.get(id);
      if (!entry || opts.refresh || now - entry.at > CACHE_MS) {
        const status = provider.status();
        if (!status.ready) {
          entry = { at: now, ids: null, detail: status.reason };
        } else {
          try {
            entry = { at: now, ids: new Set(await provider.listModels(AbortSignal.timeout(15_000))), detail: "Checked with the provider's live model list." };
          } catch (e) {
            entry = { at: now, ids: null, detail: e instanceof ProviderError ? e.message : "Model list unavailable." };
          }
        }
        cache.set(id, entry);
      }
      for (const m of MODELS.filter((x) => x.provider === id)) {
        out.set(m.id, {
          state: entry.ids === null ? "unverified" : entry.ids.has(m.id) ? "available" : "unavailable",
          checkedAt: entry.ids === null ? null : new Date(entry.at).toISOString(),
          detail: entry.ids === null ? entry.detail : entry.ids.has(m.id) ? "Listed by the provider for the app's key." : "Not offered to the app's key by the provider.",
        });
      }
    }),
  );
  return out;
}

export function clearAvailabilityCache(): void {
  cache.clear();
}

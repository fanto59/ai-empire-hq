import type { ModelProviderId } from "@/domain/agent";

/**
 * MODEL CATALOG - the models an administrator may assign to agents, with the
 * prices used for spending limits. Pure data, safe to import anywhere.
 *
 * Model IDs and prices were checked on 2026-11-19 against the providers'
 * published documentation (Anthropic: Claude API docs "Models" / "Pricing";
 * OpenAI: developers.openai.com models + pricing pages; xAI: docs.x.ai
 * "Models and pricing"). The catalog is NOT trusted as proof that a model is
 * available: before a model can be assigned, the app asks the provider's live
 * Models endpoint with the app's own key (see providers/registry.ts).
 *
 * Prices are USD per million tokens. Where official sources disagreed, the
 * HIGHER figure is used (`priceStatus: "conservative"`), and unknown cached
 * input discounts are priced at the full input rate, so limits never
 * under-count spending.
 */
export type ProviderId = ModelProviderId;

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok: number;
  /** Prompt-cache writes (Anthropic); priced at 2x input when not stated. */
  cacheWritePerMTok: number;
  /** Requests whose input exceeds this many tokens are billed at `longContextMultiplier`. */
  longContextAbove?: number;
  longContextMultiplier?: number;
}

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label: string;
  tier: "flagship" | "balanced" | "economy";
  price: ModelPrice;
  priceStatus: "official" | "conservative";
  /** Accepts a reasoning-effort setting (low/medium/high). */
  effort: boolean;
  /** Supports the provider's web search tool with a domain allowlist. */
  webSearch: boolean;
  /** Anthropic server-side refusal fallback model, priced in worst cases. */
  refusalFallback?: string;
  /** Selectable in the model configuration screen (fallback-only models are not). */
  assignable: boolean;
  note?: string;
}

export const CATALOG_CHECKED_ON = "2026-11-19";

const p = (input: number, output: number, cached = input, extra: Partial<ModelPrice> = {}): ModelPrice => ({
  inputPerMTok: input,
  outputPerMTok: output,
  cachedInputPerMTok: cached,
  cacheWritePerMTok: input * 2,
  ...extra,
});

export const MODELS: readonly ModelInfo[] = [
  // ---- Anthropic (Claude) ----
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", tier: "flagship", price: p(4, 20, 0.2), priceStatus: "official", effort: true, webSearch: true, refusalFallback: "claude-opus-4-8", assignable: true },
  { id: "claude-fable-5-2", provider: "anthropic", label: "Claude Fable 5.2", tier: "flagship", price: p(8, 40, 0.2), priceStatus: "official", effort: true, webSearch: true, refusalFallback: "claude-opus-4-8", assignable: true, note: "Most capable; twice the price of Opus 5.5." },
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", tier: "balanced", price: p(2, 10, 0.1), priceStatus: "official", effort: true, webSearch: true, refusalFallback: "claude-sonnet-5", assignable: true },
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", tier: "economy", price: p(0.1, 0.5, 0.01, { longContextAbove: 100_000, longContextMultiplier: 5 }), priceStatus: "official", effort: true, webSearch: false, assignable: true },
  { id: "claude-opus-4-8", provider: "anthropic", label: "Claude Opus 4.8 (refusal fallback)", tier: "flagship", price: p(5, 25, 0.5), priceStatus: "official", effort: true, webSearch: true, assignable: false },
  { id: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5 (refusal fallback)", tier: "balanced", price: p(2, 10, 0.2), priceStatus: "official", effort: true, webSearch: true, assignable: false },
  // ---- OpenAI ----
  { id: "gpt-6.2-astra", provider: "openai", label: "GPT-6.2 Astra", tier: "flagship", price: p(10, 50, 1), priceStatus: "conservative", effort: true, webSearch: true, assignable: true, note: "OpenAI pages listed $8/$40 and $10/$50; the higher price is used." },
  { id: "gpt-6.2-sol", provider: "openai", label: "GPT-6.2 Sol", tier: "balanced", price: p(2, 10, 0.2), priceStatus: "official", effort: true, webSearch: true, assignable: true },
  { id: "gpt-6.1-terra", provider: "openai", label: "GPT-6.1 Terra", tier: "balanced", price: p(1, 5), priceStatus: "conservative", effort: true, webSearch: true, assignable: true },
  { id: "gpt-6-luna", provider: "openai", label: "GPT-6 Luna", tier: "economy", price: p(0.1, 0.5), priceStatus: "conservative", effort: true, webSearch: true, assignable: true },
  // ---- xAI (Grok) ----
  { id: "grok-4.7", provider: "xai", label: "Grok 4.7", tier: "flagship", price: p(2, 6, 0.5, { longContextAbove: 200_000, longContextMultiplier: 2 }), priceStatus: "official", effort: false, webSearch: true, assignable: true },
  { id: "grok-4.3", provider: "xai", label: "Grok 4.3", tier: "balanced", price: p(1.25, 2.5, 0.2, { longContextAbove: 200_000, longContextMultiplier: 2 }), priceStatus: "conservative", effort: false, webSearch: true, assignable: true },
];

/** Price of one web search request per provider, in micro-dollars (conservative where unpublished). */
export const WEB_SEARCH_MICROS: Record<ProviderId, number> = {
  anthropic: 10_000, // $10 per 1,000
  openai: 25_000, // conservative: highest published tool-call rate
  xai: 25_000, // conservative: not confirmed
};

/** Price used for any model not in the catalog: the most expensive known rate. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = p(10, 50, 1);

export function findModel(id: string | null | undefined): ModelInfo | undefined {
  return id ? MODELS.find((m) => m.id === id) : undefined;
}

export function modelsFor(provider: ProviderId, opts: { assignableOnly?: boolean } = {}): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider && (!opts.assignableOnly || m.assignable));
}

// ---------------------------------------------------------------------------
// Work types: the INITIAL provider for each kind of work. Administrators can
// change any agent's provider and model on the model configuration screen.
// ---------------------------------------------------------------------------
export type WorkType = "engineering" | "strategy" | "research";

export const WORK_TYPES: Record<WorkType, { label: string; provider: ProviderId; model: string }> = {
  engineering: { label: "Engineering & complex execution", provider: "anthropic", model: "claude-opus-5-5" },
  strategy: { label: "Strategy & structured analysis", provider: "openai", model: "gpt-6.2-sol" },
  research: { label: "Research & trend monitoring", provider: "xai", model: "grok-4.7" },
};

/** Cheapest model per provider, used by the low-cost connection tests. */
export const SMOKE_TEST_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-haiku-5-5",
  openai: "gpt-6-luna",
  xai: "grok-4.3",
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
  xai: "Grok (xAI)",
};

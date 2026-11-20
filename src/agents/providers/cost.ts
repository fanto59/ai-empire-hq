import { UNKNOWN_MODEL_PRICE, WEB_SEARCH_MICROS, findModel, type ModelPrice, type ProviderId } from "./catalog";
import type { TokenUsage } from "./types";

import { MICROS_PER_USD } from "@/domain/money";

export { MICROS_PER_USD, formatUsd } from "@/domain/money";

export function priceOf(model: string | null | undefined): ModelPrice {
  return findModel(model)?.price ?? UNKNOWN_MODEL_PRICE;
}

/** Highest price of each component across models (e.g. primary + refusal fallback). */
export function maxPriceOf(models: readonly (string | null | undefined)[]): ModelPrice {
  const prices = models.map(priceOf);
  const max = (k: keyof ModelPrice) => Math.max(...prices.map((x) => (x[k] as number | undefined) ?? 0));
  return {
    inputPerMTok: max("inputPerMTok"),
    outputPerMTok: max("outputPerMTok"),
    cachedInputPerMTok: max("cachedInputPerMTok"),
    cacheWritePerMTok: max("cacheWritePerMTok"),
    longContextAbove: Math.min(...prices.map((x) => x.longContextAbove ?? Infinity)),
    longContextMultiplier: max("longContextMultiplier") || undefined,
  };
}

/**
 * Estimated cost of one response, rounded UP. `inputTokens` are the uncached
 * input tokens; cached reads and cache writes are priced separately.
 */
export function estimateCostMicros(provider: ProviderId, usage: TokenUsage, price: ModelPrice): number {
  const totalInput = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
  const mult = price.longContextAbove !== undefined && totalInput > price.longContextAbove ? (price.longContextMultiplier ?? 1) : 1;
  const usd =
    (mult *
      (usage.inputTokens * price.inputPerMTok +
        usage.cachedInputTokens * price.cachedInputPerMTok +
        usage.cacheWriteTokens * price.cacheWritePerMTok +
        usage.outputTokens * price.outputPerMTok)) /
    1_000_000;
  return Math.ceil(usd * MICROS_PER_USD) + usage.webSearches * WEB_SEARCH_MICROS[provider];
}

/**
 * Worst-case cost of the NEXT request, reserved against the budget before it
 * is sent: estimated input (chars / 3, generous, + 20k for tool results the
 * provider may add) + the full output allowance + every remaining search.
 */
export function worstCaseMicros(provider: ProviderId, estimatedInputChars: number, maxOutputTokens: number, searchesRemaining: number, price: ModelPrice): number {
  return estimateCostMicros(
    provider,
    {
      inputTokens: Math.ceil(estimatedInputChars / 3) + 20_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: maxOutputTokens,
      webSearches: searchesRemaining,
      webFetches: 0,
    },
    price,
  );
}

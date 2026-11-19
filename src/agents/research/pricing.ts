/**
 * MODEL PRICING (USD per million tokens) used for spending limits.
 *
 * Source: Anthropic pricing as published 2026-11 (Claude API docs, "Pricing").
 * Verify against https://platform.claude.com/docs/en/about-claude/pricing
 * before raising budgets. Costs here are deliberately CONSERVATIVE: unknown
 * models are priced at the most expensive known rate, cache writes at 2x
 * input, and every web search at $10 / 1,000.
 *
 * Money is handled in integer micro-dollars (1 USD = 1_000_000 µ$).
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01 },
  "claude-fable-5-2": { inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.2 },
};

const MOST_EXPENSIVE: ModelPrice = { inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 1 };
export const WEB_SEARCH_MICROS = 10_000; // $10 per 1,000 searches
export const MICROS_PER_USD = 1_000_000;

export function priceFor(model: string | null | undefined): ModelPrice {
  return (model && MODEL_PRICES[model]) || MOST_EXPENSIVE;
}

export function maxPrice(models: readonly (string | null | undefined)[]): ModelPrice {
  const prices = models.map(priceFor);
  return {
    inputPerMTok: Math.max(...prices.map((p) => p.inputPerMTok)),
    outputPerMTok: Math.max(...prices.map((p) => p.outputPerMTok)),
    cacheReadPerMTok: Math.max(...prices.map((p) => p.cacheReadPerMTok)),
  };
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** Cost of one response in micro-dollars, rounded UP. */
export function costMicros(usage: UsageLike, price: ModelPrice): number {
  const usd =
    (usage.input_tokens * price.inputPerMTok +
      (usage.cache_creation_input_tokens ?? 0) * price.inputPerMTok * 2 +
      (usage.cache_read_input_tokens ?? 0) * price.cacheReadPerMTok +
      usage.output_tokens * price.outputPerMTok) /
    1_000_000;
  return Math.ceil(usd * MICROS_PER_USD) + (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_MICROS;
}

/**
 * Worst-case cost of the NEXT request, reserved against the budget before it
 * is sent: estimated input (chars / 3, generous) + the full output allowance
 * + every remaining web search.
 */
export function worstCaseMicros(estimatedInputChars: number, maxOutputTokens: number, searchesRemaining: number, price: ModelPrice): number {
  return costMicros(
    {
      input_tokens: Math.ceil(estimatedInputChars / 3) + 20_000, // + tool results the server may add this turn
      output_tokens: maxOutputTokens,
      server_tool_use: { web_search_requests: searchesRemaining },
    },
    price,
  );
}

export const formatUsd = (micros: number) => `$${(micros / MICROS_PER_USD).toFixed(micros < 10_000 ? 4 : 2)}`;

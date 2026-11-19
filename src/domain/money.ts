/** Money is handled in integer micro-dollars (1 USD = 1_000_000). */
export const MICROS_PER_USD = 1_000_000;

export const formatUsd = (micros: number) =>
  micros === 0 ? "$0.00" : `$${(micros / MICROS_PER_USD).toFixed(Math.abs(micros) < 10_000 ? 4 : 2)}`;

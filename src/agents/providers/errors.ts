import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { PROVIDER_LABELS, type ProviderId } from "./catalog";

/**
 * Provider-neutral errors. Every adapter maps its SDK's typed exceptions to a
 * ProviderError so workers decide retries the same way for all providers.
 * Messages are safe to show: they never contain keys or request bodies.
 */
export type ProviderErrorKind =
  | "not-configured"
  | "authentication"
  | "permission"
  | "model-not-found"
  | "rate-limited"
  | "bad-request"
  | "server"
  | "connection"
  | "timeout"
  | "unsupported";

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["rate-limited", "server", "connection", "timeout"]);

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(provider: ProviderId, kind: ProviderErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = status;
    this.retryable = RETRYABLE.has(kind);
  }
}

/** Kept for callers that check the name; equivalent to kind "not-configured". */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(provider: ProviderId, message: string) {
    super(provider, "not-configured", message);
    this.name = "ProviderNotConfiguredError";
  }
}

const KEY_VAR: Record<ProviderId, string> = { anthropic: "AEHQ_ANTHROPIC_API_KEY", openai: "AEHQ_OPENAI_API_KEY", xai: "AEHQ_XAI_API_KEY" };

/** Maps an SDK exception (either SDK) to a ProviderError. Unknown errors are rethrown as-is. */
export function toProviderError(provider: ProviderId, error: unknown): unknown {
  if (error instanceof ProviderError) return error;
  const name = PROVIDER_LABELS[provider];
  const status = (error as { status?: unknown })?.status;
  const code = typeof status === "number" ? status : null;
  const msg = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  const isApiError = error instanceof Anthropic.APIError || error instanceof OpenAI.APIError;
  if (!isApiError) return error;
  if (error instanceof Anthropic.APIUserAbortError || error instanceof OpenAI.APIUserAbortError) return new ProviderError(provider, "timeout", `${name} request was cancelled (time limit).`);
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError(provider, "timeout", `${name} request timed out.`);
  if (error instanceof Anthropic.APIConnectionError || error instanceof OpenAI.APIConnectionError) return new ProviderError(provider, "connection", `Could not reach ${name}.`);
  switch (code) {
    case 401:
      return new ProviderError(provider, "authentication", `${name} rejected the app's API key (401). Check ${KEY_VAR[provider]}.`, code);
    case 403:
      return new ProviderError(provider, "permission", `The ${name} key is not allowed to use this model or feature (403).`, code);
    case 404:
      return new ProviderError(provider, "model-not-found", `${name} does not offer this model to the app's key (404).`, code);
    case 429:
      return new ProviderError(provider, "rate-limited", `${name} rate limit reached (429).`, code);
    case 400:
    case 409:
    case 413:
    case 422:
      return new ProviderError(provider, "bad-request", `${name} rejected the request (${code}): ${msg}`, code);
    default:
      if (code !== null && code >= 500) return new ProviderError(provider, "server", `${name} server error (${code}).`, code);
      return new ProviderError(provider, "bad-request", `${name} API error ${code ?? ""}: ${msg}`, code);
  }
}

export const PROVIDER_KEY_VARS = KEY_VAR;

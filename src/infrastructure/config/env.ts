/**
 * Server-side runtime configuration.
 *
 * SECURITY RULES
 * - Only import this module from server code (route handlers, server
 *   components, src/backend, src/agents runtime). ESLint blocks imports from
 *   src/frontend.
 * - This module never reads API keys yet. When provider adapters are built,
 *   keys are read lazily inside the adapter, never logged, and never returned
 *   from any function exported here.
 * - Every flag defaults to the SAFE value (disabled) when unset or invalid.
 */

export type AppEnv = "development" | "staging" | "production";
export type ProviderId = "anthropic" | "openai" | "xai";

export interface RuntimeConfig {
  appEnv: AppEnv;
  agentExecutionEnabled: boolean;
  providers: Record<ProviderId, { enabled: boolean }>;
}

const APP_ENVS: readonly AppEnv[] = ["development", "staging", "production"];

/** Strict boolean parse: only the literal string "true" enables a flag. */
function flag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseAppEnv(value: string | undefined): AppEnv {
  return APP_ENVS.find((env) => env === value) ?? "development";
}

export function loadRuntimeConfig(source: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    appEnv: parseAppEnv(source.APP_ENV),
    agentExecutionEnabled: flag(source.AGENT_EXECUTION_ENABLED),
    providers: {
      anthropic: { enabled: flag(source.PROVIDER_ANTHROPIC_ENABLED) },
      openai: { enabled: flag(source.PROVIDER_OPENAI_ENABLED) },
      xai: { enabled: flag(source.PROVIDER_XAI_ENABLED) },
    },
  };
}

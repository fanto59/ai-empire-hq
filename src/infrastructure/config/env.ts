import path from "node:path";
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
  /**
   * Knowledge vault directory (absolute). Defaults to the committed sample
   * vault. Real vaults belong under ./vaults/ (git-ignored) or a mounted
   * volume; the app never reaches outside this server for notes.
   */
  knowledgeVaultDir: string;
  agentExecutionEnabled: boolean;
  providers: Record<ProviderId, { enabled: boolean }>;
}

export const DEFAULT_KNOWLEDGE_VAULT = "knowledge/sample-vault";

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
    knowledgeVaultDir: path.resolve(/*turbopackIgnore: true*/ process.cwd(), source.KNOWLEDGE_VAULT_DIR?.trim() || DEFAULT_KNOWLEDGE_VAULT),
    agentExecutionEnabled: flag(source.AGENT_EXECUTION_ENABLED),
    providers: {
      anthropic: { enabled: flag(source.PROVIDER_ANTHROPIC_ENABLED) },
      openai: { enabled: flag(source.PROVIDER_OPENAI_ENABLED) },
      xai: { enabled: flag(source.PROVIDER_XAI_ENABLED) },
    },
  };
}

import path from "node:path";
/**
 * Server-side runtime configuration.
 *
 * SECURITY RULES
 * - Only import this module from server code (route handlers, server
 *   components, src/backend, src/agents runtime). ESLint blocks imports from
 *   src/frontend.
 * - This module never returns API keys. It only reports WHETHER a key is
 *   configured. Keys are read lazily inside the provider adapter
 *   (src/agents/providers/anthropic.ts) and never logged.
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
  /**
   * Operational database. postgres://… for a real server, pglite:<dir> for
   * embedded PostgreSQL. Defaults to an embedded database in .data/ outside
   * production; in production it must be set explicitly (else: unavailable).
   */
  databaseUrl: string | null;
  /** Organization shown on the dashboard (seeded test org by default). */
  organizationSlug: string;
  agentExecutionEnabled: boolean;
  providers: Record<ProviderId, { enabled: boolean }>;
  /** True when AEHQ_ANTHROPIC_API_KEY is set (the value is never exposed). */
  anthropicKeyConfigured: boolean;
  /** Which app keys are set: AEHQ_ANTHROPIC_API_KEY / AEHQ_OPENAI_API_KEY / AEHQ_XAI_API_KEY (values never exposed). */
  providerKeys: Record<ProviderId, boolean>;
  /** "in-process" runs the research worker inside the web server. */
  workerMode: "off" | "in-process";
  research: ResearchConfig;
}

export interface ResearchConfig {
  effort: "low" | "medium" | "high";
  /** Approved public domains the agent may search and read. */
  allowedDomains: string[];
  /** Spending cap per task attempt, in micro-dollars. */
  maxRunMicros: number;
  maxSearches: number;
  maxFetches: number;
}

export const DEFAULT_RESEARCH_DOMAINS = ["wikipedia.org", "wikimedia.org", "nasa.gov", "noaa.gov", "britannica.com"];

export const DEFAULT_KNOWLEDGE_VAULT = "knowledge/sample-vault";
/** Development default: a git-ignored test vault the agent writes reports into. */
export const DEFAULT_DEV_KNOWLEDGE_VAULT = ".data/knowledge-vault";
export const DEFAULT_DEV_DATABASE = "pglite:.data/pglite";

const APP_ENVS: readonly AppEnv[] = ["development", "staging", "production"];

/** Strict boolean parse: only the literal string "true" enables a flag. */
function flag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function intIn(value: string | undefined, lo: number, hi: number, def: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : def;
}

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function parseDomains(value: string | undefined): string[] {
  if (!value?.trim()) return DEFAULT_RESEARCH_DOMAINS;
  return [...new Set(value.split(",").map((d) => d.trim().toLowerCase()).filter((d) => DOMAIN.test(d)))].slice(0, 20);
}

function parseAppEnv(value: string | undefined): AppEnv {
  return APP_ENVS.find((env) => env === value) ?? "development";
}

export function loadRuntimeConfig(source: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    appEnv: parseAppEnv(source.APP_ENV),
    databaseUrl: source.DATABASE_URL?.trim() || (source.NODE_ENV === "production" ? null : DEFAULT_DEV_DATABASE),
    organizationSlug: source.AEHQ_ORGANIZATION?.trim() || "test-org",
    knowledgeVaultDir: path.resolve(
      /*turbopackIgnore: true*/ process.cwd(),
      source.KNOWLEDGE_VAULT_DIR?.trim() || (source.NODE_ENV === "production" ? DEFAULT_KNOWLEDGE_VAULT : DEFAULT_DEV_KNOWLEDGE_VAULT),
    ),
    agentExecutionEnabled: flag(source.AGENT_EXECUTION_ENABLED),
    providers: {
      anthropic: { enabled: flag(source.PROVIDER_ANTHROPIC_ENABLED) },
      openai: { enabled: flag(source.PROVIDER_OPENAI_ENABLED) },
      xai: { enabled: flag(source.PROVIDER_XAI_ENABLED) },
    },
    anthropicKeyConfigured: Boolean(source.AEHQ_ANTHROPIC_API_KEY?.trim()),
    providerKeys: {
      anthropic: Boolean(source.AEHQ_ANTHROPIC_API_KEY?.trim()),
      openai: Boolean(source.AEHQ_OPENAI_API_KEY?.trim()),
      xai: Boolean(source.AEHQ_XAI_API_KEY?.trim()),
    },
    workerMode: source.AGENT_WORKER?.trim() === "in-process" ? "in-process" : "off",
    research: {
      effort: (["low", "medium", "high"] as const).find((e) => e === source.RESEARCH_EFFORT?.trim()) ?? "medium",
      allowedDomains: parseDomains(source.RESEARCH_ALLOWED_DOMAINS),
      maxRunMicros: Math.round(Number(source.RESEARCH_MAX_COST_USD ?? "1.00") * 1_000_000) || 1_000_000,
      maxSearches: intIn(source.RESEARCH_MAX_SEARCHES, 0, 20, 5),
      maxFetches: intIn(source.RESEARCH_MAX_FETCHES, 0, 20, 3),
    },
  };
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRuntimeConfig } from "./env";

test("everything is disabled by default", () => {
  const config = loadRuntimeConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.appEnv, "development");
  assert.equal(config.agentExecutionEnabled, false);
  assert.ok(Object.values(config.providers).every((p) => !p.enabled));
  assert.ok(config.knowledgeVaultDir.endsWith(".data/knowledge-vault"));
  assert.ok(loadRuntimeConfig({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv).knowledgeVaultDir.endsWith("knowledge/sample-vault"));
  assert.equal(config.anthropicKeyConfigured, false);
  assert.equal(config.workerMode, "off");
  assert.equal(config.research.model, "claude-opus-5-5");
  assert.ok(config.research.allowedDomains.includes("wikipedia.org"));
  assert.equal(config.databaseUrl, "pglite:.data/pglite");
  assert.equal(loadRuntimeConfig({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv).databaseUrl, null);
});

test("only the exact string 'true' enables a flag", () => {
  const on = loadRuntimeConfig({ AGENT_EXECUTION_ENABLED: "true" } as unknown as NodeJS.ProcessEnv);
  const off = loadRuntimeConfig({ AGENT_EXECUTION_ENABLED: "1" } as unknown as NodeJS.ProcessEnv);
  assert.equal(on.agentExecutionEnabled, true);
  assert.equal(off.agentExecutionEnabled, false);
});

test("research config is validated and never exposes the key", () => {
  const c = loadRuntimeConfig({
    AEHQ_ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
    RESEARCH_ALLOWED_DOMAINS: "en.wikipedia.org, NOT A DOMAIN, nasa.gov,javascript:alert(1)",
    RESEARCH_MAX_SEARCHES: "999",
    RESEARCH_MAX_COST_USD: "0.25",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(c.anthropicKeyConfigured, true);
  assert.ok(!JSON.stringify(c).includes("sk-ant"), "the key never appears in config");
  assert.deepEqual(c.research.allowedDomains, ["en.wikipedia.org", "nasa.gov"]);
  assert.equal(c.research.maxSearches, 5);
  assert.equal(c.research.maxRunMicros, 250_000);
});

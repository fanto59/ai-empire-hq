import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRuntimeConfig } from "./env";

test("everything is disabled by default", () => {
  const config = loadRuntimeConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.appEnv, "development");
  assert.equal(config.agentExecutionEnabled, false);
  assert.ok(Object.values(config.providers).every((p) => !p.enabled));
  assert.ok(config.knowledgeVaultDir.endsWith("knowledge/sample-vault"));
  assert.equal(config.databaseUrl, "pglite:.data/pglite");
  assert.equal(loadRuntimeConfig({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv).databaseUrl, null);
});

test("only the exact string 'true' enables a flag", () => {
  const on = loadRuntimeConfig({ AGENT_EXECUTION_ENABLED: "true" } as unknown as NodeJS.ProcessEnv);
  const off = loadRuntimeConfig({ AGENT_EXECUTION_ENABLED: "1" } as unknown as NodeJS.ProcessEnv);
  assert.equal(on.agentExecutionEnabled, true);
  assert.equal(off.agentExecutionEnabled, false);
});

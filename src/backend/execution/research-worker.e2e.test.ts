import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { createAnthropicMessages } from "@/agents/providers/anthropic";
import { agentPermissions, budgets, executionEvents, knowledgeDocuments, modelUsage, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { monthStart } from "../budgets/spend-guard";
import { KnowledgeService, ownerContext } from "../knowledge";
import { createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { createResearchTask } from "../tasks/research";
import { ResearchWorker } from "./research-worker";

/**
 * LIVE END-TO-END TEST - calls the real Claude API and spends real money
 * (bounded: $1.00 hard cap, 3 searches, Wikipedia only).
 *
 * Runs only when explicitly enabled AND the app's own key is present:
 *   AEHQ_ANTHROPIC_API_KEY=... npm run test:e2e
 * It never uses any other Claude credential on the machine.
 *
 * Everything else is isolated: a throwaway database and a temporary
 * knowledge vault, deleted afterwards.
 */
const enabled = process.env.RUN_LIVE_E2E === "true" && Boolean(process.env.AEHQ_ANTHROPIC_API_KEY?.trim());
const QUESTION = "When was the Hubble Space Telescope launched, which space shuttle carried it, and what are its main scientific instruments?";

let tdb: TestDatabase;
let vault: string;
let f: Fixture;

before(async () => {
  if (!enabled) return;
  tdb = await createTestDatabase();
  vault = await fs.mkdtemp(path.join(os.tmpdir(), "aehq-e2e-vault-"));
  f = await createFixture(tdb.db, "e2e-test-org");
  await tdb.db.insert(agentPermissions).values(
    (["research.web_search", "research.web_fetch", "knowledge.write"] as const).map((permission) => ({ agentId: f.agents.research, permission, grantedBy: "e2e" })),
  );
  const periodStart = monthStart(new Date());
  await tdb.db.insert(budgets).values([
    { organizationId: f.orgId, businessId: null, periodStart, limitMicros: 1_000_000 },
    { organizationId: f.orgId, businessId: f.bizA, periodStart, limitMicros: 1_000_000 },
  ]);
});

after(async () => {
  if (!enabled) return;
  await tdb.close();
  await fs.rm(vault, { recursive: true, force: true });
});

test("live: research task → Claude with web search → verified report in the vault → completed", { timeout: 12 * 60_000 }, async (t) => {
  if (!enabled) {
    t.skip("set RUN_LIVE_E2E=true and AEHQ_ANTHROPIC_API_KEY to run (npm run test:e2e)");
    return;
  }
  // The provider requires these switches; set for this test process only.
  process.env.AGENT_EXECUTION_ENABLED = "true";
  process.env.PROVIDER_ANTHROPIC_ENABLED = "true";

  const { task } = await createResearchTask(tdb.db, userCtx(f.orgId), { businessId: f.bizA, question: QUESTION });
  assert.equal(task.state, "assigned");

  const worker = new ResearchWorker({
    db: tdb.db,
    knowledge: new KnowledgeService({ root: vault }),
    messages: createAnthropicMessages,
    config: {
      model: process.env.RESEARCH_MODEL?.trim() || "claude-opus-5-5",
      effort: "medium",
      allowedDomains: ["wikipedia.org"],
      maxRunMicros: 1_000_000,
      maxSearches: 3,
      maxFetches: 1,
    },
    workerId: "e2e-worker",
  });
  assert.equal(await worker.tick(), "processed");

  const [row] = await tdb.db.select().from(tasks).where(eq(tasks.id, task.id));
  const events = await tdb.db.select().from(executionEvents).where(eq(executionEvents.taskId, task.id));
  const usage = await tdb.db.select().from(modelUsage).where(eq(modelUsage.organizationId, f.orgId));
  const cost = usage.reduce((a, u) => a + u.costMicros, 0);
  console.log(`\n[e2e] state=${row!.state} attempt=${row!.attempt} cost=$${(cost / 1e6).toFixed(4)} calls=${usage.length}`);
  console.log(`[e2e] events: ${events.map((e) => e.type).join(", ")}`);
  console.log(`[e2e] ${row!.resultSummary ?? row!.lastError}`);

  assert.equal(row!.state, "completed", row!.lastError ?? "");
  assert.ok(events.some((e) => e.type === "tool.called" && e.origin === "live"), "web tool activity recorded");
  assert.ok(cost > 0 && cost <= 1_000_000, "spend recorded and within the cap");

  const [doc] = await tdb.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.taskId, task.id));
  const note = await new KnowledgeService({ root: vault }).readNote(ownerContext(), doc!.vaultPath);
  console.log(`[e2e] report: ${note.path}\n${note.body.split("\n").slice(0, 40).join("\n")}\n`);
  assert.deepEqual(note.meta.tasks, [task.id]);
  assert.match(note.body, /\| yes \|/, "at least one source was verified against retrieved pages");
  assert.match(note.body, /## Uncertain or unverified/);
  assert.match(note.body, /1990/, "the well-known launch year appears");
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { PROVIDER_LABELS, SMOKE_TEST_MODELS, type ProviderId } from "@/agents/providers/catalog";
import { PROVIDER_KEY_VARS } from "@/agents/providers/errors";
import { getProvider } from "@/agents/providers/registry";
import { guardedSend } from "@/agents/research/agent";
import { budgets, modelUsage } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { SpendGuard, monthStart } from "../budgets/spend-guard";
import { createFixture } from "../testing/fixtures";

/**
 * LOW-COST LIVE PROVIDER TESTS - one tiny request per provider on its
 * cheapest model, then a check of the usage record it produced.
 *
 *   npm run test:providers
 *
 * Each provider runs only if the app's own key for it is set
 * (AEHQ_ANTHROPIC_API_KEY / AEHQ_OPENAI_API_KEY / AEHQ_XAI_API_KEY); the
 * others are skipped. Cost: well under $0.01 per provider; every call is
 * still reserved against a $0.10 test budget first. A throwaway database is
 * used, so nothing reaches the dashboard.
 *
 * Per provider it verifies: the model is listed by the provider's live model
 * list (availability), a structured response comes back, token usage is
 * reported, the estimated cost is positive, and exactly one model_usage row
 * matches the response (provider, model, tokens, cost) and the budget.
 */
const enabled = process.env.RUN_LIVE_PROVIDER_TESTS === "true";
let tdb: TestDatabase;

before(async () => {
  if (enabled) tdb = await createTestDatabase();
});
after(async () => {
  if (enabled) await tdb.close();
});

for (const id of ["anthropic", "openai", "xai"] as ProviderId[]) {
  const model = SMOKE_TEST_MODELS[id];
  test(`live ${PROVIDER_LABELS[id]}: ${model} answers, and the usage record matches`, { timeout: 120_000 }, async (t) => {
    if (!enabled || !process.env[PROVIDER_KEY_VARS[id]]?.trim()) {
      t.skip(`set ${PROVIDER_KEY_VARS[id]} and run npm run test:providers`);
      return;
    }
    // The provider requires these switches; set for this test process only.
    process.env.AGENT_EXECUTION_ENABLED = "true";
    process.env[`PROVIDER_${id.toUpperCase()}_ENABLED`] = "true";
    const provider = getProvider(id);
    assert.equal(provider.status().ready, true, provider.status().reason);

    // 1. Availability: the provider's live list includes the model.
    const ids = await provider.listModels(AbortSignal.timeout(30_000));
    assert.ok(ids.includes(model), `${model} is not in ${id}'s live model list (${ids.slice(0, 20).join(", ")}...)`);

    // 2. One tiny structured request, reserved against a $0.10 budget.
    const f = await createFixture(tdb.db, `live-${id}`);
    await tdb.db.insert(budgets).values({ organizationId: f.orgId, businessId: null, periodStart: monthStart(new Date()), limitMicros: 100_000 });
    const guard = new SpendGuard(tdb.db, { organizationId: f.orgId, businessId: null, agentId: f.agents.ops, runId: null, provider: id, maxRunMicros: 100_000 });
    const session = provider.openSession({
      model,
      system: "You are a connectivity test. Follow the output format exactly.",
      output: { name: "reply", schema: { type: "object", additionalProperties: false, required: ["word"], properties: { word: { type: "string" } } } },
      maxOutputTokens: 1024,
      effort: "low",
    });
    const turn = await guardedSend(session, { text: 'Return the word "OK".' }, {
      hooks: {
        reserve: (m) => guard.reserve(m),
        settle: (rid, a) => guard.settle(rid, a),
        release: (rid) => guard.release(rid),
        event: async () => undefined,
        toolActivity: async () => undefined,
      },
      signal: AbortSignal.timeout(90_000),
      deadline: Date.now() + 90_000,
      step: 1,
      onTimeout: () => new Error("timed out"),
    });
    console.log(`[live ${id}] model=${turn.model} stop=${turn.stop} in=${turn.usage.inputTokens}+${turn.usage.cachedInputTokens} cached out=${turn.usage.outputTokens} cost=$${(turn.costMicros / 1e6).toFixed(6)} reply=${JSON.stringify(turn.structured ?? turn.text).slice(0, 80)}`);

    assert.equal(turn.stop, "end");
    assert.equal(String((turn.structured as { word?: string } | undefined)?.word).toUpperCase(), "OK");
    assert.ok(turn.usage.inputTokens + turn.usage.cachedInputTokens > 0, "input tokens reported");
    assert.ok(turn.usage.outputTokens > 0, "output tokens reported");
    assert.ok(turn.costMicros > 0 && turn.costMicros < 10_000, "estimated cost is positive and under one cent");

    // 3. The usage record matches the response and the budget.
    const rows = await tdb.db.select().from(modelUsage).where(eq(modelUsage.organizationId, f.orgId));
    assert.equal(rows.length, 1, "exactly one usage row per API call");
    const row = rows[0]!;
    assert.equal(row.provider, id);
    assert.equal(row.model, turn.model);
    assert.equal(row.inputTokens, turn.usage.inputTokens + turn.usage.cachedInputTokens + turn.usage.cacheWriteTokens);
    assert.equal(row.outputTokens, turn.usage.outputTokens);
    assert.equal(row.costMicros, turn.costMicros);
    const [budget] = await tdb.db.select().from(budgets).where(eq(budgets.organizationId, f.orgId));
    assert.equal(budget!.spentMicros, row.costMicros, "the reservation settled to the recorded cost");
  });
}

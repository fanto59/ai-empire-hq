import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { budgets, modelUsage } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { createFixture, type Fixture } from "../testing/fixtures";
import { BudgetExceededError, SpendGuard, monthStart } from "./spend-guard";

let tdb: TestDatabase;
let f: Fixture;
let n = 0;
const now = () => new Date("2026-11-19T10:00:00.000Z");

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  f = await createFixture(tdb.db, `spend-org-${++n}`);
});

async function setBudget(businessId: string | null, limitMicros: number) {
  await tdb.db.insert(budgets).values({ organizationId: f.orgId, businessId, periodStart: monthStart(now()), limitMicros });
}

async function spent(businessId: string | null) {
  const rows = await tdb.db
    .select({ s: budgets.spentMicros })
    .from(budgets)
    .where(and(eq(budgets.organizationId, f.orgId), businessId === null ? isNull(budgets.businessId) : eq(budgets.businessId, businessId)));
  return rows[0]!.s;
}

function guard(maxRunMicros = 10_000_000) {
  return new SpendGuard(
    tdb.db,
    { organizationId: f.orgId, businessId: f.bizA, agentId: f.agents.research, runId: null, provider: "anthropic", maxRunMicros },
    now,
  );
}

test("no budget configured means no spending", async () => {
  await assert.rejects(guard().reserve(1), BudgetExceededError);
});

test("reserve then settle charges the actual cost to business and org budgets and logs usage", async () => {
  await setBudget(null, 1_000_000);
  await setBudget(f.bizA, 500_000);
  const g = guard();
  const r = await g.reserve(200_000);
  assert.equal(await spent(f.bizA), 200_000);
  await g.settle(r, { micros: 12_345, model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 100 });
  assert.equal(await spent(f.bizA), 12_345);
  assert.equal(await spent(null), 12_345);
  assert.equal(g.spentMicros, 12_345);
  const usage = await tdb.db.select().from(modelUsage).where(eq(modelUsage.organizationId, f.orgId));
  assert.equal(usage.length, 1);
  assert.equal(usage[0]!.costMicros, 12_345);
});

test("the tighter of business and organization budgets wins, atomically", async () => {
  await setBudget(null, 1_000_000);
  await setBudget(f.bizA, 100_000);
  await assert.rejects(guard().reserve(150_000), BudgetExceededError);
  assert.equal(await spent(null), 0, "org budget untouched when the business budget refuses (rolled back)");
});

test("release returns the reservation; the per-attempt cap applies", async () => {
  await setBudget(null, 10_000_000);
  await setBudget(f.bizA, 10_000_000);
  const g = guard(300_000);
  const r = await g.reserve(250_000);
  await assert.rejects(g.reserve(100_000), /spending cap/);
  await g.release(r);
  assert.equal(await spent(f.bizA), 0);
});

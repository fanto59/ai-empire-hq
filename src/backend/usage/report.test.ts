import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { budgets, modelUsage } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { monthStart } from "../budgets/spend-guard";
import { createFixture, type Fixture } from "../testing/fixtures";
import { getUsageReport } from "./report";

let tdb: TestDatabase;
let f: Fixture;
let other: Fixture;
const now = new Date("2026-11-19T15:00:00.000Z");

before(async () => {
  tdb = await createTestDatabase();
  f = await createFixture(tdb.db, "usage-org");
  other = await createFixture(tdb.db, "usage-other-org");
  const row = (orgId: string, agentId: string, businessId: string | null, at: string, costMicros: number, model = "claude-opus-5-5") => ({
    organizationId: orgId,
    agentId,
    businessId,
    provider: "test",
    model,
    inputTokens: 1000,
    outputTokens: 100,
    costMicros,
    recordedAt: new Date(at),
  });
  await tdb.db.insert(modelUsage).values([
    row(f.orgId, f.agents.research, f.bizA, "2026-11-19T09:00:00.000Z", 120_000),
    row(f.orgId, f.agents.research, f.bizA, "2026-11-19T10:00:00.000Z", 30_000),
    row(f.orgId, f.agents.chief, null, "2026-11-18T23:59:00.000Z", 50_000, "claude-opus-4-8"),
    row(f.orgId, f.agents.chief, null, "2026-11-02T08:00:00.000Z", 200_000),
    row(f.orgId, f.agents.research, f.bizA, "2026-10-30T08:00:00.000Z", 999_000), // last month
    row(other.orgId, other.agents.research, other.bizA, "2026-11-19T09:00:00.000Z", 777_000), // other org
  ]);
  await tdb.db.insert(budgets).values({ organizationId: f.orgId, businessId: null, periodStart: monthStart(now), limitMicros: 2_000_000, spentMicros: 400_000 });
});
after(async () => {
  await tdb.close();
});

test("totals for today, this month and all time (UTC days, this organization only)", async () => {
  const r = await getUsageReport(tdb.db, f.orgId, now);
  assert.deepEqual(r.today, { costMicros: 150_000, calls: 2, inputTokens: 2000, outputTokens: 200 });
  assert.equal(r.month.costMicros, 400_000);
  assert.equal(r.month.calls, 4);
  assert.equal(r.allTime.costMicros, 1_399_000);
});

test("daily series is zero-filled, oldest first, and matches the totals", async () => {
  const r = await getUsageReport(tdb.db, f.orgId, now, 30);
  assert.equal(r.daily.length, 30);
  assert.equal(r.daily.at(-1)!.date, "2026-11-19");
  assert.equal(r.daily.at(-1)!.costMicros, 150_000);
  assert.equal(r.daily.at(-2)!.costMicros, 50_000);
  assert.equal(r.daily.find((d) => d.date === "2026-11-10")!.costMicros, 0);
  assert.equal(r.daily.find((d) => d.date === "2026-10-30")!.costMicros, 999_000);
});

test("breakdowns by agent, model and business for this month", async () => {
  const r = await getUsageReport(tdb.db, f.orgId, now);
  assert.deepEqual(r.byAgent.map((a) => [a.key, a.costMicros]), [["test-chief", 250_000], ["test-research", 150_000]]);
  assert.deepEqual(r.byModel.map((m) => [m.key, m.costMicros]), [["claude-opus-5-5", 350_000], ["claude-opus-4-8", 50_000]]);
  assert.deepEqual(r.byBusiness.map((b) => [b.label, b.costMicros]), [["Headquarters", 250_000], ["Test Business A", 150_000]]);
});

test("projection, budgets and recent calls", async () => {
  const r = await getUsageReport(tdb.db, f.orgId, now);
  assert.equal(r.dayOfMonth, 19);
  assert.equal(r.daysInMonth, 30);
  assert.equal(r.averagePerDayMicros, Math.round(400_000 / 19));
  assert.equal(r.projectedMonthMicros, r.averagePerDayMicros * 30);
  assert.deepEqual(r.budgets, [{ scope: "Organization", limitMicros: 2_000_000, spentMicros: 400_000 }]);
  assert.equal(r.recent.length, 5);
  assert.equal(r.recent[0]!.at, "2026-11-19T10:00:00.000Z");
});

test("an organization with no usage gets an honest empty report", async () => {
  const empty = await createFixture(tdb.db, "usage-empty-org");
  const r = await getUsageReport(tdb.db, empty.orgId, now);
  assert.equal(r.allTime.costMicros, 0);
  assert.ok(r.daily.every((d) => d.costMicros === 0));
  assert.deepEqual(r.byAgent, []);
});

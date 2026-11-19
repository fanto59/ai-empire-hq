/**
 * Sets this month's API budget for the TEST organization (and optionally one
 * business). Budgets are spending LIMITS for the agents; no money moves.
 *
 *   npm run budget:set -- --usd 2                               (organization-wide)
 *   npm run budget:set -- --usd 1 --business test-business-a     (one business)
 *
 * Both apply: a research call needs room in the organization budget AND in
 * its business's budget.
 */
import { parseArgs } from "node:util";
import { and, eq, isNull } from "drizzle-orm";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { openDatabase } from "@/infrastructure/db/client";
import { budgets, businesses, organizations } from "@/infrastructure/db/schema";
import { monthStart } from "@/backend/budgets/spend-guard";

const { values } = parseArgs({ options: { usd: { type: "string" }, business: { type: "string" } } });
const usd = Number(values.usd);
if (!Number.isFinite(usd) || usd < 0 || usd > 100) throw new Error("--usd must be a number from 0 to 100.");
const config = loadRuntimeConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(config.databaseUrl);
try {
  const [org] = await handle.db.select().from(organizations).where(eq(organizations.slug, config.organizationSlug));
  if (!org) throw new Error(`Organization "${config.organizationSlug}" not found. Run npm run db:seed first.`);
  if (!org.isTestData) throw new Error("Refusing: this script only manages test organizations.");
  let businessId: string | null = null;
  if (values.business) {
    const [b] = await handle.db
      .select()
      .from(businesses)
      .where(and(eq(businesses.organizationId, org.id), eq(businesses.slug, values.business)));
    if (!b) throw new Error(`Business "${values.business}" not found.`);
    businessId = b.id;
  }
  const periodStart = monthStart(new Date());
  const limitMicros = Math.round(usd * 1_000_000);
  const scope = and(
    eq(budgets.organizationId, org.id),
    businessId ? eq(budgets.businessId, businessId) : isNull(budgets.businessId),
    eq(budgets.periodStart, periodStart),
  );
  const updated = await handle.db.update(budgets).set({ limitMicros, updatedAt: new Date() }).where(scope).returning();
  if (updated.length === 0) await handle.db.insert(budgets).values({ organizationId: org.id, businessId, periodStart, limitMicros });
  console.log(`Budget for ${values.business ?? "the organization"} (${periodStart}) set to $${usd.toFixed(2)}.`);
} finally {
  await handle.close();
}

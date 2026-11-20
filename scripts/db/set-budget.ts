/**
 * Sets this month's API budget for the TEST organization, one sector, or one
 * business. Budgets are spending LIMITS for the agents; no money moves.
 *
 *   npm run budget:set -- --usd 2                                (organization-wide)
 *   npm run budget:set -- --usd 1 --sector nightlife-entertainment (one sector, optional limit)
 *   npm run budget:set -- --usd 1 --business test-business-a      (one business)
 *
 * All applicable budgets apply: a call needs room in the organization budget,
 * its business's budget, and its sector's budget when the sector has one.
 */
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { openDatabase } from "@/infrastructure/db/client";
import { budgets, businesses, organizations, sectors } from "@/infrastructure/db/schema";
import { budgetScopeFilter, monthStart, type BudgetScope } from "@/backend/budgets/spend-guard";

const { values } = parseArgs({ options: { usd: { type: "string" }, business: { type: "string" }, sector: { type: "string" } } });
const usd = Number(values.usd);
if (!Number.isFinite(usd) || usd < 0 || usd > 100) throw new Error("--usd must be a number from 0 to 100.");
if (values.business && values.sector) throw new Error("Use --business OR --sector, not both.");
const config = loadRuntimeConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(config.databaseUrl);
try {
  const [org] = await handle.db.select().from(organizations).where(eq(organizations.slug, config.organizationSlug));
  if (!org) throw new Error(`Organization "${config.organizationSlug}" not found. Run npm run db:seed first.`);
  if (!org.isTestData) throw new Error("Refusing: this script only manages test organizations.");
  let scope: BudgetScope = "organization";
  if (values.business) {
    const [b] = await handle.db.select().from(businesses).where(and(eq(businesses.organizationId, org.id), eq(businesses.slug, values.business)));
    if (!b) throw new Error(`Business "${values.business}" not found.`);
    scope = { businessId: b.id };
  } else if (values.sector) {
    const [s] = await handle.db.select().from(sectors).where(and(eq(sectors.organizationId, org.id), eq(sectors.slug, values.sector)));
    if (!s) throw new Error(`Sector "${values.sector}" not found.`);
    scope = { sectorId: s.id };
  }
  const periodStart = monthStart(new Date());
  const limitMicros = Math.round(usd * 1_000_000);
  const updated = await handle.db.update(budgets).set({ limitMicros, updatedAt: new Date() }).where(budgetScopeFilter(org.id, scope, periodStart)).returning();
  if (updated.length === 0) {
    await handle.db.insert(budgets).values({
      organizationId: org.id,
      businessId: scope !== "organization" && "businessId" in scope ? scope.businessId : null,
      sectorId: scope !== "organization" && "sectorId" in scope ? scope.sectorId : null,
      periodStart,
      limitMicros,
    });
  }
  console.log(`Budget for ${values.business ?? values.sector ?? "the organization"} (${periodStart}) set to $${usd.toFixed(2)}.`);
} finally {
  await handle.close();
}

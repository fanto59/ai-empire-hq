import { and, eq } from "drizzle-orm";
import { anthropicStatus } from "@/agents/providers/anthropic";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import type { Db } from "@/infrastructure/db/client";
import { budgets, businesses } from "@/infrastructure/db/schema";
import { monthStart } from "../budgets/spend-guard";
import { findResearchAgent } from "./research";

/** What the dashboard shows about research readiness (no secrets). */
export async function getResearchStatus(db: Db, organizationId: string) {
  const config = loadRuntimeConfig();
  const provider = anthropicStatus();
  const bizRows = await db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.organizationId, organizationId));
  const withAgents = await Promise.all(
    bizRows.map(async (b) => ({ ...b, agentName: (await findResearchAgent(db, organizationId, b.id))?.displayName ?? null })),
  );
  const budgetRows = await db
    .select({ businessId: budgets.businessId, limitMicros: budgets.limitMicros, spentMicros: budgets.spentMicros })
    .from(budgets)
    .where(and(eq(budgets.organizationId, organizationId), eq(budgets.periodStart, monthStart(new Date()))));
  return {
    providerReady: provider.ready,
    providerReason: provider.reason,
    workerMode: config.workerMode,
    model: config.research.model,
    allowedDomains: config.research.allowedDomains,
    maxRunMicros: config.research.maxRunMicros,
    businesses: withAgents,
    budgets: budgetRows.map((b) => ({
      scope: b.businessId === null ? "Organization" : (bizRows.find((x) => x.id === b.businessId)?.name ?? "Business"),
      limitMicros: b.limitMicros,
      spentMicros: b.spentMicros,
    })),
  };
}

import { and, eq } from "drizzle-orm";
import { PROVIDER_LABELS } from "@/agents/providers/catalog";
import { getProvider } from "@/agents/providers/registry";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import type { Db } from "@/infrastructure/db/client";
import { budgets, businesses } from "@/infrastructure/db/schema";
import { monthStart } from "../budgets/spend-guard";
import { agentPermissionSet, resolveAgentModel } from "../models/assignment";
import { findResearchAgent } from "./research";

/** What the dashboard shows about research readiness (no secrets). */
export async function getResearchStatus(db: Db, organizationId: string) {
  const config = loadRuntimeConfig();
  const bizRows = await db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.organizationId, organizationId));
  const withAgents = await Promise.all(bizRows.map(async (b) => ({ ...b, agent: (await findResearchAgent(db, organizationId, b.id)) ?? null })));
  const first = withAgents.find((b) => b.agent)?.agent ?? null;
  const assigned = first ? resolveAgentModel(first, await agentPermissionSet(db, first.id)) : null;
  const status = assigned ? getProvider(assigned.provider).status() : { ready: false, reason: "No research agent is configured." };
  const budgetRows = await db
    .select({ businessId: budgets.businessId, sectorId: budgets.sectorId, limitMicros: budgets.limitMicros, spentMicros: budgets.spentMicros })
    .from(budgets)
    .where(and(eq(budgets.organizationId, organizationId), eq(budgets.periodStart, monthStart(new Date()))));
  return {
    providerReady: status.ready,
    providerReason: status.reason,
    providerLabel: assigned ? PROVIDER_LABELS[assigned.provider] : "No provider",
    workerMode: config.workerMode,
    model: assigned?.model ?? "none",
    allowedDomains: config.research.allowedDomains,
    maxRunMicros: config.research.maxRunMicros,
    businesses: withAgents.map(({ agent, ...b }) => ({ ...b, agentName: agent?.displayName ?? null })),
    budgets: budgetRows.map((b) => ({
      scope: b.businessId ? (bizRows.find((x) => x.id === b.businessId)?.name ?? "Business") : b.sectorId ? "Sector" : "Organization",
      limitMicros: b.limitMicros,
      spentMicros: b.spentMicros,
    })),
  };
}

import type { AgentProfile, Business } from "@/domain";
import type { KnowledgeNoteSummary } from "@/domain/knowledge";
import { getKnowledgeService, getKnowledgeSync, ownerContext } from "@/backend/knowledge";
import type { TaskSummaryView } from "@/domain/task-view";
import { ownerRequestContext } from "../auth/context";
import { getDashboardOrganization, getDatabase } from "../db";
import { loadTaskSummaries } from "../tasks/views";
import { getUsageReport } from "../usage/report";
import { loadRuntimeConfig, type ProviderId } from "@/infrastructure/config/env";
import { emptyRepositories } from "./repositories";

/**
 * View model for the HQ dashboard. Contains only data that is safe to send to
 * the browser: no secrets, no location refs, no raw config.
 */
export interface HqOverview {
  appEnv: string;
  agentExecutionEnabled: boolean;
  providers: { id: ProviderId; enabled: boolean }[];
  businesses: Business[];
  hqAgents: AgentProfile[];
  /** API spending (null when the database is not set up). */
  spending: { todayMicros: number; monthMicros: number; projectedMonthMicros: number; callsToday: number; budget: { limitMicros: number; spentMicros: number } | null } | null;
  /** null when the operational database is not set up. */
  tasks: { items: TaskSummaryView[]; isTestData: boolean } | null;
  knowledge: { recent: KnowledgeNoteSummary[]; latestReport: KnowledgeNoteSummary | null; total: number; syncState: string };
}

export async function getHqOverview(): Promise<HqOverview> {
  const config = loadRuntimeConfig();
  const repos = emptyRepositories;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  const taskItems = db && org ? await loadTaskSummaries(db, ownerRequestContext(org.id)) : null;
  const usage = db && org ? await getUsageReport(db, org.id) : null;
  const [businesses, hqAgents, notes, sync] = await Promise.all([
    repos.businesses.list(),
    repos.agents.listHqLevel(),
    getKnowledgeService().listNotes(ownerContext()),
    getKnowledgeSync().status(),
  ]);

  return {
    appEnv: config.appEnv,
    agentExecutionEnabled: config.agentExecutionEnabled,
    providers: (Object.keys(config.providers) as ProviderId[]).map((id) => ({
      id,
      enabled: config.agentExecutionEnabled && config.providers[id].enabled && config.providerKeys[id],
    })),
    businesses,
    hqAgents,
    spending: usage
      ? {
          todayMicros: usage.today.costMicros,
          monthMicros: usage.month.costMicros,
          projectedMonthMicros: usage.projectedMonthMicros,
          callsToday: usage.today.calls,
          budget: usage.budgets.find((b) => b.scope === "Organization") ?? null,
        }
      : null,
    tasks: taskItems && org ? { items: taskItems, isTestData: org.isTestData } : null,
    knowledge: {
      recent: notes.notes.filter((n) => n.meta.kind !== "report").slice(0, 4),
      latestReport: notes.notes.find((n) => n.meta.kind === "report") ?? null,
      total: notes.notes.length,
      syncState: sync.state,
    },
  };
}

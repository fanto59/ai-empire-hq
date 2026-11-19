import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { anthropicStatus } from "@/agents/providers/anthropic";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import type { Db } from "@/infrastructure/db/client";
import { budgets, executionEvents, executionRuns, knowledgeDocuments, modelUsage, tasks } from "@/infrastructure/db/schema";
import { monthStart } from "../budgets/spend-guard";
import { findChiefAgent } from "./executive";

/**
 * Read model for the Chief AI Manager panel: recent objectives with their
 * live events, cost, plan (from run.completed) and errors. Owner view.
 */
export async function loadChiefPanel(db: Db, organizationId: string, signedIn: boolean) {
  const config = loadRuntimeConfig();
  const provider = anthropicStatus();
  const [chief, recent, orgBudget] = await Promise.all([
    findChiefAgent(db, organizationId),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.kind, "executive")))
      .orderBy(desc(tasks.createdAt))
      .limit(5),
    db
      .select({ limitMicros: budgets.limitMicros, spentMicros: budgets.spentMicros })
      .from(budgets)
      .where(and(eq(budgets.organizationId, organizationId), isNull(budgets.businessId), eq(budgets.periodStart, monthStart(new Date())))),
  ]);

  const ids = recent.map((t) => t.id);
  const [events, costs, docs] = ids.length
    ? await Promise.all([
        db.select().from(executionEvents).where(inArray(executionEvents.taskId, ids)).orderBy(asc(executionEvents.occurredAt), asc(executionEvents.sequence)),
        db
          .select({ taskId: executionRuns.taskId, total: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint` })
          .from(modelUsage)
          .innerJoin(executionRuns, eq(executionRuns.id, modelUsage.runId))
          .where(inArray(executionRuns.taskId, ids))
          .groupBy(executionRuns.taskId),
        db.select({ taskId: knowledgeDocuments.taskId, path: knowledgeDocuments.vaultPath }).from(knowledgeDocuments).where(inArray(knowledgeDocuments.taskId, ids)),
      ])
    : [[], [], []];

  const objectives = recent.map((t) => {
    const mine = events.filter((e) => e.taskId === t.id);
    const done = [...mine].reverse().find((e) => e.type === "run.completed");
    const payload = (done?.payload ?? {}) as { plan?: unknown; requestedWork?: string[] };
    return {
      taskId: t.id,
      goal: t.description,
      state: t.state,
      costMicros: Number(costs.find((c) => c.taskId === t.id)?.total ?? 0),
      lastError: t.lastError,
      updatedAt: t.updatedAt.toISOString(),
      events: mine.slice(-40).map((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        return {
          id: e.id,
          type: e.type,
          text: String(p.summary ?? p.outputSummary ?? p.inputSummary ?? p.message ?? (p.model ? `model ${String(p.model)}` : "")).slice(0, 300),
          tool: typeof p.tool === "string" ? p.tool : null,
          at: e.occurredAt.toISOString().slice(11, 19),
        };
      }),
      plan: (payload.plan ?? null) as never,
      briefingPath: docs.find((d) => d.taskId === t.id)?.path ?? null,
      requestedWork: Array.isArray(payload.requestedWork) ? payload.requestedWork.map(String) : [],
    };
  });

  return {
    agentReady: chief !== null,
    providerReady: provider.ready,
    providerReason: provider.reason,
    workerInProcess: config.workerMode === "in-process",
    signedIn,
    orgBudget: orgBudget[0] ?? null,
    objectives,
  };
}

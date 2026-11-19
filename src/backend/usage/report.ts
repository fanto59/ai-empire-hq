import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agents, budgets, businesses, executionRuns, modelUsage } from "@/infrastructure/db/schema";
import { monthStart } from "../budgets/spend-guard";

/**
 * API USAGE & SPENDING REPORT - built only from recorded model_usage rows
 * (one row per real Claude API call, written by the SpendGuard). Nothing is
 * estimated except the clearly labelled month-end projection.
 *
 * All amounts are integer micro-dollars; days are UTC.
 */
export interface UsageTotals {
  costMicros: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageBreakdownRow extends UsageTotals {
  key: string;
  label: string;
}

export interface UsageReport {
  generatedAt: string;
  today: UsageTotals;
  month: UsageTotals;
  allTime: UsageTotals;
  /** Average per day so far this month, and month-end at that pace. */
  averagePerDayMicros: number;
  projectedMonthMicros: number;
  daysInMonth: number;
  dayOfMonth: number;
  /** One entry per UTC day, oldest first, zero-filled. */
  daily: { date: string; costMicros: number; calls: number }[];
  byAgent: UsageBreakdownRow[];
  byModel: UsageBreakdownRow[];
  byBusiness: UsageBreakdownRow[];
  budgets: { scope: string; limitMicros: number; spentMicros: number }[];
  recent: { at: string; agent: string; model: string; inputTokens: number; outputTokens: number; costMicros: number; taskId: string | null }[];
}

const totals = () => ({
  costMicros: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint`,
  calls: sql<number>`count(*)::int`,
  inputTokens: sql<number>`coalesce(sum(${modelUsage.inputTokens}), 0)::bigint`,
  outputTokens: sql<number>`coalesce(sum(${modelUsage.outputTokens}), 0)::bigint`,
});

const num = (t: { costMicros: unknown; calls: unknown; inputTokens: unknown; outputTokens: unknown } | undefined): UsageTotals => ({
  costMicros: Number(t?.costMicros ?? 0),
  calls: Number(t?.calls ?? 0),
  inputTokens: Number(t?.inputTokens ?? 0),
  outputTokens: Number(t?.outputTokens ?? 0),
});

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getUsageReport(db: Db, organizationId: string, now: Date = new Date(), days = 30): Promise<UsageReport> {
  const todayStart = new Date(`${utcDay(now)}T00:00:00.000Z`);
  const monthStartDate = new Date(`${monthStart(now)}T00:00:00.000Z`);
  const windowStart = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
  const org = eq(modelUsage.organizationId, organizationId);
  const thisMonth = and(org, gte(modelUsage.recordedAt, monthStartDate));

  const [today, month, allTime, dailyRows, byAgent, byModel, byBusiness, budgetRows, recent] = await Promise.all([
    db.select(totals()).from(modelUsage).where(and(org, gte(modelUsage.recordedAt, todayStart))),
    db.select(totals()).from(modelUsage).where(thisMonth),
    db.select(totals()).from(modelUsage).where(org),
    db
      .select({
        day: sql<string>`to_char(${modelUsage.recordedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        costMicros: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint`,
        calls: sql<number>`count(*)::int`,
      })
      .from(modelUsage)
      .where(and(org, gte(modelUsage.recordedAt, windowStart)))
      .groupBy(sql`1`),
    db
      .select({ key: sql<string>`coalesce(${agents.slug}, 'unknown')`, label: sql<string>`coalesce(${agents.displayName}, 'Unknown agent')`, ...totals() })
      .from(modelUsage)
      .leftJoin(agents, eq(agents.id, modelUsage.agentId))
      .where(thisMonth)
      .groupBy(agents.slug, agents.displayName),
    db.select({ key: modelUsage.model, label: modelUsage.model, ...totals() }).from(modelUsage).where(thisMonth).groupBy(modelUsage.model),
    db
      .select({ key: sql<string>`coalesce(${businesses.slug}, 'hq')`, label: sql<string>`coalesce(${businesses.name}, 'Headquarters')`, ...totals() })
      .from(modelUsage)
      .leftJoin(businesses, eq(businesses.id, modelUsage.businessId))
      .where(thisMonth)
      .groupBy(businesses.slug, businesses.name),
    db
      .select({ name: businesses.name, businessId: budgets.businessId, limitMicros: budgets.limitMicros, spentMicros: budgets.spentMicros })
      .from(budgets)
      .leftJoin(businesses, eq(businesses.id, budgets.businessId))
      .where(and(eq(budgets.organizationId, organizationId), eq(budgets.periodStart, monthStart(now)))),
    db
      .select({
        at: modelUsage.recordedAt,
        agent: sql<string>`coalesce(${agents.displayName}, 'Unknown agent')`,
        model: modelUsage.model,
        inputTokens: modelUsage.inputTokens,
        outputTokens: modelUsage.outputTokens,
        costMicros: modelUsage.costMicros,
        taskId: executionRuns.taskId,
      })
      .from(modelUsage)
      .leftJoin(agents, eq(agents.id, modelUsage.agentId))
      .leftJoin(executionRuns, eq(executionRuns.id, modelUsage.runId))
      .where(org)
      .orderBy(desc(modelUsage.recordedAt))
      .limit(15),
  ]);

  const byDay = new Map(dailyRows.map((r) => [r.day, r]));
  const daily = Array.from({ length: days }, (_, i) => {
    const date = utcDay(new Date(windowStart.getTime() + i * 86_400_000));
    const r = byDay.get(date);
    return { date, costMicros: Number(r?.costMicros ?? 0), calls: Number(r?.calls ?? 0) };
  });

  const monthTotals = num(month[0]);
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const averagePerDayMicros = Math.round(monthTotals.costMicros / dayOfMonth);
  const breakdown = (rows: { key: string; label: string; costMicros: unknown; calls: unknown; inputTokens: unknown; outputTokens: unknown }[]) =>
    rows.map((r) => ({ key: r.key, label: r.label, ...num(r) })).sort((a, b) => b.costMicros - a.costMicros);

  return {
    generatedAt: now.toISOString(),
    today: num(today[0]),
    month: monthTotals,
    allTime: num(allTime[0]),
    averagePerDayMicros,
    projectedMonthMicros: averagePerDayMicros * daysInMonth,
    daysInMonth,
    dayOfMonth,
    daily,
    byAgent: breakdown(byAgent),
    byModel: breakdown(byModel),
    byBusiness: breakdown(byBusiness),
    budgets: budgetRows
      .map((b) => ({ scope: b.businessId === null ? "Organization" : (b.name ?? "Business"), limitMicros: b.limitMicros, spentMicros: b.spentMicros }))
      .sort((a, b) => (a.scope === "Organization" ? -1 : b.scope === "Organization" ? 1 : a.scope.localeCompare(b.scope))),
    recent: recent.map((r) => ({ ...r, at: r.at.toISOString() })),
  };
}

/** Org-wide monthly budget (null if none), for compact displays. */
export async function getOrgBudget(db: Db, organizationId: string, now = new Date()) {
  const [b] = await db
    .select({ limitMicros: budgets.limitMicros, spentMicros: budgets.spentMicros })
    .from(budgets)
    .where(and(eq(budgets.organizationId, organizationId), isNull(budgets.businessId), eq(budgets.periodStart, monthStart(now))));
  return b ?? null;
}

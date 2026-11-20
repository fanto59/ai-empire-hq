import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db, Executor } from "@/infrastructure/db/client";
import { budgets, modelUsage } from "@/infrastructure/db/schema";

/**
 * SPEND GUARD - enforces API spending limits with atomic reservations.
 *
 * Before a model call, the worst-case cost is RESERVED on every applicable
 * budget (the business's monthly budget AND the organization-wide one) with a
 * single conditional UPDATE: `spent + amount <= limit`. If any budget lacks
 * room (or does not exist: no budget = no spending), nothing is reserved and
 * the call is not made. After the call, the reservation is settled to the
 * actual cost and a model_usage row is written. A crash between reserve and
 * settle leaves the worst case counted as spent (fail-safe).
 *
 * Sector, per-agent and per-provider budgets are optional: when one exists
 * for the month (for the business's sector, the calling agent, or the
 * provider), it must have room too; without one, it adds no limit.
 *
 * A per-attempt cap (maxRunMicros) bounds a single task attempt as well.
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface SpendScope {
  organizationId: string;
  businessId: string | null;
  /** The business's sector (its optional sector budget also applies). */
  sectorId?: string | null;
  agentId: string | null;
  runId: string | null;
  provider: string;
  /** Hard cap for this attempt in micro-dollars. */
  maxRunMicros: number;
}

export function monthStart(now: Date): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

/** Budget scope: the organization, one sector, one business, one agent, or one provider. */
export type BudgetScope = "organization" | { sectorId: string } | { businessId: string } | { agentId: string } | { provider: string };

/** Row filter for exactly one budget scope (scopes never match each other's rows). */
export function budgetScopeFilter(organizationId: string, scope: BudgetScope, period: string) {
  const v = <K extends string>(k: K) => (scope !== "organization" && k in scope ? (scope as Record<K, string>)[k] : null);
  const business = v("businessId");
  const sector = v("sectorId");
  const agent = v("agentId");
  const provider = v("provider");
  return and(
    eq(budgets.organizationId, organizationId),
    business ? eq(budgets.businessId, business) : isNull(budgets.businessId),
    sector ? eq(budgets.sectorId, sector) : isNull(budgets.sectorId),
    agent ? eq(budgets.agentId, agent) : isNull(budgets.agentId),
    provider ? eq(budgets.provider, provider) : isNull(budgets.provider),
    eq(budgets.periodStart, period),
  );
}

export function describeBudgetScope(scope: BudgetScope): string {
  if (scope === "organization") return "The organization";
  if ("sectorId" in scope) return "This sector";
  if ("businessId" in scope) return "This business";
  if ("agentId" in scope) return "This agent";
  return `The ${scope.provider} provider`;
}
const describe = describeBudgetScope;

export class SpendGuard {
  private readonly db: Db;
  private readonly scope: SpendScope;
  private readonly now: () => Date;
  private readonly open = new Map<string, number>();
  private runMicros = 0;

  constructor(db: Db, scope: SpendScope, now: () => Date = () => new Date()) {
    this.db = db;
    this.scope = scope;
    this.now = now;
  }

  /** Micro-dollars actually spent (settled) by this attempt so far. */
  get spentMicros(): number {
    return this.runMicros;
  }

  async reserve(amount: number): Promise<string> {
    const amt = Math.max(0, Math.ceil(amount));
    const committed = this.runMicros + [...this.open.values()].reduce((a, b) => a + b, 0);
    if (committed + amt > this.scope.maxRunMicros) {
      throw new BudgetExceededError(
        `This attempt's spending cap ($${(this.scope.maxRunMicros / 1e6).toFixed(2)}) would be exceeded by the next model call.`,
      );
    }
    const period = monthStart(this.now());
    await this.db.transaction(async (tx) => {
      for (const scope of await this.budgetScopes(tx, period)) {
        const rows = await tx
          .update(budgets)
          .set({ spentMicros: sql`${budgets.spentMicros} + ${amt}`, updatedAt: this.now() })
          .where(and(budgetScopeFilter(this.scope.organizationId, scope, period), lte(sql`${budgets.spentMicros} + ${amt}`, budgets.limitMicros)))
          .returning({ id: budgets.id });
        if (rows.length === 0) {
          throw new BudgetExceededError(
            `${describe(scope)} has no monthly API budget with room for the next model call (needs up to $${(amt / 1e6).toFixed(4)}). Set one with npm run budget:set.`,
          );
        }
      }
    });
    const id = randomUUID();
    this.open.set(id, amt);
    return id;
  }

  async settle(id: string, actual: { micros: number; model: string; inputTokens: number; outputTokens: number }): Promise<void> {
    const reserved = this.open.get(id);
    if (reserved === undefined) throw new Error("Unknown reservation.");
    const cost = Math.max(0, Math.ceil(actual.micros));
    const period = monthStart(this.now());
    await this.db.transaction(async (tx) => {
      for (const scope of await this.budgetScopes(tx, period)) {
        // May exceed the limit if the response cost more than the estimate;
        // the next reserve() will then refuse.
        await tx
          .update(budgets)
          .set({ spentMicros: sql`greatest(0, ${budgets.spentMicros} + ${cost - reserved})`, updatedAt: this.now() })
          .where(budgetScopeFilter(this.scope.organizationId, scope, period));
      }
      await tx.insert(modelUsage).values({
        organizationId: this.scope.organizationId,
        businessId: this.scope.businessId,
        runId: this.scope.runId,
        agentId: this.scope.agentId,
        provider: this.scope.provider,
        model: actual.model.slice(0, 100),
        inputTokens: actual.inputTokens,
        outputTokens: actual.outputTokens,
        costMicros: cost,
        recordedAt: this.now(),
      });
    });
    this.open.delete(id);
    this.runMicros += cost;
  }

  /** Returns a reservation when the call failed before producing usage. */
  async release(id: string): Promise<void> {
    const reserved = this.open.get(id);
    if (reserved === undefined) return;
    const period = monthStart(this.now());
    await this.db.transaction(async (tx) => {
      for (const scope of await this.budgetScopes(tx, period)) {
        await tx
          .update(budgets)
          .set({ spentMicros: sql`greatest(0, ${budgets.spentMicros} - ${reserved})` })
          .where(budgetScopeFilter(this.scope.organizationId, scope, period));
      }
    });
    this.open.delete(id);
  }

  /**
   * Budgets that apply: the organization always; the business for business
   * work; the sector, agent and provider budgets only when one exists this month.
   */
  private async budgetScopes(tx: Executor, period: string): Promise<BudgetScope[]> {
    const scopes: BudgetScope[] = ["organization"];
    const optional: BudgetScope[] = [];
    if (this.scope.sectorId) optional.push({ sectorId: this.scope.sectorId });
    if (this.scope.agentId) optional.push({ agentId: this.scope.agentId });
    if (this.scope.provider) optional.push({ provider: this.scope.provider });
    for (const scope of optional) {
      const [row] = await tx.select({ id: budgets.id }).from(budgets).where(budgetScopeFilter(this.scope.organizationId, scope, period));
      if (row) scopes.push(scope);
    }
    if (this.scope.businessId) scopes.push({ businessId: this.scope.businessId });
    return scopes;
  }
}

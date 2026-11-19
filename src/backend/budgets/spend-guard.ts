import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
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
  agentId: string | null;
  runId: string | null;
  provider: string;
  /** Hard cap for this attempt in micro-dollars. */
  maxRunMicros: number;
}

export function monthStart(now: Date): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}

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
      for (const businessId of this.budgetScopes()) {
        const rows = await tx
          .update(budgets)
          .set({ spentMicros: sql`${budgets.spentMicros} + ${amt}`, updatedAt: this.now() })
          .where(
            and(
              this.scopeFilter(businessId, period),
              lte(sql`${budgets.spentMicros} + ${amt}`, budgets.limitMicros),
            ),
          )
          .returning({ id: budgets.id });
        if (rows.length === 0) {
          throw new BudgetExceededError(
            `${businessId === null ? "The organization" : "This business"} has no monthly API budget with room for the next model call (needs up to $${(amt / 1e6).toFixed(4)}). Set one with npm run budget:set.`,
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
      for (const businessId of this.budgetScopes()) {
        // May exceed the limit if the response cost more than the estimate;
        // the next reserve() will then refuse.
        await tx
          .update(budgets)
          .set({ spentMicros: sql`greatest(0, ${budgets.spentMicros} + ${cost - reserved})`, updatedAt: this.now() })
          .where(this.scopeFilter(businessId, period));
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
      for (const businessId of this.budgetScopes()) {
        await tx
          .update(budgets)
          .set({ spentMicros: sql`greatest(0, ${budgets.spentMicros} - ${reserved})` })
          .where(this.scopeFilter(businessId, period));
      }
    });
    this.open.delete(id);
  }

  private scopeFilter(businessId: string | null, period: string) {
    return and(
      eq(budgets.organizationId, this.scope.organizationId),
      businessId === null ? isNull(budgets.businessId) : eq(budgets.businessId, businessId),
      eq(budgets.periodStart, period),
    );
  }

  private budgetScopes(): (string | null)[] {
    // The organization-wide budget always applies; the business budget too.
    return this.scope.businessId ? [null, this.scope.businessId] : [null];
  }
}

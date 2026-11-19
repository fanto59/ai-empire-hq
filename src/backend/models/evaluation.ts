import { and, eq, gte } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { executionRuns, modelUsage, tasks } from "@/infrastructure/db/schema";

/**
 * MODEL EVALUATION ON REAL TASKS - how each provider/model has actually done
 * on this organization's work, so assignments can be judged on evidence.
 *
 * Built only from execution_runs (real attempts) and model_usage (real API
 * calls). A run is attributed to the model that served most of its calls.
 * Nothing is simulated; with no runs the table is empty.
 */
export interface ModelEvaluationRow {
  provider: string;
  model: string;
  taskKind: string;
  runs: number;
  succeeded: number;
  failed: number;
  /** Runs still in progress or canceled. */
  other: number;
  totalCostMicros: number;
  /** Average cost of a SUCCESSFUL run (cost per completed task attempt). */
  avgCostPerSuccessMicros: number | null;
  avgDurationSeconds: number | null;
  avgCallsPerRun: number;
}

export async function getModelEvaluation(db: Db, organizationId: string, opts: { now?: Date; days?: number } = {}): Promise<ModelEvaluationRow[]> {
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.days ?? 90) * 86_400_000);
  const rows = await db
    .select({
      runId: modelUsage.runId,
      provider: modelUsage.provider,
      model: modelUsage.model,
      cost: modelUsage.costMicros,
      status: executionRuns.status,
      startedAt: executionRuns.startedAt,
      finishedAt: executionRuns.finishedAt,
      kind: tasks.kind,
    })
    .from(modelUsage)
    .innerJoin(executionRuns, eq(executionRuns.id, modelUsage.runId))
    .innerJoin(tasks, eq(tasks.id, executionRuns.taskId))
    .where(and(eq(modelUsage.organizationId, organizationId), eq(tasks.organizationId, organizationId), gte(modelUsage.recordedAt, since)));

  // Per run: calls per model, total cost, outcome.
  const runs = new Map<string, { byModel: Map<string, { provider: string; model: string; calls: number }>; cost: number; calls: number; status: string; kind: string; duration: number | null }>();
  for (const r of rows) {
    if (!r.runId) continue;
    let run = runs.get(r.runId);
    if (!run) {
      const duration = r.startedAt && r.finishedAt ? (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000 : null;
      run = { byModel: new Map(), cost: 0, calls: 0, status: r.status, kind: r.kind, duration };
      runs.set(r.runId, run);
    }
    const key = `${r.provider}\u0000${r.model}`;
    const m = run.byModel.get(key) ?? { provider: r.provider, model: r.model, calls: 0 };
    m.calls++;
    run.byModel.set(key, m);
    run.cost += r.cost;
    run.calls++;
  }

  const groups = new Map<string, ModelEvaluationRow & { successCost: number; durations: number[]; calls: number }>();
  for (const run of runs.values()) {
    const primary = [...run.byModel.values()].sort((a, b) => b.calls - a.calls)[0]!;
    const key = `${primary.provider}\u0000${primary.model}\u0000${run.kind}`;
    const g =
      groups.get(key) ??
      { provider: primary.provider, model: primary.model, taskKind: run.kind, runs: 0, succeeded: 0, failed: 0, other: 0, totalCostMicros: 0, avgCostPerSuccessMicros: null, avgDurationSeconds: null, avgCallsPerRun: 0, successCost: 0, durations: [], calls: 0 };
    g.runs++;
    g.calls += run.calls;
    g.totalCostMicros += run.cost;
    if (run.status === "succeeded") {
      g.succeeded++;
      g.successCost += run.cost;
      if (run.duration !== null) g.durations.push(run.duration);
    } else if (run.status === "failed" || run.status === "timed_out") g.failed++;
    else g.other++;
    groups.set(key, g);
  }

  return [...groups.values()]
    .map(({ successCost, durations, calls, ...g }) => ({
      ...g,
      avgCostPerSuccessMicros: g.succeeded > 0 ? Math.round(successCost / g.succeeded) : null,
      avgDurationSeconds: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      avgCallsPerRun: Math.round((calls / g.runs) * 10) / 10,
    }))
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));
}

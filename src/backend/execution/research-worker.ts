import { eq } from "drizzle-orm";
import { ChiefError } from "@/agents/chief/agent";
import { findModel, PROVIDER_LABELS } from "@/agents/providers/catalog";
import { ProviderError } from "@/agents/providers/errors";
import type { ProviderLookup } from "@/agents/providers/registry";
import { runResearch, ResearchError } from "@/agents/research/agent";
import { formatUsd } from "@/domain/money";
import { renderReportMarkdown } from "@/agents/research/report";
import type { ResearchConfig } from "@/infrastructure/config/env";
import type { Db } from "@/infrastructure/db/client";
import { agents, businesses, knowledgeDocuments, projects } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import { BudgetExceededError, SpendGuard } from "../budgets/spend-guard";
import { businessAgentContext, KnowledgeError, KnowledgeService } from "../knowledge";
import { slugify } from "../knowledge/paths";
import { ServiceError } from "../errors";
import { agentPermissionSet, resolveAgentModel } from "../models/assignment";
import { ExecutionQueue, type ClaimedRun } from "./queue";

/**
 * RESEARCH WORKER - executes `research` tasks end to end:
 *
 *   claim run → authorize agent → resolve the agent's ONE assigned model →
 *   run.started event → tool loop on that provider
 *   (budget-reserved calls, deadline + heartbeat) → verified report →
 *   knowledge vault note (+ knowledge_documents index) → complete
 *   or: error → run.failed event → fail (retry if transient)
 *
 * Every event is stored in execution_events (origin "live"); every tool use is
 * written to the audit log. The worker has no shell, no filesystem access
 * beyond the knowledge service, no database privileges beyond these services,
 * and no messaging capability.
 */
export interface ResearchWorkerDeps {
  db: Db;
  knowledge: KnowledgeService;
  /** Provider adapters; the agent's assigned provider is the ONLY one used per task. */
  providers: ProviderLookup;
  config: ResearchConfig;
  workerId: string;
  now?: () => Date;
  leaseMs?: number;
  backoffBaseMs?: number;
}

const KINDS = ["research"] as const;

export class ResearchWorker {
  private readonly deps: ResearchWorkerDeps;
  readonly queue: ExecutionQueue;
  private readonly now: () => Date;
  private readonly leaseMs: number;

  constructor(deps: ResearchWorkerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.leaseMs = deps.leaseMs ?? 60_000;
    this.queue = new ExecutionQueue(deps.db, { now: this.now, leaseMs: this.leaseMs, backoffBaseMs: deps.backoffBaseMs });
  }

  /** One scheduling pass. Returns "idle" when there was nothing to run. */
  async tick(): Promise<"idle" | "processed"> {
    await this.queue.reapExpired();
    await this.queue.enqueueReady({ kinds: KINDS });
    const claimed = await this.queue.claim(this.deps.workerId, { kinds: KINDS });
    if (!claimed) return "idle";
    await this.execute(claimed);
    return "processed";
  }

  private async execute({ run, task }: ClaimedRun): Promise<void> {
    const { db, workerId, config } = this.deps;
    const event = (type: string, payload: Record<string, unknown>) => this.queue.recordEvent(run.id, workerId, type, payload, "live");
    const controller = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let spend: SpendGuard | null = null;

    try {
      // ---- authorize ---------------------------------------------------------
      const [agent] = task.assigneeAgentId ? await db.select().from(agents).where(eq(agents.id, task.assigneeAgentId)) : [];
      if (!agent || agent.status !== "active" || agent.businessId !== task.businessId || !task.businessId) {
        throw new ServiceError("forbidden", "The assigned agent is not an active agent of this business.");
      }
      const perms = await agentPermissionSet(db, agent.id);
      const capabilities = { webSearch: perms.has("research.web_search"), webFetch: perms.has("research.web_fetch") };
      if (!capabilities.webSearch && !capabilities.webFetch) throw new ServiceError("forbidden", `${agent.displayName} has no approved research capability.`);
      if (!perms.has("knowledge.write")) throw new ServiceError("forbidden", `${agent.displayName} may not write to the knowledge vault.`);
      const [business] = await db.select().from(businesses).where(eq(businesses.id, task.businessId));
      const [project] = task.projectId ? await db.select().from(projects).where(eq(projects.id, task.projectId)) : [];

      // ---- the ONE model assigned to this agent (never several providers) ----
      const assigned = resolveAgentModel(agent, perms);
      if (!findModel(assigned.model)?.webSearch) {
        throw new ServiceError("forbidden", `${assigned.model} cannot search the web with domain limits; assign a web-search model to ${agent.displayName}.`);
      }
      const provider = this.deps.providers(assigned.provider);
      const status = provider.status();
      if (!status.ready) throw new ProviderError(assigned.provider, "not-configured", `${PROVIDER_LABELS[assigned.provider]} is not configured: ${status.reason}`);

      await event("run.started", { provider: assigned.provider, model: assigned.model, trigger: "schedule", attempt: run.attempt });

      // ---- time limits: task deadline + heartbeat ------------------------------
      const deadline = (run.deadlineAt ?? new Date(this.now().getTime() + task.timeoutSeconds * 1000)).getTime();
      timers.push(setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now())));
      const beat = setInterval(() => {
        this.queue.heartbeat(run.id, workerId).then(
          (ok) => ok || controller.abort(),
          () => controller.abort(),
        );
      }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
      timers.push(beat as unknown as ReturnType<typeof setTimeout>);

      // ---- run the agent ---------------------------------------------------------
      spend = new SpendGuard(
        db,
        { organizationId: task.organizationId, businessId: task.businessId, sectorId: business?.sectorId ?? null, agentId: agent.id, runId: run.id, provider: assigned.provider, maxRunMicros: config.maxRunMicros },
        this.now,
      );
      const guard = spend;
      const result = await runResearch({
        provider,
        model: assigned.model,
        question: task.description,
        allowedDomains: config.allowedDomains,
        capabilities,
        limits: { maxSearches: config.maxSearches, maxFetches: config.maxFetches, effort: config.effort },
        signal: controller.signal,
        deadline,
        hooks: {
          reserve: (m) => guard.reserve(m),
          settle: (id, actual) => guard.settle(id, actual),
          release: (id) => guard.release(id),
          event: (type, payload) => event(type, payload).then(() => undefined),
          toolActivity: (a) =>
            writeAudit(db, {
              organizationId: task.organizationId,
              businessId: task.businessId,
              actor: { kind: "agent", id: agent.id },
              action: a.allowed ? `agent.tool.${a.tool}` : "agent.tool.denied",
              targetType: "task",
              targetId: task.id,
              metadata: { tool: a.tool, allowed: a.allowed, detail: a.detail.slice(0, 200), runId: run.id },
              at: this.now(),
            }),
        },
      });

      // ---- save the report to the knowledge vault ------------------------------------
      const completedAt = this.now().toISOString();
      const body = renderReportMarkdown(result.report, {
        question: task.description,
        model: result.model,
        taskId: task.id,
        costLabel: formatUsd(result.totalCostMicros),
        completedAt: `${completedAt.slice(0, 16).replace("T", " ")} UTC`,
      });
      const kctx = businessAgentContext(agent.slug, business!.slug);
      const noteInput = {
        kind: "report" as const,
        business: business!.slug,
        title: result.report.title,
        slug: `${slugify(result.report.title).slice(0, 48).replace(/-+$/, "")}-${task.id.slice(0, 8)}`,
        date: completedAt.slice(0, 10),
        body,
        project: project?.slug && /^[a-z0-9-]+$/.test(project.slug) ? project.slug : null,
        agent: agent.slug,
        tasks: [task.id],
        tags: ["research", "ai-generated"],
        status: "final" as const,
        origin: "app" as const,
      };
      let note;
      try {
        note = await this.deps.knowledge.createNote(kctx, noteInput);
      } catch (e) {
        if (!(e instanceof KnowledgeError && e.code === "already-exists")) throw e;
        // A previous attempt saved the note before failing: update it instead.
        const path = `businesses/${noteInput.business}/reports/${noteInput.date.slice(0, 4)}/${noteInput.date}-${noteInput.slug}.md`;
        note = await this.deps.knowledge.updateNote(kctx, path, { title: noteInput.title, body, status: "final" });
      }
      await db
        .insert(knowledgeDocuments)
        .values({
          organizationId: task.organizationId,
          businessId: task.businessId,
          vaultPath: note.path,
          kind: "report",
          title: note.meta.title,
          taskId: task.id,
          checksum: note.meta.id,
        })
        .onConflictDoNothing();

      const verified = result.report.sources.filter((s) => s.verified).length;
      const summary = `Report saved to ${note.path} · ${result.report.findings.length} findings · ${verified}/${result.report.sources.length} sources verified · ${result.report.uncertainFindings.length + result.report.uncertainties.length} uncertain items · cost ${formatUsd(result.totalCostMicros)}`;
      await event("run.completed", { summary, usage: null, costMicros: result.totalCostMicros, notePath: note.path, modelCalls: result.modelCalls });
      await this.queue.complete(run.id, workerId, summary);
    } catch (error) {
      const { message, retryable, code } = classify(error, spend);
      try {
        await event("run.failed", { errorCode: code, message });
        await this.queue.fail(run.id, workerId, message, { retryable });
      } catch (e) {
        // Lease lost (e.g. timed out and reaped): the reaper already handled the run.
        if (!(e instanceof ServiceError && e.reason === "lease-lost")) throw e;
      }
    } finally {
      for (const t of timers) clearTimeout(t);
    }
  }
}

/** Maps any failure to a safe, user-facing message and a retry decision. */
export function classify(error: unknown, spend: SpendGuard | null): { message: string; retryable: boolean; code: string } {
  const spent = spend ? ` (spent ${formatUsd(spend.spentMicros)} before stopping)` : "";
  if (error instanceof BudgetExceededError) return { message: `Spending limit reached: ${error.message}${spent}`, retryable: false, code: "BUDGET_EXCEEDED" };
  if (error instanceof ChiefError) return { message: `${error.message}${spent}`, retryable: error.retryable, code: error.code.toUpperCase() };
  if (error instanceof ResearchError) return { message: `${error.message}${spent}`, retryable: error.retryable, code: error.code.toUpperCase() };
  if (error instanceof ServiceError) return { message: error.message, retryable: false, code: error.code.toUpperCase() };
  if (error instanceof KnowledgeError) return { message: `Could not save the report: ${error.message}`, retryable: false, code: "KNOWLEDGE_ERROR" };
  if (error instanceof ProviderError) {
    return {
      message: error.retryable ? `${error.message.replace(/\.$/, "")}; will retry.${spent}` : error.message,
      retryable: error.retryable,
      code: error.kind.toUpperCase().replace(/-/g, "_"),
    };
  }
  console.error("[research-worker] unexpected error", error instanceof Error ? error.message : error);
  return { message: "Unexpected worker error (see server logs).", retryable: false, code: "INTERNAL" };
}

/** Polls for work until stopped. Used in-process and by scripts/worker.ts. */
export function startResearchWorkerLoop(worker: { tick(): Promise<"idle" | "processed"> }, intervalMs = 5_000): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    if (stopped) return;
    try {
      while (!stopped && (await worker.tick()) === "processed") {
        // keep draining while there is work
      }
    } catch (e) {
      console.error("[research-worker] tick failed:", e instanceof Error ? e.message : e);
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  };
  void loop();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

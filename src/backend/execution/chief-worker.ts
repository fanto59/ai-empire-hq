import { eq } from "drizzle-orm";
import { runChief, type ChiefHooks } from "@/agents/chief/agent";
import { renderBriefing } from "@/agents/chief/plan";
import { formatUsd } from "@/agents/research/pricing";
import type { Messages } from "@/agents/research/agent";
import type { ResearchConfig } from "@/infrastructure/config/env";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agentTaskContexts, agents, knowledgeDocuments } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import { SpendGuard } from "../budgets/spend-guard";
import { ServiceError } from "../errors";
import { KnowledgeError, type KnowledgeService } from "../knowledge";
import { ChiefToolbox } from "./chief-toolbox";
import { ExecutionQueue, type ClaimedRun } from "./queue";
import { classify } from "./research-worker";

/**
 * CHIEF AI MANAGER WORKER - executes `executive` tasks (owner objectives).
 *
 * Authorization before any model call: the assignee must be an ACTIVE agent
 * with role chief-ai-manager, headquarters-level, holding org.read. Spending
 * is charged to the organization budget (default $0). The conversation is
 * persisted per task (agent_task_contexts) and resumed on retry. The final
 * plan is stored in the run.completed event and as an HQ briefing note.
 */
export interface ChiefWorkerDeps {
  db: Db;
  knowledge: KnowledgeService;
  messages: () => Messages;
  config: Pick<ResearchConfig, "model" | "effort" | "maxRunMicros">;
  workerId: string;
  now?: () => Date;
  leaseMs?: number;
  backoffBaseMs?: number;
}

const KINDS = ["executive"] as const;

export class ChiefWorker {
  private readonly deps: ChiefWorkerDeps;
  readonly queue: ExecutionQueue;
  private readonly now: () => Date;
  private readonly leaseMs: number;

  constructor(deps: ChiefWorkerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.leaseMs = deps.leaseMs ?? 60_000;
    this.queue = new ExecutionQueue(deps.db, { now: this.now, leaseMs: this.leaseMs, backoffBaseMs: deps.backoffBaseMs });
  }

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
      const [agent] = task.assigneeAgentId ? await db.select().from(agents).where(eq(agents.id, task.assigneeAgentId)) : [];
      if (!agent || agent.status !== "active" || agent.role !== "chief-ai-manager" || agent.businessId !== null || task.businessId !== null) {
        throw new ServiceError("forbidden", "Executive objectives can only be executed by the active, headquarters-level Chief AI Manager.");
      }
      const perms = new Set((await db.select({ p: agentPermissions.permission }).from(agentPermissions).where(eq(agentPermissions.agentId, agent.id))).map((r) => r.p));
      if (!perms.has("org.read")) throw new ServiceError("forbidden", `${agent.displayName} lacks read access to organization records (org.read).`);

      await event("run.started", { provider: "anthropic", model: config.model, trigger: "owner", attempt: run.attempt });

      const deadline = (run.deadlineAt ?? new Date(this.now().getTime() + task.timeoutSeconds * 1000)).getTime();
      timers.push(setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now())));
      const beat = setInterval(() => {
        this.queue.heartbeat(run.id, workerId).then((ok) => ok || controller.abort(), () => controller.abort());
      }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
      timers.push(beat as unknown as ReturnType<typeof setTimeout>);

      // Persistent task context: resume a previous attempt's conversation.
      const [saved] = await db.select().from(agentTaskContexts).where(eq(agentTaskContexts.taskId, task.id));
      if (saved) await event("run.step", { stepIndex: 0, summary: "Resuming from saved task context." });

      spend = new SpendGuard(
        db,
        { organizationId: task.organizationId, businessId: null, agentId: agent.id, runId: run.id, provider: "anthropic", maxRunMicros: config.maxRunMicros },
        this.now,
      );
      const guard = spend;
      const toolbox = new ChiefToolbox(db, this.deps.knowledge, {
        organizationId: task.organizationId,
        chiefAgentId: agent.id,
        chiefSlug: agent.slug,
        executiveTaskId: task.id,
        canRequestWork: perms.has("task.request"),
        now: this.now,
      });
      const hooks: ChiefHooks = {
        reserve: (m) => guard.reserve(m),
        settle: (id, a) => guard.settle(id, a),
        release: (id) => guard.release(id),
        event: (type, payload) => event(type, payload).then(() => undefined),
        toolActivity: (a) =>
          writeAudit(db, {
            organizationId: task.organizationId,
            businessId: null,
            actor: { kind: "agent", id: agent.id },
            action: a.allowed ? `agent.tool.${a.tool}` : "agent.tool.denied",
            targetType: "task",
            targetId: task.id,
            metadata: { tool: a.tool, allowed: a.allowed, detail: a.detail.slice(0, 200), runId: run.id },
            at: this.now(),
          }),
        saveContext: async (messages) => {
          await db
            .insert(agentTaskContexts)
            .values({ taskId: task.id, agentId: agent.id, messages, updatedAt: this.now() })
            .onConflictDoUpdate({ target: agentTaskContexts.taskId, set: { messages, updatedAt: this.now() } });
        },
      };

      const result = await runChief({
        messages: this.deps.messages(),
        model: config.model,
        goal: task.description,
        savedContext: (saved?.messages as Parameters<typeof runChief>[0]["savedContext"]) ?? null,
        toolbox,
        signal: controller.signal,
        deadline,
        hooks,
        limits: { effort: config.effort },
      });

      // Briefing note (HQ scope; the Chief may write only headquarters notes).
      let notePath: string | null = null;
      if (perms.has("knowledge.write")) {
        const at = this.now().toISOString();
        try {
          const note = await this.deps.knowledge.createNote(
            { principal: { kind: "agent", id: agent.slug }, hq: true, businesses: [], write: true },
            {
              kind: "report",
              business: null,
              title: `Executive briefing: ${result.plan.objective.replace(/\s+/g, " ").slice(0, 120)}`,
              slug: `executive-briefing-${task.id.slice(0, 8)}`,
              date: at.slice(0, 10),
              body: renderBriefing(result.plan, {
                goal: task.description,
                model: result.model,
                taskId: task.id,
                costLabel: formatUsd(guard.spentMicros),
                at: `${at.slice(0, 16).replace("T", " ")} UTC`,
                requestedWork: toolbox.requested,
              }),
              agent: agent.slug,
              tasks: [task.id],
              tags: ["executive-briefing", "ai-generated"],
              status: "final",
              origin: "app",
            },
          );
          notePath = note.path;
          await db
            .insert(knowledgeDocuments)
            .values({ organizationId: task.organizationId, businessId: null, vaultPath: note.path, kind: "report", title: note.meta.title, taskId: task.id, checksum: note.meta.id })
            .onConflictDoNothing();
        } catch (e) {
          if (!(e instanceof KnowledgeError && e.code === "already-exists")) throw e;
        }
      }

      const summary = `Recommendation: ${result.plan.recommendation}`.slice(0, 1500);
      await event("run.completed", {
        summary,
        usage: null,
        costMicros: guard.spentMicros,
        modelCalls: result.modelCalls,
        notePath,
        requestedWork: toolbox.requested,
        plan: result.plan,
      });
      await this.queue.complete(run.id, workerId, summary);
    } catch (error) {
      const { message, retryable, code } = classify(error, spend);
      try {
        await event("run.failed", { errorCode: code, message });
        await this.queue.fail(run.id, workerId, message, { retryable });
      } catch (e) {
        if (!(e instanceof ServiceError && e.reason === "lease-lost")) throw e;
      }
    } finally {
      for (const t of timers) clearTimeout(t);
    }
  }
}

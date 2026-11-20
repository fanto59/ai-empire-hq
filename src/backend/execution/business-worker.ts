import { and, eq } from "drizzle-orm";
import { resumableContext } from "@/agents/chief/agent";
import { runBusinessAgent, type BusinessHooks } from "@/agents/business/agent";
import { renderDeliverable } from "@/agents/business/tools";
import { PROVIDER_LABELS } from "@/agents/providers/catalog";
import { ProviderError } from "@/agents/providers/errors";
import type { ProviderLookup } from "@/agents/providers/registry";
import { formatUsd } from "@/domain/money";
import type { ResearchConfig } from "@/infrastructure/config/env";
import type { Db } from "@/infrastructure/db/client";
import { agentTaskContexts, agents, businesses, knowledgeDocuments } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import { SpendGuard } from "../budgets/spend-guard";
import { ServiceError } from "../errors";
import { KnowledgeError, type KnowledgeService } from "../knowledge";
import { agentPermissionSet, resolveAgentModel } from "../models/assignment";
import { agentAccess, canAssignAgent } from "../org/rules";
import { BusinessToolbox } from "./business-toolbox";
import { ExecutionQueue, type ClaimedRun } from "./queue";
import { classify } from "./research-worker";

/**
 * SECTOR & BUSINESS AGENT WORKER - executes `business` tasks: work a person
 * explicitly assigned to a sector manager, business lead or specialist.
 *
 * Nothing starts on its own: only `business` tasks run (created by an owner
 * assignment), never older tracked `general` tasks or tasks that need
 * approval. Before any model call the worker re-checks: active agent, one of
 * the three roles, task.execute, and the org rule that the agent may work on
 * this business. Spending is reserved first against the organization,
 * business, sector, agent and provider budgets (the business budget defaults
 * to $0, so nothing is spent until the owner sets one). The deliverable is
 * saved as a DRAFT note in the business's folder when the agent may write.
 */
export interface BusinessWorkerDeps {
  db: Db;
  knowledge: KnowledgeService;
  providers: ProviderLookup;
  config: Pick<ResearchConfig, "effort" | "maxRunMicros">;
  workerId: string;
  now?: () => Date;
  leaseMs?: number;
  backoffBaseMs?: number;
}

export const BUSINESS_AGENT_ROLES = ["sector-manager", "business-lead", "specialist"] as const;
const FILTER = { kinds: ["business"] as const, assigneeRoles: BUSINESS_AGENT_ROLES, excludeApprovalRequired: true };

export class BusinessWorker {
  private readonly deps: BusinessWorkerDeps;
  readonly queue: ExecutionQueue;
  private readonly now: () => Date;
  private readonly leaseMs: number;

  constructor(deps: BusinessWorkerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.leaseMs = deps.leaseMs ?? 60_000;
    this.queue = new ExecutionQueue(deps.db, { now: this.now, leaseMs: this.leaseMs, backoffBaseMs: deps.backoffBaseMs });
  }

  async tick(): Promise<"idle" | "processed"> {
    await this.queue.reapExpired();
    await this.queue.enqueueReady(FILTER);
    const claimed = await this.queue.claim(this.deps.workerId, FILTER);
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
      // ---- authorize (again, at execution time) ---------------------------------
      const [agent] = task.assigneeAgentId ? await db.select().from(agents).where(eq(agents.id, task.assigneeAgentId)) : [];
      if (!agent || agent.status !== "active" || !(BUSINESS_AGENT_ROLES as readonly string[]).includes(agent.role)) {
        throw new ServiceError("forbidden", "Business work can only be executed by an active sector manager, business lead or specialist.");
      }
      if (!task.businessId) throw new ServiceError("forbidden", "Business work must belong to a business.");
      const [business] = await db.select().from(businesses).where(and(eq(businesses.id, task.businessId), eq(businesses.organizationId, task.organizationId)));
      if (!business) throw new ServiceError("forbidden", "Business not found.");
      const rule = canAssignAgent(agent, business);
      if (!rule.ok) throw new ServiceError("forbidden", rule.message);
      const perms = await agentPermissionSet(db, agent.id);
      if (!perms.has("task.execute")) throw new ServiceError("forbidden", `${agent.displayName} lacks the task.execute permission.`);

      const assigned = resolveAgentModel(agent, perms);
      const provider = this.deps.providers(assigned.provider);
      const status = provider.status();
      if (!status.ready) throw new ProviderError(assigned.provider, "not-configured", `${PROVIDER_LABELS[assigned.provider]} is not configured: ${status.reason}`);

      await event("run.started", { provider: assigned.provider, model: assigned.model, trigger: "owner", attempt: run.attempt });

      const deadline = (run.deadlineAt ?? new Date(this.now().getTime() + task.timeoutSeconds * 1000)).getTime();
      timers.push(setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now())));
      const beat = setInterval(() => {
        this.queue.heartbeat(run.id, workerId).then((ok) => ok || controller.abort(), () => controller.abort());
      }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
      timers.push(beat as unknown as ReturnType<typeof setTimeout>);

      const [saved] = await db.select().from(agentTaskContexts).where(eq(agentTaskContexts.taskId, task.id));
      if (saved) {
        const same = resumableContext(saved.messages, assigned.provider, assigned.model);
        await event("run.step", { stepIndex: 0, summary: same ? "Resuming from saved task context." : "Saved context was for a different model; starting over on the assigned model." });
      }

      spend = new SpendGuard(
        db,
        { organizationId: task.organizationId, businessId: business.id, sectorId: business.sectorId, agentId: agent.id, runId: run.id, provider: assigned.provider, maxRunMicros: config.maxRunMicros },
        this.now,
      );
      const guard = spend;

      // Scope: the agent's own business, or its sector's businesses (org rules).
      const orgBiz = await db.select({ id: businesses.id, slug: businesses.slug, sectorId: businesses.sectorId }).from(businesses).where(eq(businesses.organizationId, task.organizationId));
      const access = agentAccess(agent, orgBiz.filter((b) => agent.sectorId !== null && b.sectorId === agent.sectorId).map((b) => b.id));
      const slugs = new Map(orgBiz.filter((b) => access.businesses.includes(b.id)).map((b) => [b.id, b.slug]));
      const toolbox = new BusinessToolbox(
        db,
        this.deps.knowledge,
        {
          organizationId: task.organizationId,
          agentId: agent.id,
          agentSlug: agent.slug,
          agentSectorId: agent.sectorId,
          businessIds: access.businesses,
          taskId: task.id,
          taskBusiness: { id: business.id, slug: business.slug, name: business.name, sectorId: business.sectorId },
          canWriteDrafts: perms.has("knowledge.write"),
          canPropose: perms.has("approval.request"),
          now: this.now,
        },
        slugs,
      );
      const hooks: BusinessHooks = {
        reserve: (m) => guard.reserve(m),
        settle: (id, a) => guard.settle(id, a),
        release: (id) => guard.release(id),
        event: (type, payload) => event(type, payload).then(() => undefined),
        toolActivity: (a) =>
          writeAudit(db, {
            organizationId: task.organizationId,
            businessId: business.id,
            actor: { kind: "agent", id: agent.id },
            action: a.allowed ? `agent.tool.${a.tool}` : "agent.tool.denied",
            targetType: "task",
            targetId: task.id,
            metadata: { tool: a.tool, allowed: a.allowed, detail: a.detail.slice(0, 200), runId: run.id },
            at: this.now(),
          }).then(() => undefined),
        saveContext: async (context) => {
          const messages = context as unknown as Record<string, unknown>;
          await db
            .insert(agentTaskContexts)
            .values({ taskId: task.id, agentId: agent.id, messages, updatedAt: this.now() })
            .onConflictDoUpdate({ target: agentTaskContexts.taskId, set: { messages, updatedAt: this.now() } });
        },
      };

      const out = await runBusinessAgent({
        provider,
        model: assigned.model,
        agentName: agent.displayName,
        agentRole: agent.role,
        businessName: business.name,
        task: { title: task.title, description: task.description },
        savedContext: saved?.messages ?? null,
        toolbox,
        signal: controller.signal,
        deadline,
        hooks,
        limits: { effort: config.effort },
      });

      // ---- deliverable: a DRAFT note in this business's folder -----------------
      let notePath: string | null = null;
      if (perms.has("knowledge.write")) {
        const at = this.now().toISOString();
        try {
          const note = await this.deps.knowledge.createNote(
            { principal: { kind: "agent", id: agent.slug }, hq: false, businesses: [business.slug], write: true },
            {
              kind: "report",
              business: business.slug,
              title: `${task.title}`.slice(0, 180),
              slug: `deliverable-${task.id.slice(0, 8)}`,
              date: at.slice(0, 10),
              body: renderDeliverable(out.result, {
                task: task.title,
                agent: agent.displayName,
                business: business.name,
                model: out.model,
                costLabel: formatUsd(guard.spentMicros),
                at: `${at.slice(0, 16).replace("T", " ")} UTC`,
              }),
              agent: agent.slug,
              tasks: [task.id],
              tags: ["ai-generated", "agent-deliverable"],
              status: "draft",
              origin: "app",
            },
          );
          notePath = note.path;
          await db
            .insert(knowledgeDocuments)
            .values({ organizationId: task.organizationId, businessId: business.id, vaultPath: note.path, kind: "report", title: note.meta.title, taskId: task.id, checksum: note.meta.id })
            .onConflictDoNothing();
        } catch (e) {
          if (!(e instanceof KnowledgeError && e.code === "already-exists")) throw e;
          const { notes } = await this.deps.knowledge.listNotes({ principal: { kind: "agent", id: agent.slug }, hq: false, businesses: [business.slug], write: false }, { business: business.slug, task: task.id });
          notePath = notes.find((n) => n.meta.tags.includes("agent-deliverable"))?.path ?? null;
        }
      }

      const summary = out.result.summary.slice(0, 1500);
      await event("run.completed", {
        summary,
        usage: null,
        costMicros: guard.spentMicros,
        modelCalls: out.modelCalls,
        notePath,
        drafts: toolbox.drafts,
        proposals: toolbox.proposals,
        nextSteps: out.result.next_steps,
        openQuestions: out.result.open_questions,
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

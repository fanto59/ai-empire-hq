import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { ChiefToolbox as ChiefToolboxContract } from "@/agents/chief/agent";
import { MAX_WORK_REQUESTS, READ_TOOLS, REQUEST_TOOL, TASK_STATES_FOR_TOOLS } from "@/agents/chief/tools";
import type { TaskState } from "@/domain/task-lifecycle";
import type { Db } from "@/infrastructure/db/client";
import { agentTaskContexts, agents, budgets, businesses, projects, sectors } from "@/infrastructure/db/schema";
import type { RequestContext } from "../auth/context";
import { monthStart } from "../budgets/spend-guard";
import { ServiceError, UUID } from "../errors";
import { KnowledgeError, type KnowledgeAccessContext, type KnowledgeService } from "../knowledge";
import { applyTransition, lockTask } from "../tasks/engine";
import { TaskService } from "../tasks/service";

/**
 * Executes the Chief AI Manager's tool calls. This is the enforcement point
 * for its permissions:
 *
 * - READ tools use a read-only context (tasks:read only; knowledge write=false;
 *   agent principal, so restricted notes stay hidden). They never modify data.
 * - The REQUEST tool (only with the task.request permission) creates a
 *   `general` task (never executed by any worker), ALWAYS requiring owner
 *   approval, ALWAYS assigned to the Central Project Manager, at most
 *   MAX_WORK_REQUESTS per executive task, idempotent per title.
 * - There is no code path here (or anywhere the Chief can reach) that approves
 *   spending, changes budgets or permissions, decides approvals, or executes
 *   contracts.
 */
export interface ChiefScope {
  organizationId: string;
  chiefAgentId: string;
  chiefSlug: string;
  executiveTaskId: string;
  canRequestWork: boolean;
  now: () => Date;
}

const MAX_RESULT_CHARS = 12_000;

export class ChiefToolbox implements ChiefToolboxContract {
  private readonly db: Db;
  private readonly knowledge: KnowledgeService;
  private readonly scope: ChiefScope;
  readonly requested: string[] = [];

  constructor(db: Db, knowledge: KnowledgeService, scope: ChiefScope) {
    this.db = db;
    this.knowledge = knowledge;
    this.scope = scope;
  }

  /** Read-only view of the whole organization (records only, no secrets). */
  readContext(): RequestContext {
    return {
      organizationId: this.scope.organizationId,
      principal: { kind: "agent", id: `agent:${this.scope.chiefAgentId}`, agentId: this.scope.chiefAgentId },
      businesses: "*",
      hq: true,
      scopes: new Set(["tasks:read"]),
    };
  }

  knowledgeReadContext(): KnowledgeAccessContext {
    return { principal: { kind: "agent", id: this.scope.chiefSlug }, hq: true, businesses: "*", write: false };
  }

  async execute(name: string, input: unknown): Promise<{ ok: boolean; content: string; summary: string }> {
    try {
      const args = (input ?? {}) as Record<string, unknown>;
      if ((READ_TOOLS as readonly string[]).includes(name)) return await this.read(name, args);
      if (name === REQUEST_TOOL) return await this.requestWork(args);
      return fail(`Tool "${name}" is not available.`);
    } catch (e) {
      if (e instanceof ServiceError || e instanceof KnowledgeError) return fail(e.message);
      throw e;
    }
  }

  private async read(name: string, a: Record<string, unknown>) {
    const org = this.scope.organizationId;
    const tasksSvc = new TaskService(this.db);
    switch (name) {
      case "list_businesses": {
        const rows = await this.db
          .select({ id: businesses.id, slug: businesses.slug, name: businesses.name, status: businesses.status, sector: sectors.name })
          .from(businesses)
          .leftJoin(sectors, eq(sectors.id, businesses.sectorId))
          .where(eq(businesses.organizationId, org));
        return ok(rows, `${rows.length} businesses`);
      }
      case "list_projects": {
        const biz = this.businessFilter(a.business_id);
        const rows = await this.db
          .select({ id: projects.id, title: projects.title, status: projects.status, businessId: projects.businessId })
          .from(projects)
          .where(and(eq(projects.organizationId, org), biz === undefined ? undefined : biz === null ? sql`${projects.businessId} is null` : eq(projects.businessId, biz)));
        return ok(rows, `${rows.length} projects`);
      }
      case "list_tasks": {
        const state = TASK_STATES_FOR_TOOLS.includes(String(a.state)) ? (a.state as TaskState) : undefined;
        const rows = await tasksSvc.listTasks(this.readContext(), { state, businessId: this.businessFilter(a.business_id), limit: 50 });
        const compact = rows.map((t) => ({
          id: t.id,
          title: t.title,
          kind: t.kind,
          state: t.state,
          businessId: t.businessId,
          priority: t.priority,
          result: t.resultSummary?.slice(0, 300) ?? null,
          lastError: t.lastError?.slice(0, 300) ?? null,
        }));
        return ok(compact, `${compact.length} tasks`);
      }
      case "get_task": {
        const d = await tasksSvc.getTask(this.readContext(), String(a.task_id ?? ""));
        return ok(
          {
            id: d.task.id,
            title: d.task.title,
            kind: d.task.kind,
            state: d.task.state,
            description: d.task.description.slice(0, 2000),
            result: d.task.resultSummary,
            lastError: d.task.lastError,
            assignee: d.assignee?.displayName ?? null,
            dependencies: d.dependencies,
            reports: d.documents,
            history: d.history.slice(-10).map((h) => h.action),
          },
          `task ${d.task.state}`,
        );
      }
      case "list_reports": {
        const biz = this.businessFilter(a.business_id);
        let business: string | null | undefined;
        if (biz === null) business = null;
        else if (biz !== undefined) {
          const [b] = await this.db.select({ slug: businesses.slug }).from(businesses).where(and(eq(businesses.id, biz), eq(businesses.organizationId, org)));
          if (!b) return fail("Business not found.");
          business = b.slug;
        }
        const { notes } = await this.knowledge.listNotes(this.knowledgeReadContext(), business === undefined ? {} : { business });
        const rows = notes.slice(0, 50).map((n) => ({ path: n.path, title: n.meta.title, kind: n.meta.kind, business: n.meta.business, updated: n.meta.updated, origin: n.meta.origin }));
        return ok(rows, `${rows.length} notes`);
      }
      case "read_report": {
        const note = await this.knowledge.readNote(this.knowledgeReadContext(), String(a.path ?? ""));
        return ok({ path: note.path, title: note.meta.title, origin: note.meta.origin, tasks: note.meta.tasks, body: note.body.slice(0, MAX_RESULT_CHARS - 1000) }, `read ${note.path}`);
      }
      case "get_budget_status": {
        const rows = await this.db
          .select({ businessId: budgets.businessId, sectorId: budgets.sectorId, limitMicros: budgets.limitMicros, spentMicros: budgets.spentMicros })
          .from(budgets)
          .where(and(eq(budgets.organizationId, org), eq(budgets.periodStart, monthStart(this.scope.now()))));
        const usd = (m: number) => Math.round(m / 10_000) / 100;
        return ok(rows.map((b) => ({ scope: b.businessId ? `business:${b.businessId}` : b.sectorId ? `sector:${b.sectorId}` : "organization", limitUsd: usd(b.limitMicros), spentUsd: usd(b.spentMicros) })), `${rows.length} budgets`);
      }
    }
    return fail("Unknown read tool.");
  }

  private async requestWork(a: Record<string, unknown>) {
    if (!this.scope.canRequestWork) return fail("The Chief AI Manager lacks the task.request permission.");
    const title = typeof a.title === "string" ? a.title.trim().replace(/\s+/g, " ").slice(0, 150) : "";
    const description = typeof a.description === "string" ? a.description.trim().slice(0, 4000) : "";
    if (!title || description.length < 10) return fail("A request needs a title and a description of at least 10 characters.");
    const priority = Number.isInteger(a.priority) && (a.priority as number) >= 1 && (a.priority as number) <= 5 ? (a.priority as number) : 3;
    // Requests go to the Central Project Manager, a headquarters agent, so the
    // request itself is a headquarters task; the related business is recorded
    // in its description.
    const relatedBusiness = this.businessFilter(a.business_id) ?? null;
    let businessNote = "";
    if (relatedBusiness) {
      const [b] = await this.db.select({ name: businesses.name }).from(businesses).where(and(eq(businesses.id, relatedBusiness), eq(businesses.organizationId, this.scope.organizationId)));
      if (!b) return fail("Business not found.");
      businessNote = `\n\nRelated business: ${b.name} (${relatedBusiness}).`;
    }

    const [ctxRow] = await this.db.select({ n: agentTaskContexts.workRequests }).from(agentTaskContexts).where(eq(agentTaskContexts.taskId, this.scope.executiveTaskId));
    if ((ctxRow?.n ?? 0) >= MAX_WORK_REQUESTS) return fail(`Request limit reached (${MAX_WORK_REQUESTS} per objective).`);

    const [pm] = await this.db
      .select({ id: agents.id, displayName: agents.displayName })
      .from(agents)
      .where(and(eq(agents.organizationId, this.scope.organizationId), eq(agents.role, "central-project-manager"), eq(agents.status, "active")))
      .limit(1);
    if (!pm) return fail("There is no active Central Project Manager to receive requests.");

    const requester: RequestContext = { ...this.readContext(), scopes: new Set(["tasks:read", "tasks:write"]) };
    const key = `chief-${this.scope.executiveTaskId.slice(0, 8)}-${createHash("sha256").update(title.toLowerCase()).digest("hex").slice(0, 24)}`;
    const { task, created } = await new TaskService(this.db, { now: this.scope.now }).createTask(
      requester,
      {
        title: `Requested by Chief AI Manager: ${title}`.slice(0, 200),
        description: `${description}${businessNote}\n\nRequested while working on executive task ${this.scope.executiveTaskId}.`,
        kind: "general", // never picked up by an execution worker
        businessId: null,
        priority,
        requiresApproval: true, // the owner must approve before it can complete
      },
      key,
    );
    const assigned = `assigned to ${pm.displayName}`;
    if (created) {
      // Trusted backend step: route the request to the Central PM only.
      await this.db.transaction(async (tx) => {
        const locked = await lockTask(tx, task.id);
        if (locked) await applyTransition(tx, locked, { action: "assign", agentId: pm.id, reason: "Requested by the Chief AI Manager" }, { kind: "agent", id: this.scope.chiefAgentId }, this.scope.now());
      });
    }
    if (created) {
      await this.db
        .update(agentTaskContexts)
        .set({ workRequests: sql`${agentTaskContexts.workRequests} + 1` })
        .where(eq(agentTaskContexts.taskId, this.scope.executiveTaskId));
      this.requested.push(`${title} (task ${task.id}, ${assigned}, needs owner approval)`);
    }
    return ok({ taskId: task.id, created, status: assigned, requiresOwnerApproval: true }, created ? `requested "${title}"` : `already requested "${title}"`);
  }

  /** undefined = no filter, null = headquarters, string = business id (validated). */
  private businessFilter(v: unknown): string | null | undefined {
    if (v === null || v === undefined || v === "") return undefined;
    if (v === "hq") return null;
    if (typeof v === "string" && UUID.test(v)) return v;
    throw new ServiceError("invalid-input", 'business_id must be a business id from list_businesses, "hq", or null.');
  }
}

function ok(data: unknown, summary: string) {
  const content = JSON.stringify(data);
  return { ok: true, content: content.length > MAX_RESULT_CHARS ? `${content.slice(0, MAX_RESULT_CHARS)}…(truncated)` : content, summary };
}

function fail(message: string) {
  return { ok: false, content: message, summary: `error: ${message.slice(0, 120)}` };
}

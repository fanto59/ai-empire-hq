import { and, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BusinessToolbox as BusinessToolboxContract } from "@/agents/business/agent";
import { BUSINESS_READ_TOOLS, DRAFT_TOOL, MAX_DRAFTS, MAX_PROPOSALS, OUTSIDE_ACTION_KINDS, PROPOSE_TOOL } from "@/agents/business/tools";
import { TASK_STATES, type TaskState } from "@/domain/task-lifecycle";
import type { Db } from "@/infrastructure/db/client";
import { actionProposals, businesses, projects } from "@/infrastructure/db/schema";
import type { RequestContext } from "../auth/context";
import { proposeAction } from "../control/proposals";
import { ServiceError } from "../errors";
import { KnowledgeError, type KnowledgeAccessContext, type KnowledgeService } from "../knowledge";
import { TaskService } from "../tasks/service";

/**
 * Executes a sector or business agent's tool calls - the enforcement point for
 * its scope:
 *
 * - READS see only the businesses the agent works for (its own business, or
 *   its sector's businesses), through the same TaskService / KnowledgeService
 *   checks every caller gets. Restricted notes stay person-only.
 * - DRAFTS are written only into the TASK's business folder, as `draft`
 *   status, linked to the task, at most MAX_DRAFTS per task (counted from
 *   storage, so retries cannot exceed it).
 * - PROPOSALS are external-kind action proposals for the owner (needs the
 *   approval.request permission); at most MAX_PROPOSALS per task. Proposals
 *   are never executed here; nothing can execute an external kind today.
 */
export interface BusinessScopeInfo {
  organizationId: string;
  agentId: string;
  agentSlug: string;
  agentSectorId: string | null;
  /** Business ids the agent may access (from org rules). */
  businessIds: readonly string[];
  /** The task being worked. */
  taskId: string;
  taskBusiness: { id: string; slug: string; name: string; sectorId: string | null };
  canWriteDrafts: boolean;
  canPropose: boolean;
  now: () => Date;
}

const MAX_RESULT_CHARS = 12_000;

export class BusinessToolbox implements BusinessToolboxContract {
  private readonly db: Db;
  private readonly knowledge: KnowledgeService;
  private readonly scope: BusinessScopeInfo;
  private readonly slugs: Map<string, string>;
  readonly drafts: string[] = [];
  readonly proposals: string[] = [];

  constructor(db: Db, knowledge: KnowledgeService, scope: BusinessScopeInfo, businessSlugs: Map<string, string>) {
    this.db = db;
    this.knowledge = knowledge;
    this.scope = scope;
    this.slugs = businessSlugs; // id -> slug, only for businesses in scope
  }

  /** Read-only task context limited to the agent's businesses. */
  readContext(): RequestContext {
    return {
      organizationId: this.scope.organizationId,
      principal: { kind: "agent", id: `agent:${this.scope.agentId}`, agentId: this.scope.agentId },
      businesses: this.scope.businessIds,
      hq: false,
      scopes: new Set(["tasks:read"]),
    };
  }

  knowledgeContext(write: boolean, onlyTaskBusiness = false): KnowledgeAccessContext {
    return {
      principal: { kind: "agent", id: this.scope.agentSlug },
      hq: false,
      businesses: onlyTaskBusiness ? [this.scope.taskBusiness.slug] : [...this.slugs.values()],
      write,
    };
  }

  async execute(name: string, input: unknown): Promise<{ ok: boolean; content: string; summary: string }> {
    try {
      const args = (input ?? {}) as Record<string, unknown>;
      if ((BUSINESS_READ_TOOLS as readonly string[]).includes(name)) return await this.read(name, args);
      if (name === DRAFT_TOOL) return await this.saveDraft(args);
      if (name === PROPOSE_TOOL) return await this.propose(args);
      return fail(`Tool "${name}" is not available.`);
    } catch (e) {
      if (e instanceof ServiceError || e instanceof KnowledgeError) return fail(e.message);
      throw e;
    }
  }

  private businessSlug(v: unknown): string {
    if (v === null || v === undefined || v === "") return this.scope.taskBusiness.slug;
    if (typeof v === "string" && [...this.slugs.values()].includes(v)) return v;
    throw new ServiceError("forbidden", "You can only read the businesses you work for.");
  }

  private async read(name: string, a: Record<string, unknown>) {
    const tasksSvc = new TaskService(this.db);
    switch (name) {
      case "get_business_profile": {
        const slug = this.businessSlug(a.business);
        const [b] = await this.db
          .select({ name: businesses.name, status: businesses.status, description: businesses.description })
          .from(businesses)
          .where(and(eq(businesses.organizationId, this.scope.organizationId), eq(businesses.slug, slug)));
        let profile: string | null = null;
        try {
          profile = (await this.knowledge.readNote(this.knowledgeContext(false), `businesses/${slug}/business.md`)).body;
        } catch (e) {
          if (!(e instanceof KnowledgeError && (e.code === "not-found" || e.code === "access-denied"))) throw e;
        }
        return ok(
          { business: slug, name: b?.name ?? slug, status: b?.status ?? null, description: b?.description ?? null, profile: profile ?? "No profile has been written for this business yet." },
          profile ? `read the ${slug} profile` : `no profile for ${slug}`,
        );
      }
      case "list_tasks": {
        const state = TASK_STATES.includes(a.state as TaskState) ? (a.state as TaskState) : undefined;
        const rows = await tasksSvc.listTasks(this.readContext(), { state, limit: 50 });
        const compact = rows.map((t) => ({
          id: t.id,
          title: t.title,
          state: t.state,
          business: t.businessId ? (this.slugs.get(t.businessId) ?? null) : null,
          priority: t.priority,
          result: t.resultSummary?.slice(0, 300) ?? null,
        }));
        return ok(compact, `${compact.length} tasks`);
      }
      case "get_task": {
        const d = await tasksSvc.getTask(this.readContext(), String(a.task_id ?? ""));
        return ok(
          {
            id: d.task.id,
            title: d.task.title,
            state: d.task.state,
            description: d.task.description.slice(0, 2000),
            result: d.task.resultSummary,
            lastError: d.task.lastError,
            assignee: d.assignee?.displayName ?? null,
            reports: d.documents,
          },
          `task ${d.task.state}`,
        );
      }
      case "list_projects": {
        const ids = [...this.scope.businessIds];
        const sectorIds = [this.scope.agentSectorId, this.scope.taskBusiness.sectorId].filter((x): x is string => !!x);
        const rows = await this.db
          .select({ id: projects.id, title: projects.title, status: projects.status, businessId: projects.businessId })
          .from(projects)
          .where(
            and(
              eq(projects.organizationId, this.scope.organizationId),
              or(
                ids.length ? inArray(projects.businessId, ids) : sql`false`,
                sectorIds.length ? and(isNull(projects.businessId), inArray(projects.sectorId, sectorIds)) : sql`false`,
              ),
            ),
          );
        return ok(
          rows.map((p) => ({ id: p.id, title: p.title, status: p.status, business: p.businessId ? (this.slugs.get(p.businessId) ?? null) : "sector" })),
          `${rows.length} projects`,
        );
      }
      case "list_notes": {
        const filter = a.business === null || a.business === undefined || a.business === "" ? {} : { business: this.businessSlug(a.business) };
        const { notes } = await this.knowledge.listNotes(this.knowledgeContext(false), filter);
        const rows = notes.slice(0, 50).map((n) => ({ path: n.path, title: n.meta.title, kind: n.meta.kind, business: n.meta.business, status: n.meta.status, updated: n.meta.updated }));
        return ok(rows, `${rows.length} notes`);
      }
      case "read_note": {
        const note = await this.knowledge.readNote(this.knowledgeContext(false), String(a.path ?? ""));
        return ok({ path: note.path, title: note.meta.title, status: note.meta.status, body: note.body.slice(0, MAX_RESULT_CHARS - 1000) }, `read ${note.path}`);
      }
    }
    return fail("Unknown read tool.");
  }

  private async saveDraft(a: Record<string, unknown>) {
    if (!this.scope.canWriteDrafts) return fail("You lack the knowledge.write permission; put the content in your result instead.");
    const title = typeof a.title === "string" ? a.title.replace(/\s+/g, " ").trim().slice(0, 150) : "";
    const body = typeof a.body === "string" ? a.body.trim().slice(0, 20_000) : "";
    if (title.length < 3 || body.length < 20) return fail("A draft needs a title and a body of at least 20 characters.");
    const existing = await this.knowledge.listNotes(this.knowledgeContext(false, true), { business: this.scope.taskBusiness.slug, task: this.scope.taskId });
    const mine = existing.notes.filter((n) => n.meta.tags.includes("agent-draft"));
    if (mine.length >= MAX_DRAFTS) return fail(`Draft limit reached (${MAX_DRAFTS} per task).`);
    const at = this.scope.now().toISOString();
    const note = await this.knowledge.createNote(this.knowledgeContext(true, true), {
      kind: "report",
      business: this.scope.taskBusiness.slug,
      title: `Draft: ${title}`,
      slug: `draft-${this.scope.taskId.slice(0, 8)}-${mine.length + 1}`,
      date: at.slice(0, 10),
      body: `> AI-generated draft by ${this.scope.agentSlug}. Review before using; nothing was sent or published.\n\n${body}`,
      agent: this.scope.agentSlug,
      tasks: [this.scope.taskId],
      tags: ["ai-generated", "agent-draft"],
      status: "draft",
      origin: "app",
    });
    this.drafts.push(note.path);
    return ok({ path: note.path, status: "draft" }, `saved draft ${note.path}`);
  }

  private async propose(a: Record<string, unknown>) {
    if (!this.scope.canPropose) return fail("You lack the approval.request permission; list the action under open_questions instead.");
    if (typeof a.kind !== "string" || !OUTSIDE_ACTION_KINDS.includes(a.kind)) return fail("Unknown action kind.");
    const [row0] = await this.db
      .select({ n: count() })
      .from(actionProposals)
      .where(and(eq(actionProposals.organizationId, this.scope.organizationId), eq(actionProposals.proposedBy, this.scope.agentId), sql`${actionProposals.payload}->>'taskId' = ${this.scope.taskId}`));
    if (Number(row0?.n ?? 0) >= MAX_PROPOSALS) return fail(`Proposal limit reached (${MAX_PROPOSALS} per task).`);
    const amount = typeof a.amount_usd === "number" && Number.isFinite(a.amount_usd) && a.amount_usd >= 0 ? Math.round(a.amount_usd * 100) / 100 : null;
    const payload = {
      taskId: this.scope.taskId,
      business: this.scope.taskBusiness.slug,
      details: typeof a.details === "string" ? a.details.trim().slice(0, 2000) : "",
      counterparty: typeof a.counterparty === "string" ? a.counterparty.trim().slice(0, 200) : null,
      amountUsd: amount,
    };
    const ctx: RequestContext = { ...this.readContext(), businesses: [this.scope.taskBusiness.id] };
    const row = await proposeAction(this.db, ctx, { kind: a.kind, summary: `${this.scope.taskBusiness.name}: ${String(a.summary ?? "")}`, payload }, this.scope.now());
    this.proposals.push(`${row.summary} (proposal ${row.id}, awaiting the owner)`);
    return ok({ proposalId: row.id, status: "pending owner approval; nothing has been sent or done" }, `proposed ${a.kind}`);
  }
}

function ok(data: unknown, summary: string) {
  const content = JSON.stringify(data);
  return { ok: true, content: content.length > MAX_RESULT_CHARS ? `${content.slice(0, MAX_RESULT_CHARS)}…(truncated)` : content, summary };
}

function fail(message: string) {
  return { ok: false, content: message, summary: `error: ${message.slice(0, 120)}` };
}

import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { TASK_ACTIONS, TASK_STATES, availableActions, type TaskAction, type TaskState } from "@/domain/task-lifecycle";
import type { Db } from "@/infrastructure/db/client";
import { agents, approvalRequests, auditLogs, businesses, executionEvents, executionRuns, knowledgeDocuments, modelUsage, projects, taskDependencies, tasks } from "@/infrastructure/db/schema";
import { canAccessBusiness, type ApiScope, type RequestContext } from "../auth/context";
import { writeAudit } from "../audit";
import { canTaskJoinProject } from "../org/rules";
import { appendEvent, latestRun } from "../execution/events";
import { ServiceError, UUID, assertUuid } from "../errors";
import { findSecrets } from "../knowledge/secrets";
import { applyTransition, lockTask, type Actor, type RunRow, type TaskRow } from "./engine";

/**
 * TASK SERVICE - the authenticated application API for tasks.
 *
 * Every method takes a RequestContext. Records outside the caller's
 * businesses are reported as "not found" so their existence is not leaked.
 */
export interface CreateTaskInput {
  title: string;
  /** "research" → Research Agent worker; "executive" → Chief AI Manager worker. */
  kind?: "general" | "research" | "executive";
  description?: string;
  businessId: string | null;
  projectId?: string | null;
  priority?: number;
  requiresApproval?: boolean;
  maxAttempts?: number;
  timeoutSeconds?: number;
  dependsOn?: string[];
}

export interface TransitionRequest {
  action: TaskAction;
  agentId?: string;
  reason?: string;
  result?: string;
  error?: string;
  approval?: { action: string; reason: string };
  expectedVersion?: number;
}

export interface TaskListFilter {
  state?: TaskState;
  businessId?: string | null;
  projectId?: string;
  assigneeAgentId?: string;
  limit?: number;
}

export interface TaskDetail {
  task: TaskRow;
  assignee: { id: string; slug: string; displayName: string } | null;
  dependencies: { id: string; title: string; state: TaskState }[];
  runs: RunRow[];
  approvals: (typeof approvalRequests.$inferSelect)[];
  history: { action: string; actorKind: string; actorId: string; occurredAt: Date; metadata: unknown }[];
  /** Execution events across all runs (oldest first, capped). */
  events: (typeof executionEvents.$inferSelect)[];
  /** Total model spend recorded for this task's runs, in micro-dollars. */
  costMicros: number;
  /** Knowledge vault notes linked to this task (e.g. research reports). */
  documents: { vaultPath: string; title: string }[];
  availableActions: TaskAction[];
}

/** What an agent principal may do, and only on tasks assigned to itself. */
const AGENT_ACTIONS: readonly TaskAction[] = ["start", "wait", "complete", "fail"];
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

export class TaskService {
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly recordEvents: boolean;

  /**
   * recordEvents=false is ONLY for the test-data seed: seeded tasks get no
   * execution events, so the live office never shows invented activity.
   */
  constructor(db: Db, options: { now?: () => Date; recordEvents?: boolean } = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    this.recordEvents = options.recordEvents ?? true;
  }

  async createTask(ctx: RequestContext, input: CreateTaskInput, idempotencyKey?: string): Promise<{ task: TaskRow; created: boolean }> {
    requireScope(ctx, "tasks:write");
    const v = validateCreate(input);
    if (!canAccessBusiness(ctx, v.businessId)) throw new ServiceError("forbidden", "You cannot create tasks in that business.");
    if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new ServiceError("invalid-input", "Idempotency-Key must be 8-128 characters of letters, digits, '_', '.', ':' or '-'.");
    }
    const now = this.now();

    return this.db.transaction(async (tx) => {
      const [business] = v.businessId ? await tx.select().from(businesses).where(eq(businesses.id, v.businessId)) : [];
      if (v.businessId && (!business || business.organizationId !== ctx.organizationId)) throw new ServiceError("invalid-input", "Business not found.");
      if (business?.status === "archived") throw new ServiceError("conflict", `${business.name} is archived and takes no new work.`, "business-archived");
      if (v.projectId) {
        const [project] = await tx.select().from(projects).where(eq(projects.id, v.projectId));
        if (!project || project.organizationId !== ctx.organizationId) throw new ServiceError("invalid-input", "Project not found.");
        // Cross-sector rules: business projects take their business's tasks, sector projects
        // their sector's, headquarters projects any business.
        const rule = canTaskJoinProject(project, business ?? null);
        if (!rule.ok) throw new ServiceError("invalid-input", rule.message, rule.code);
      }
      if (v.dependsOn.length > 0) {
        const deps = await tx
          .select({ id: tasks.id, businessId: tasks.businessId, organizationId: tasks.organizationId })
          .from(tasks)
          .where(inArray(tasks.id, v.dependsOn));
        const visible = deps.filter((d) => d.organizationId === ctx.organizationId && canAccessBusiness(ctx, d.businessId));
        if (visible.length !== v.dependsOn.length) throw new ServiceError("invalid-input", "One or more dependencies were not found.");
      }

      const [inserted] = await tx
        .insert(tasks)
        .values({
          organizationId: ctx.organizationId,
          businessId: v.businessId,
          projectId: v.projectId,
          title: v.title,
          kind: v.kind,
          description: v.description,
          priority: v.priority,
          requiresApproval: v.requiresApproval,
          maxAttempts: v.maxAttempts,
          timeoutSeconds: v.timeoutSeconds,
          idempotencyKey: idempotencyKey ?? null,
          createdByKind: ctx.principal.kind,
          createdById: ctx.principal.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        // Same Idempotency-Key as an earlier request: return the original task.
        const [existing] = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.organizationId, ctx.organizationId), eq(tasks.idempotencyKey, idempotencyKey!)));
        if (!existing || !canAccessBusiness(ctx, existing.businessId)) throw new ServiceError("conflict", "Idempotency-Key already used.");
        return { task: existing, created: false };
      }

      if (v.dependsOn.length > 0) {
        await tx.insert(taskDependencies).values(v.dependsOn.map((d) => ({ taskId: inserted.id, dependsOnTaskId: d, createdAt: now })));
      }
      await writeAudit(tx, {
        organizationId: ctx.organizationId,
        businessId: v.businessId,
        actor: actorOf(ctx),
        action: "task.create",
        targetType: "task",
        targetId: inserted.id,
        metadata: { title: v.title.slice(0, 120) },
        at: now,
      });
      return { task: inserted, created: true };
    });
  }

  async getTask(ctx: RequestContext, taskId: string): Promise<TaskDetail> {
    requireScope(ctx, "tasks:read");
    const task = await this.visibleTask(ctx, taskId);
    const [assignee, dependencies, runs, approvals, history] = await Promise.all([
      task.assigneeAgentId
        ? this.db
            .select({ id: agents.id, slug: agents.slug, displayName: agents.displayName })
            .from(agents)
            .where(eq(agents.id, task.assigneeAgentId))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      this.db
        .select({ id: tasks.id, title: tasks.title, state: tasks.state })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
        .where(eq(taskDependencies.taskId, task.id)),
      this.db.select().from(executionRuns).where(eq(executionRuns.taskId, task.id)).orderBy(asc(executionRuns.createdAt)),
      this.db.select().from(approvalRequests).where(eq(approvalRequests.taskId, task.id)).orderBy(asc(approvalRequests.createdAt)),
      this.db
        .select({
          action: auditLogs.action,
          actorKind: auditLogs.actorKind,
          actorId: auditLogs.actorId,
          occurredAt: auditLogs.occurredAt,
          metadata: auditLogs.metadata,
        })
        .from(auditLogs)
        .where(and(eq(auditLogs.targetType, "task"), eq(auditLogs.targetId, task.id)))
        .orderBy(asc(auditLogs.id)),
    ]);
    const runIds = runs.map((r) => r.id);
    const [events, cost, documents] = await Promise.all([
      this.db.select().from(executionEvents).where(eq(executionEvents.taskId, task.id)).orderBy(asc(executionEvents.occurredAt), asc(executionEvents.sequence)).limit(200),
      runIds.length
        ? this.db.select({ total: sql<number>`coalesce(sum(${modelUsage.costMicros}), 0)::bigint` }).from(modelUsage).where(inArray(modelUsage.runId, runIds))
        : Promise.resolve([{ total: 0 }]),
      this.db.select({ vaultPath: knowledgeDocuments.vaultPath, title: knowledgeDocuments.title }).from(knowledgeDocuments).where(eq(knowledgeDocuments.taskId, task.id)),
    ]);
    return {
      task,
      assignee,
      dependencies,
      runs,
      approvals,
      history,
      events,
      costMicros: Number(cost[0]?.total ?? 0),
      documents,
      availableActions: availableActions(task),
    };
  }

  async listTasks(ctx: RequestContext, filter: TaskListFilter = {}): Promise<TaskRow[]> {
    requireScope(ctx, "tasks:read");
    const where: SQL[] = [eq(tasks.organizationId, ctx.organizationId)];
    const scope = scopeCondition(ctx);
    if (scope) where.push(scope);
    if (filter.state) {
      if (!TASK_STATES.includes(filter.state)) throw new ServiceError("invalid-input", "Unknown state filter.");
      where.push(eq(tasks.state, filter.state));
    }
    if (filter.businessId !== undefined) {
      where.push(filter.businessId === null ? isNull(tasks.businessId) : eq(tasks.businessId, assertUuid(filter.businessId, "businessId")));
    }
    if (filter.projectId) where.push(eq(tasks.projectId, assertUuid(filter.projectId, "projectId")));
    if (filter.assigneeAgentId) where.push(eq(tasks.assigneeAgentId, assertUuid(filter.assigneeAgentId, "assigneeAgentId")));
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    return this.db.select().from(tasks).where(and(...where)).orderBy(asc(tasks.priority), desc(tasks.updatedAt)).limit(limit);
  }

  async transition(ctx: RequestContext, taskId: string, req: TransitionRequest): Promise<TaskRow> {
    requireScope(ctx, "tasks:transition");
    if (!TASK_ACTIONS.includes(req.action)) throw new ServiceError("invalid-input", `Unknown action. Use one of: ${TASK_ACTIONS.join(", ")}.`);
    if (req.agentId !== undefined) assertUuid(req.agentId, "agentId");
    for (const text of [req.reason, req.result, req.error, req.approval?.action, req.approval?.reason]) {
      if (text !== undefined && (typeof text !== "string" || text.length > 2000)) throw new ServiceError("invalid-input", "Text fields must be strings of at most 2000 characters.");
    }
    const secrets = findSecrets(req.reason ?? "", req.result ?? "", req.error ?? "", req.approval?.reason ?? "");
    if (secrets.length > 0) throw new ServiceError("invalid-input", `Refusing text that looks like a secret (${secrets.join(", ")}).`);
    if (req.approval && req.action !== "wait") throw new ServiceError("invalid-input", "approval is only valid with the wait action.");

    const now = this.now();
    return this.db.transaction(async (tx) => {
      assertUuid(taskId, "taskId");
      const task = await lockTask(tx, taskId);
      if (!task || task.organizationId !== ctx.organizationId || !canAccessBusiness(ctx, task.businessId)) {
        throw new ServiceError("not-found", "Task not found.");
      }
      if (ctx.principal.kind === "agent") {
        if (!AGENT_ACTIONS.includes(req.action) || task.assigneeAgentId !== ctx.principal.agentId) {
          throw new ServiceError("forbidden", "Agents may only start, wait on, complete or fail tasks assigned to them.");
        }
      }
      return applyTransition(
        tx,
        task,
        { ...req, workerId: req.action === "start" ? `api:${ctx.principal.id}` : undefined, recordEvents: this.recordEvents },
        actorOf(ctx),
        now,
      );
    });
  }

  /** Human decision on an approval request. Agents can never approve. */
  async decideApproval(ctx: RequestContext, approvalId: string, decision: "approved" | "rejected", note?: string) {
    requireScope(ctx, "approvals:decide");
    if (ctx.principal.kind !== "user") throw new ServiceError("forbidden", "Only people can decide approval requests.");
    if (decision !== "approved" && decision !== "rejected") throw new ServiceError("invalid-input", "decision must be approved or rejected.");
    assertUuid(approvalId, "approvalId");
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [approval] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).for("update");
      const task = approval ? await lockTask(tx, approval.taskId) : undefined;
      if (!approval || !task || task.organizationId !== ctx.organizationId || !canAccessBusiness(ctx, task.businessId)) {
        throw new ServiceError("not-found", "Approval request not found.");
      }
      if (approval.status !== "pending") throw new ServiceError("conflict", `Approval request is already ${approval.status}.`);
      await tx.update(approvalRequests).set({ status: decision, decidedBy: ctx.principal.id, decidedAt: now }).where(eq(approvalRequests.id, approvalId));
      await writeAudit(tx, {
        organizationId: task.organizationId,
        businessId: task.businessId,
        actor: actorOf(ctx),
        action: `approval.${decision}`,
        targetType: "task",
        targetId: task.id,
        metadata: { approvalId, note: note ? note.slice(0, 200) : null },
        at: now,
      });
      const run = this.recordEvents ? await latestRun(tx, task.id) : undefined;
      if (run) await appendEvent(tx, { run, task, type: "approval.resolved", payload: { approvalId, decision, by: "user" }, origin: "live", at: now });
      // A rejection ends the task; an approval lets it resume.
      if (decision === "rejected" && task.state === "waiting") {
        return applyTransition(tx, task, { action: "fail", error: "Approval was rejected.", errorCode: "APPROVAL_REJECTED", recordEvents: this.recordEvents }, actorOf(ctx), now);
      }
      return task;
    });
  }

  private async visibleTask(ctx: RequestContext, taskId: string): Promise<TaskRow> {
    if (typeof taskId !== "string" || !UUID.test(taskId)) throw new ServiceError("not-found", "Task not found.");
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task || task.organizationId !== ctx.organizationId || !canAccessBusiness(ctx, task.businessId)) {
      throw new ServiceError("not-found", "Task not found.");
    }
    return task;
  }
}

function requireScope(ctx: RequestContext, scope: ApiScope) {
  if (!ctx.scopes.has(scope)) throw new ServiceError("forbidden", `This token lacks the ${scope} scope.`);
}

function actorOf(ctx: RequestContext): Actor {
  return { kind: ctx.principal.kind, id: ctx.principal.agentId ?? ctx.principal.id };
}

function scopeCondition(ctx: RequestContext): SQL | undefined {
  if (ctx.businesses === "*") return ctx.hq ? undefined : isNotNull(tasks.businessId);
  const ids = [...ctx.businesses];
  const inBiz = ids.length > 0 ? inArray(tasks.businessId, ids) : undefined;
  if (ctx.hq) return inBiz ? or(inBiz, isNull(tasks.businessId)) : isNull(tasks.businessId);
  // No businesses and no HQ access: match nothing.
  return inBiz ?? sql`false`;
}

function validateCreate(input: CreateTaskInput) {
  if (typeof input !== "object" || input === null) throw new ServiceError("invalid-input", "Body must be a JSON object.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 200 || /[\r\n\0]/.test(title)) throw new ServiceError("invalid-input", "title must be a single line of 1-200 characters.");
  const description = input.description ?? "";
  if (typeof description !== "string" || description.length > 10_000 || description.includes("\0")) {
    throw new ServiceError("invalid-input", "description must be text of at most 10,000 characters.");
  }
  const secrets = findSecrets(title, description);
  if (secrets.length > 0) throw new ServiceError("invalid-input", `Refusing task text that looks like a secret (${secrets.join(", ")}).`);
  const businessId = input.businessId === null ? null : assertUuid(input.businessId, "businessId");
  const projectId = input.projectId == null ? null : assertUuid(input.projectId, "projectId");
  const int = (v: unknown, lo: number, hi: number, def: number, field: string) => {
    if (v === undefined) return def;
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new ServiceError("invalid-input", `${field} must be an integer from ${lo} to ${hi}.`);
    return v;
  };
  const dependsOn = input.dependsOn ?? [];
  if (!Array.isArray(dependsOn) || dependsOn.length > 20) throw new ServiceError("invalid-input", "dependsOn must be a list of at most 20 task ids.");
  dependsOn.forEach((d) => assertUuid(d, "dependsOn[]"));
  if (input.requiresApproval !== undefined && typeof input.requiresApproval !== "boolean") throw new ServiceError("invalid-input", "requiresApproval must be true or false.");
  const kind = input.kind ?? "general";
  if (kind !== "general" && kind !== "research" && kind !== "executive") throw new ServiceError("invalid-input", "kind must be general, research or executive.");
  if (kind === "executive") {
    if (businessId !== null) throw new ServiceError("invalid-input", "Executive objectives are headquarters tasks (businessId must be null).");
    if (description.trim().length < 10 || description.length > 4000) {
      throw new ServiceError("invalid-input", "An objective needs 10-4,000 characters in its description.");
    }
  }
  if (kind === "research") {
    if (businessId === null) throw new ServiceError("invalid-input", "Research tasks belong to a business.");
    if (description.trim().length < 10 || description.length > 2000) {
      throw new ServiceError("invalid-input", "A research task needs a question of 10-2,000 characters in its description.");
    }
  }
  return {
    kind,
    title,
    description,
    businessId,
    projectId,
    priority: int(input.priority, 1, 5, 3, "priority"),
    requiresApproval: input.requiresApproval ?? false,
    maxAttempts: int(input.maxAttempts, 1, 20, 3, "maxAttempts"),
    timeoutSeconds: int(input.timeoutSeconds, 1, 86_400, 900, "timeoutSeconds"),
    dependsOn: [...new Set(dependsOn)],
  };
}

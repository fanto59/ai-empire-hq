import { and, eq, inArray } from "drizzle-orm";
import type { ControlResult } from "@/domain/control";
import type { Db } from "@/infrastructure/db/client";
import { agents, budgets, orgControls, projects, tasks } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import { canAccessBusiness, type RequestContext } from "../auth/context";
import { budgetScopeFilter, monthStart } from "../budgets/spend-guard";
import { ServiceError } from "../errors";
import { assignWork } from "../tasks/assignments";
import { TaskService } from "../tasks/service";
import { accepted, assertPerson, isNewWorkSuspended } from "./common";
import { budgetScopeFromPayload, proposeAction } from "./proposals";

/**
 * CONTROL CENTER OPERATIONS - each checks authorization on the server,
 * applies the change in a transaction with an audit entry, and returns an
 * explicit ControlResult. Safety-reducing actions (suspend, pause, cancel,
 * lower a budget) apply immediately; safety-increasing ones (lift the
 * suspension, raise a budget) become proposals that need an approval token.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown, what: string) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new ServiceError("not-found", `${what} not found.`);
  return v;
};
const reasonOf = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : fallback);
const OPEN = ["queued", "assigned", "running", "waiting", "paused"] as const;

const audit = (db: Parameters<typeof writeAudit>[0], ctx: RequestContext, action: string, targetType: string, targetId: string, now: Date, metadata: Record<string, string | number | boolean | null> = {}, businessId: string | null = null) =>
  writeAudit(db, { organizationId: ctx.organizationId, businessId, actor: { kind: "user", id: ctx.principal.id }, action, targetType, targetId, metadata, at: now });

// ---- emergency suspension -----------------------------------------------------------------------

/** Emergency stop: no new runs start anywhere in the organization. Running work finishes (or cancel it). */
export async function suspendNewWork(db: Db, ctx: RequestContext, reason: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "emergency:operate");
  return db.transaction(async (tx) => {
    if (await isNewWorkSuspended(tx, ctx.organizationId)) throw new ServiceError("conflict", "New work is already suspended.", "duplicate");
    const r = reasonOf(reason, "Emergency suspension");
    await tx
      .insert(orgControls)
      .values({ organizationId: ctx.organizationId, newWorkSuspended: true, reason: r, changedBy: ctx.principal.id, changedAt: now })
      .onConflictDoUpdate({ target: orgControls.organizationId, set: { newWorkSuspended: true, reason: r, changedBy: ctx.principal.id, changedAt: now } });
    const auditId = await audit(tx, ctx, "control.new_work_suspended", "organization", ctx.organizationId, now, { reason: r });
    return accepted("New work is suspended: no new runs will start. Work already running continues unless you cancel it.", auditId, now);
  });
}

/** Lifting the suspension needs an approved, token-bound proposal. */
export async function requestResumeNewWork(db: Db, ctx: RequestContext, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "emergency:operate");
  if (!(await isNewWorkSuspended(db, ctx.organizationId))) throw new ServiceError("conflict", "New work is not suspended.", "not-suspended");
  const p = await proposeAction(db, ctx, { kind: "resume_new_work", summary: "Lift the emergency suspension of new work", payload: { organizationId: ctx.organizationId } }, now);
  return accepted("Resume proposed. New work stays suspended until the proposal is approved and executed.", null, now, { code: "needs-approval", message: `Resume proposed (proposal ${p.id.slice(0, 8)}). New work stays suspended until it is approved and executed.` });
}

// ---- agents ---------------------------------------------------------------------------------------

async function loadAgent(db: Db, ctx: RequestContext, agentId: unknown) {
  const [a] = await db.select().from(agents).where(and(eq(agents.id, id(agentId, "Agent")), eq(agents.organizationId, ctx.organizationId)));
  if (!a) throw new ServiceError("not-found", "Agent not found.");
  return a;
}

/** Pauses an agent: it takes no new runs (queued work waits). Running work continues unless canceled. */
export async function pauseAgent(db: Db, ctx: RequestContext, agentId: unknown, reason: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "agents:operate");
  const a = await loadAgent(db, ctx, agentId);
  if (a.status === "disabled") throw new ServiceError("conflict", `${a.displayName} is already paused.`, "duplicate");
  if (a.status !== "active") throw new ServiceError("conflict", `${a.displayName} is ${a.status}.`);
  return db.transaction(async (tx) => {
    await tx.update(agents).set({ status: "disabled", updatedAt: now }).where(eq(agents.id, a.id));
    const auditId = await audit(tx, ctx, "control.agent_paused", "agent", a.id, now, { reason: reasonOf(reason, "Paused from the control center") }, a.businessId);
    return accepted(`${a.displayName} is paused: it starts no new work.`, auditId, now);
  });
}

export async function resumeAgent(db: Db, ctx: RequestContext, agentId: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "agents:operate");
  const a = await loadAgent(db, ctx, agentId);
  if (a.status !== "disabled") throw new ServiceError("conflict", `${a.displayName} is not paused (it is ${a.status}).`, a.status === "active" ? "duplicate" : a.status);
  return db.transaction(async (tx) => {
    await tx.update(agents).set({ status: "active", updatedAt: now }).where(eq(agents.id, a.id));
    const auditId = await audit(tx, ctx, "control.agent_resumed", "agent", a.id, now, {}, a.businessId);
    return accepted(`${a.displayName} is active again. Its queued work can start (unless new work is suspended).`, auditId, now);
  });
}

/** Cancels all of an agent's open work. Running model calls stop at the worker's next heartbeat. */
export async function cancelAgentWork(db: Db, ctx: RequestContext, agentId: unknown, reason: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "agents:operate");
  if (!ctx.scopes.has("tasks:transition")) throw new ServiceError("forbidden", "This needs the tasks:transition permission.", "unauthorized");
  const a = await loadAgent(db, ctx, agentId);
  const open = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assigneeAgentId, a.id), inArray(tasks.state, [...OPEN])));
  if (open.length === 0) throw new ServiceError("conflict", `${a.displayName} has no open work.`, "nothing-to-do");
  const svc = new TaskService(db, { now: () => now });
  const r = reasonOf(reason, "Canceled from the control center");
  let canceled = 0;
  for (const t of open) {
    try {
      await svc.transition(ctx, t.id, { action: "cancel", reason: r });
      canceled++;
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e; // finished meanwhile: skip
    }
  }
  const auditId = await audit(db, ctx, "control.agent_work_canceled", "agent", a.id, now, { canceled, reason: r }, a.businessId);
  return accepted(`Canceled ${canceled} task${canceled === 1 ? "" : "s"} of ${a.displayName}. Running calls stop at the next heartbeat.`, auditId, now);
}

export async function cancelTask(db: Db, ctx: RequestContext, taskId: unknown, reason: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "tasks:transition");
  const tid = id(taskId, "Task");
  const r = reasonOf(reason, "Canceled from the control center");
  const t = await new TaskService(db, { now: () => now }).transition(ctx, tid, { action: "cancel", reason: r });
  const auditId = await audit(db, ctx, "control.task_canceled", "task", t.id, now, { reason: r }, t.businessId);
  return accepted(`"${t.title}" was canceled.`, auditId, now);
}

// ---- tasks, projects, approvals ------------------------------------------------------------------

export async function assignFromControl(db: Db, ctx: RequestContext, input: { agentId: unknown; instructions: unknown; title?: unknown; businessId?: unknown }, key: string, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "tasks:write");
  const r = await assignWork(
    db,
    ctx,
    {
      agentId: String(input.agentId ?? ""),
      instructions: String(input.instructions ?? ""),
      title: typeof input.title === "string" && input.title ? input.title : undefined,
      businessId: typeof input.businessId === "string" && input.businessId ? input.businessId : undefined,
    },
    key,
  );
  const suspended = await isNewWorkSuspended(db, ctx.organizationId);
  const auditId = await audit(db, ctx, "control.assignment", "task", r.task.id, now, { agentId: r.agent.id }, r.task.businessId);
  return accepted(`${r.note}${suspended ? " New work is suspended, so it will not start until the suspension is lifted." : ""}`, auditId, now);
}

const PROJECT_STATUSES = ["proposed", "active", "on-hold", "done", "canceled"] as const;
export async function setProjectStatus(db: Db, ctx: RequestContext, projectId: unknown, status: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "tasks:write");
  if (!PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number])) throw new ServiceError("invalid-input", "Unknown project status.");
  const [p] = await db.select().from(projects).where(and(eq(projects.id, id(projectId, "Project")), eq(projects.organizationId, ctx.organizationId)));
  if (!p || !canAccessBusiness(ctx, p.businessId)) throw new ServiceError("not-found", "Project not found.");
  if (p.status === status) throw new ServiceError("conflict", `The project is already ${p.status}.`, "duplicate");
  return db.transaction(async (tx) => {
    await tx.update(projects).set({ status: status as (typeof PROJECT_STATUSES)[number], updatedAt: now }).where(eq(projects.id, p.id));
    const auditId = await audit(tx, ctx, "control.project_status", "project", p.id, now, { from: p.status, to: String(status) }, p.businessId);
    return accepted(`"${p.title}" is now ${String(status)}.`, auditId, now);
  });
}

export async function decideTaskApproval(db: Db, ctx: RequestContext, approvalId: unknown, decision: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "approvals:decide");
  if (decision !== "approved" && decision !== "rejected") throw new ServiceError("invalid-input", "Decision must be approve or reject.");
  const t = await new TaskService(db, { now: () => now }).decideApproval(ctx, String(approvalId ?? ""), decision);
  const auditId = await audit(db, ctx, `control.task_approval_${decision}`, "task", t.id, now, { approvalId: String(approvalId) }, t.businessId);
  return accepted(decision === "approved" ? `Approved. "${t.title}" may resume.` : `Rejected. "${t.title}" was failed.`, auditId, now);
}

// ---- budgets ---------------------------------------------------------------------------------------

/**
 * Sets this month's limit for a scope (organization, sector, business,
 * agent or provider). Lowering (or creating at $0) applies now; RAISING
 * creates a budget_increase proposal that needs an approval token.
 */
export async function setBudgetLimit(db: Db, ctx: RequestContext, input: { scope: unknown; usd: unknown }, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "budgets:admin");
  const scope = budgetScopeFromPayload(input.scope);
  const usd = Number(input.usd);
  if (!Number.isFinite(usd) || usd < 0 || usd > 1000) throw new ServiceError("invalid-input", "Enter an amount from $0 to $1,000.");
  const toMicros = Math.round(usd * 1_000_000);
  const period = monthStart(now);
  const [row] = await db.select().from(budgets).where(budgetScopeFilter(ctx.organizationId, scope, period));
  const fromMicros = row?.limitMicros ?? 0;
  if (row && toMicros === fromMicros) throw new ServiceError("conflict", "That is already the limit.", "duplicate");
  if (toMicros > fromMicros) {
    const p = await proposeAction(db, ctx, { kind: "budget_increase", summary: `Raise ${scopeLabel(input.scope)} budget from $${(fromMicros / 1e6).toFixed(2)} to $${usd.toFixed(2)} for ${period.slice(0, 7)}`, payload: { scope: input.scope as never, periodStart: period, fromMicros, toMicros } }, now);
    return accepted(`Not changed yet: raising a budget needs approval. Proposal ${p.id.slice(0, 8)} was created; approve and execute it under Approvals.`, null, now, { code: "needs-approval" });
  }
  return db.transaction(async (tx) => {
    if (row) await tx.update(budgets).set({ limitMicros: toMicros, updatedAt: now }).where(eq(budgets.id, row.id));
    else
      await tx.insert(budgets).values({
        organizationId: ctx.organizationId,
        periodStart: period,
        limitMicros: toMicros,
        businessId: scope !== "organization" && "businessId" in scope ? scope.businessId : null,
        sectorId: scope !== "organization" && "sectorId" in scope ? scope.sectorId : null,
        agentId: scope !== "organization" && "agentId" in scope ? scope.agentId : null,
        provider: scope !== "organization" && "provider" in scope ? scope.provider : null,
      });
    const auditId = await audit(tx, ctx, "control.budget_lowered", "budget", row?.id ?? ctx.organizationId, now, { scope: scopeLabel(input.scope), from: fromMicros, to: toMicros });
    return accepted(`Budget set to $${usd.toFixed(2)} for ${period.slice(0, 7)} (lowering applies immediately).`, auditId, now);
  });
}

function scopeLabel(s: unknown): string {
  const o = (s ?? {}) as { kind?: string; id?: string };
  return o.kind === "organization" ? "organization" : `${o.kind}:${o.id}`;
}

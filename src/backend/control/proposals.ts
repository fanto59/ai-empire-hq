import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ACTION_KIND_LABELS, EXTERNAL_ACTION_KINDS, INTERNAL_ACTION_KINDS, type ActionKind, type ControlResult } from "@/domain/control";
import type { Db, Executor } from "@/infrastructure/db/client";
import { actionProposals, agentPermissions, agents, budgets, orgControls } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import type { ApiScope, RequestContext } from "../auth/context";
import { budgetScopeFilter, type BudgetScope } from "../budgets/spend-guard";
import { ServiceError } from "../errors";
import { accepted, assertPerson } from "./common";

/**
 * APPROVAL TOKENS TIED TO EXACT PROPOSED ACTIONS
 *
 *   propose  → stores the exact action (payload) + its canonical SHA-256 hash
 *   approve  → a PERSON (approvals:decide) issues a single-use token that
 *              expires in 15 minutes; only its hash is stored
 *   execute  → needs the token AND the identical payload (same hash), the
 *              action's own permission, an unexpired token, and a proposal
 *              that was not executed before. Then the executor runs and the
 *              proposal becomes `executed` in the same transaction.
 *
 * External-effect actions (financial transfers, binding commitments,
 * external messages, public publishing, production deployments) have NO
 * executor: no integration is connected, so even an approved one does
 * nothing. Any future integration must execute through `executeProposal`.
 */
export const PROPOSAL_TTL_MS = 72 * 3_600_000;
export const TOKEN_TTL_MS = 15 * 60_000;
const ALL_KINDS: readonly string[] = [...EXTERNAL_ACTION_KINDS, ...INTERNAL_ACTION_KINDS];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^apv_[A-Za-z0-9_-]{43}$/;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Deterministic JSON (sorted keys) so the same action always has the same hash. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export const hashPayload = (payload: unknown) => createHash("sha256").update(canonicalJson(payload)).digest("hex");
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

function validatePayload(v: unknown, depth = 0): Json {
  if (depth > 4) throw new ServiceError("invalid-input", "The action details are nested too deeply.");
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ServiceError("invalid-input", "Numbers in the action must be finite.");
    return v;
  }
  if (typeof v === "string") {
    if (v.length > 1000) throw new ServiceError("invalid-input", "Text in the action is too long (max 1,000 characters).");
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length > 20) throw new ServiceError("invalid-input", "Too many items in the action.");
    return v.map((x) => validatePayload(x, depth + 1));
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as object);
    if (keys.length > 20) throw new ServiceError("invalid-input", "Too many fields in the action.");
    return Object.fromEntries(keys.map((k) => [k.slice(0, 64), validatePayload((v as Record<string, unknown>)[k], depth + 1)]));
  }
  throw new ServiceError("invalid-input", "The action details must be plain JSON.");
}

/** Who may execute an approved proposal of this kind. */
const EXECUTE_SCOPE: Record<ActionKind, ApiScope> = {
  budget_increase: "budgets:admin",
  resume_new_work: "emergency:operate",
  financial_transfer: "approvals:decide",
  binding_commitment: "approvals:decide",
  external_message: "approvals:decide",
  public_publish: "approvals:decide",
  production_deploy: "approvals:decide",
};

// ---- propose ---------------------------------------------------------------------------------

export async function proposeAction(
  db: Db,
  ctx: RequestContext,
  input: { kind: unknown; summary: unknown; payload: unknown },
  now = new Date(),
): Promise<typeof actionProposals.$inferSelect> {
  if (typeof input.kind !== "string" || !ALL_KINDS.includes(input.kind)) throw new ServiceError("invalid-input", "Unknown action kind.");
  const kind = input.kind as ActionKind;
  const summary = typeof input.summary === "string" ? input.summary.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (summary.length < 5) throw new ServiceError("invalid-input", "Describe the proposed action (at least 5 characters).");
  const payload = validatePayload(input.payload);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new ServiceError("invalid-input", "The action details must be an object.");
  if (ctx.principal.kind === "agent") {
    // Agents may PROPOSE (never approve or execute), if they hold approval.request.
    const [ok] = ctx.principal.agentId
      ? await db
          .select({ id: agentPermissions.id })
          .from(agentPermissions)
          .innerJoin(agents, eq(agents.id, agentPermissions.agentId))
          .where(and(eq(agentPermissions.agentId, ctx.principal.agentId), eq(agentPermissions.permission, "approval.request"), eq(agents.status, "active")))
      : [];
    if (!ok) throw new ServiceError("forbidden", "This agent may not propose actions.", "unauthorized");
  } else if (ctx.principal.kind !== "user") {
    throw new ServiceError("forbidden", "Only people and agents can propose actions.", "unauthorized");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(actionProposals)
      .values({
        organizationId: ctx.organizationId,
        kind,
        summary,
        payload,
        payloadHash: hashPayload(payload),
        proposedByKind: ctx.principal.kind,
        proposedBy: ctx.principal.agentId ?? ctx.principal.id,
        expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
        createdAt: now,
      })
      .returning();
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      businessId: null,
      actor: { kind: ctx.principal.kind, id: ctx.principal.agentId ?? ctx.principal.id },
      action: "proposal.created",
      targetType: "proposal",
      targetId: row!.id,
      metadata: { kind, payloadHash: row!.payloadHash },
      at: now,
    });
    return row!;
  });
}

async function lockProposal(tx: Executor, ctx: RequestContext, proposalId: unknown) {
  if (typeof proposalId !== "string" || !UUID.test(proposalId)) throw new ServiceError("not-found", "Proposal not found.");
  const [p] = await tx.select().from(actionProposals).where(and(eq(actionProposals.id, proposalId), eq(actionProposals.organizationId, ctx.organizationId))).for("update");
  if (!p) throw new ServiceError("not-found", "Proposal not found.");
  return p;
}

// ---- approve / reject --------------------------------------------------------------------------

/** A person approves; returns a single-use token (shown once) bound to the exact payload. */
export async function approveProposal(db: Db, ctx: RequestContext, proposalId: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "approvals:decide");
  const token = `apv_${randomBytes(32).toString("base64url")}`;
  return db.transaction(async (tx) => {
    const p = await lockProposal(tx, ctx, proposalId);
    if (p.status !== "pending") throw new ServiceError("conflict", `This proposal is already ${p.status}.`, p.status === "approved" ? "duplicate" : p.status);
    if (p.expiresAt <= now) {
      await tx.update(actionProposals).set({ status: "expired" }).where(eq(actionProposals.id, p.id));
      const auditId = await writeAudit(tx, { organizationId: ctx.organizationId, businessId: null, actor: { kind: "user", id: ctx.principal.id }, action: "proposal.expired", targetType: "proposal", targetId: p.id, at: now });
      return { accepted: false, message: "This proposal expired before it was approved. Propose it again.", auditId, at: now.toISOString(), code: "expired" };
    }
    const tokenExpiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
    await tx.update(actionProposals).set({ status: "approved", decidedBy: ctx.principal.id, decidedAt: now, tokenHash: hashToken(token), tokenExpiresAt }).where(eq(actionProposals.id, p.id));
    const auditId = await writeAudit(tx, {
      organizationId: ctx.organizationId,
      businessId: null,
      actor: { kind: "user", id: ctx.principal.id },
      action: "proposal.approved",
      targetType: "proposal",
      targetId: p.id,
      metadata: { kind: p.kind, payloadHash: p.payloadHash, tokenExpiresAt: tokenExpiresAt.toISOString() },
      at: now,
    });
    return accepted(`Approved. The approval token is valid for this exact action until ${tokenExpiresAt.toISOString().slice(11, 16)} UTC and can be used once.`, auditId, now, {
      approvalToken: token,
      tokenExpiresAt: tokenExpiresAt.toISOString(),
    });
  });
}

export async function rejectProposal(db: Db, ctx: RequestContext, proposalId: unknown, now = new Date()): Promise<ControlResult> {
  assertPerson(ctx, "approvals:decide");
  return db.transaction(async (tx) => {
    const p = await lockProposal(tx, ctx, proposalId);
    if (p.status !== "pending" && p.status !== "approved") throw new ServiceError("conflict", `This proposal is already ${p.status}.`, p.status);
    await tx.update(actionProposals).set({ status: "rejected", decidedBy: ctx.principal.id, decidedAt: now, tokenHash: null, tokenExpiresAt: null }).where(eq(actionProposals.id, p.id));
    const auditId = await writeAudit(tx, { organizationId: ctx.organizationId, businessId: null, actor: { kind: "user", id: ctx.principal.id }, action: "proposal.rejected", targetType: "proposal", targetId: p.id, metadata: { kind: p.kind }, at: now });
    return accepted("Rejected. Nothing will be done.", auditId, now);
  });
}

// ---- execute --------------------------------------------------------------------------------------

type Executor_ = (tx: Executor, ctx: RequestContext, payload: Record<string, Json>, now: Date) => Promise<string>;

const SCOPE_KINDS = ["organization", "sector", "business", "agent", "provider"] as const;
export function budgetScopeFromPayload(s: unknown): BudgetScope {
  const o = (s ?? {}) as { kind?: unknown; id?: unknown };
  if (!SCOPE_KINDS.includes(o.kind as (typeof SCOPE_KINDS)[number])) throw new ServiceError("invalid-input", "Unknown budget scope.");
  if (o.kind === "organization") return "organization";
  if (typeof o.id !== "string" || !o.id) throw new ServiceError("invalid-input", "The budget scope needs an id.");
  if (o.kind === "provider") {
    if (!["anthropic", "openai", "xai"].includes(o.id)) throw new ServiceError("invalid-input", "Unknown provider.");
    return { provider: o.id };
  }
  if (!UUID.test(o.id)) throw new ServiceError("invalid-input", "Invalid budget scope id.");
  return o.kind === "sector" ? { sectorId: o.id } : o.kind === "business" ? { businessId: o.id } : { agentId: o.id };
}

const EXECUTORS: Partial<Record<ActionKind, Executor_>> = {
  /** Raises a budget limit - only if it still has the value the approver saw. */
  budget_increase: async (tx, ctx, payload, now) => {
    const scope = budgetScopeFromPayload(payload.scope);
    const period = String(payload.periodStart ?? "");
    const from = Number(payload.fromMicros);
    const to = Number(payload.toMicros);
    if (!/^\d{4}-\d{2}-01$/.test(period) || !Number.isInteger(from) || !Number.isInteger(to) || to <= from || to > 1_000_000_000) {
      throw new ServiceError("invalid-input", "Invalid budget increase.");
    }
    const [row] = await tx.select().from(budgets).where(budgetScopeFilter(ctx.organizationId, scope, period)).for("update");
    const current = row?.limitMicros ?? 0;
    if (current !== from) throw new ServiceError("conflict", "The budget changed after this increase was proposed; propose it again.", "stale");
    if (row) await tx.update(budgets).set({ limitMicros: to, updatedAt: now }).where(eq(budgets.id, row.id));
    else
      await tx.insert(budgets).values({
        organizationId: ctx.organizationId,
        periodStart: period,
        limitMicros: to,
        businessId: scope !== "organization" && "businessId" in scope ? scope.businessId : null,
        sectorId: scope !== "organization" && "sectorId" in scope ? scope.sectorId : null,
        agentId: scope !== "organization" && "agentId" in scope ? scope.agentId : null,
        provider: scope !== "organization" && "provider" in scope ? scope.provider : null,
      });
    return `Budget raised from $${(from / 1e6).toFixed(2)} to $${(to / 1e6).toFixed(2)}.`;
  },
  /** Lifts the emergency suspension. */
  resume_new_work: async (tx, ctx, _payload, now) => {
    await tx
      .insert(orgControls)
      .values({ organizationId: ctx.organizationId, newWorkSuspended: false, reason: null, changedBy: ctx.principal.id, changedAt: now })
      .onConflictDoUpdate({ target: orgControls.organizationId, set: { newWorkSuspended: false, reason: null, changedBy: ctx.principal.id, changedAt: now } });
    return "New work is allowed again.";
  },
};

export async function executeProposal(db: Db, ctx: RequestContext, input: { proposalId: unknown; token: unknown; payload: unknown }, now = new Date()): Promise<ControlResult> {
  if (ctx.principal.kind !== "user") throw new ServiceError("forbidden", "Only people can execute approved actions.", "unauthorized");
  return db.transaction(async (tx) => {
    const p = await lockProposal(tx, ctx, input.proposalId);
    assertPerson(ctx, EXECUTE_SCOPE[p.kind as ActionKind] ?? "approvals:decide");
    const audit = async (action: string, metadata: Record<string, string | number | boolean | null> = {}) =>
      writeAudit(tx, { organizationId: ctx.organizationId, businessId: null, actor: { kind: "user", id: ctx.principal.id }, action, targetType: "proposal", targetId: p.id, metadata: { kind: p.kind, ...metadata }, at: now });

    if (p.status === "executed") throw new ServiceError("conflict", "This action was already executed; approval tokens work once.", "duplicate");
    if (p.status !== "approved") throw new ServiceError("conflict", p.status === "pending" ? "This action has not been approved yet." : `This proposal is ${p.status}.`, p.status === "pending" ? "not-approved" : p.status);
    if (!p.tokenExpiresAt || p.tokenExpiresAt <= now) {
      // Expired approvals are recorded (committed), not just refused.
      await tx.update(actionProposals).set({ status: "expired", tokenHash: null }).where(eq(actionProposals.id, p.id));
      const auditId = await audit("proposal.token_expired");
      return { accepted: false, message: "The approval expired. Propose and approve the action again.", auditId, at: now.toISOString(), code: "expired" };
    }
    const token = typeof input.token === "string" ? input.token.trim() : "";
    const a = Buffer.from(TOKEN.test(token) ? hashToken(token) : "x".repeat(64));
    const b = Buffer.from(p.tokenHash ?? "y".repeat(64));
    if (!TOKEN.test(token) || a.length !== b.length || !timingSafeEqual(a, b)) {
      const auditId = await audit("proposal.execute_refused", { reason: "invalid-token" });
      return { accepted: false, message: "The approval token is not valid for this action.", auditId, at: now.toISOString(), code: "invalid-token" };
    }
    let payload: Json;
    try {
      payload = validatePayload(input.payload);
    } catch {
      payload = null;
    }
    if (hashPayload(payload) !== p.payloadHash) {
      const auditId = await audit("proposal.execute_refused", { reason: "payload-mismatch" });
      return { accepted: false, message: "This is not the exact action that was approved; nothing was done.", auditId, at: now.toISOString(), code: "payload-mismatch" };
    }
    const executor = EXECUTORS[p.kind as ActionKind];
    if (!executor) {
      const auditId = await audit("proposal.execute_refused", { reason: "no-integration" });
      return {
        accepted: false,
        message: `${ACTION_KIND_LABELS[p.kind as ActionKind] ?? p.kind}: approved, but no integration is connected, so nothing was sent, paid, signed, published or deployed.`,
        auditId,
        at: now.toISOString(),
        code: "no-integration",
      };
    }
    const result = await executor(tx, ctx, payload as Record<string, Json>, now);
    await tx.update(actionProposals).set({ status: "executed", executedBy: ctx.principal.id, executedAt: now, result: result.slice(0, 500), tokenHash: null }).where(eq(actionProposals.id, p.id));
    const auditId = await audit("proposal.executed", { payloadHash: p.payloadHash });
    return accepted(result, auditId, now);
  });
}

/** Pending and approved proposals (newest first), with stale pending ones shown as expired. */
export async function listOpenProposals(db: Db, organizationId: string, now = new Date()) {
  const rows = await db
    .select()
    .from(actionProposals)
    .where(and(eq(actionProposals.organizationId, organizationId), inArray(actionProposals.status, ["pending", "approved", "executed", "rejected", "expired"])))
    .orderBy(desc(actionProposals.createdAt))
    .limit(30);
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind as ActionKind,
    summary: p.summary,
    payload: p.payload as Record<string, Json>,
    payloadHash: p.payloadHash,
    status: p.status === "pending" && p.expiresAt <= now ? ("expired" as const) : p.status === "approved" && p.tokenExpiresAt && p.tokenExpiresAt <= now ? ("expired" as const) : p.status,
    proposedBy: `${p.proposedByKind}:${p.proposedBy}`,
    createdAt: p.createdAt.toISOString(),
    tokenExpiresAt: p.tokenExpiresAt?.toISOString() ?? null,
    executable: Boolean(EXECUTORS[p.kind as ActionKind]),
    result: p.result,
  }));
}

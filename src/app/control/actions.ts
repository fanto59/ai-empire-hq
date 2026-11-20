"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/backend/auth/session";
import { withIdempotency } from "@/backend/control/common";
import {
  assignFromControl,
  cancelAgentWork,
  cancelTask,
  decideTaskApproval,
  pauseAgent,
  requestResumeNewWork,
  resumeAgent,
  setBudgetLimit,
  setProjectStatus,
  suspendNewWork,
} from "@/backend/control/operations";
import { approveProposal, executeProposal, proposeAction, rejectProposal } from "@/backend/control/proposals";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import type { ControlResult } from "@/domain/control";

/**
 * The control center's single Server Action. Every operation:
 * re-authenticates the session on the server, runs through the idempotency
 * guard (request key from the form), applies with an audit entry, and returns
 * the server's verdict. The page then re-renders from the database.
 */
export async function controlAction(_prev: ControlResult | null, form: FormData): Promise<ControlResult> {
  const now = new Date();
  const db = await getDatabase();
  if (!db) return { accepted: false, message: "The database is not set up.", auditId: null, at: now.toISOString(), code: "unavailable" };
  const ctx = await getSessionContext(db);
  if (!ctx) return { accepted: false, message: "Not signed in (or the session expired). Sign in again.", auditId: null, at: now.toISOString(), code: "unauthorized" };

  const f = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const op = f("op") ?? "";
  const json = (k: string) => {
    try {
      return JSON.parse(f(k) ?? "null") as unknown;
    } catch {
      throw new ServiceError("invalid-input", "The action details are not valid JSON.");
    }
  };

  const result = await withIdempotency(db, ctx, f("requestKey"), op, async () => {
    switch (op) {
      case "suspend":
        return suspendNewWork(db, ctx, f("reason"));
      case "request-resume":
        return requestResumeNewWork(db, ctx);
      case "pause-agent":
        return pauseAgent(db, ctx, f("agentId"), f("reason"));
      case "resume-agent":
        return resumeAgent(db, ctx, f("agentId"));
      case "cancel-agent-work":
        return cancelAgentWork(db, ctx, f("agentId"), f("reason"));
      case "cancel-task":
        return cancelTask(db, ctx, f("taskId"), f("reason"));
      case "assign":
        return assignFromControl(db, ctx, { agentId: f("agentId"), instructions: f("instructions"), title: f("title"), businessId: f("businessId") }, `${f("requestKey")}-task`);
      case "project-status":
        return setProjectStatus(db, ctx, f("projectId"), f("status"));
      case "task-approval":
        return decideTaskApproval(db, ctx, f("approvalId"), f("decision"));
      case "set-budget":
        return setBudgetLimit(db, ctx, { scope: { kind: f("scopeKind"), id: f("scopeId") || undefined }, usd: f("usd") });
      case "propose": {
        const p = await proposeAction(db, ctx, { kind: f("kind"), summary: f("summary"), payload: json("payload") });
        return { accepted: true, message: `Proposal ${p.id.slice(0, 8)} recorded. It needs approval before anything can happen.`, auditId: null, at: new Date().toISOString(), code: "needs-approval" };
      }
      case "approve":
        return approveProposal(db, ctx, f("proposalId"));
      case "reject":
        return rejectProposal(db, ctx, f("proposalId"));
      case "execute":
        return executeProposal(db, ctx, { proposalId: f("proposalId"), token: f("token"), payload: json("payload") });
      default:
        throw new ServiceError("invalid-input", "Unknown control action.");
    }
  });
  if (result.accepted) revalidatePath("/control");
  return result;
}

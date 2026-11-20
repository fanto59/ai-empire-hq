import { and, eq } from "drizzle-orm";
import type { ControlResult } from "@/domain/control";
import type { Db, Executor } from "@/infrastructure/db/client";
import { controlRequests, orgControls } from "@/infrastructure/db/schema";
import type { ApiScope, RequestContext } from "../auth/context";
import { ServiceError } from "../errors";

/**
 * CONTROL CENTER - shared rules.
 *
 * - Server-side authorization on every action: a PERSON (never an agent
 *   token) holding the action's scope, with organization-wide access.
 * - Every applied action writes an audit entry; its id is returned.
 * - Idempotency: each request carries a key; a repeated key returns the
 *   first response marked `duplicate` and applies nothing again.
 * - Results are explicit (`accepted` true/false) so the UI can show exactly
 *   what the server did.
 */
export function assertPerson(ctx: RequestContext, scope: ApiScope): void {
  if (ctx.principal.kind !== "user") throw new ServiceError("forbidden", "Only people can use the control center.", "unauthorized");
  if (!ctx.scopes.has(scope)) throw new ServiceError("forbidden", `This needs the ${scope} permission.`, "unauthorized");
  if (ctx.businesses !== "*" || !ctx.hq) throw new ServiceError("forbidden", "This needs organization-wide access.", "unauthorized");
}

export function accepted(message: string, auditId: number | null, at: Date, extra: Partial<ControlResult> = {}): ControlResult {
  return { accepted: true, message, auditId, at: at.toISOString(), ...extra };
}

export function refused(e: unknown, at: Date): ControlResult {
  if (e instanceof ServiceError) return { accepted: false, message: e.message, auditId: null, at: at.toISOString(), code: e.reason ?? e.code };
  console.error("[control] unexpected error:", e instanceof Error ? e.message : e);
  return { accepted: false, message: "The server could not complete this action.", auditId: null, at: at.toISOString(), code: "internal" };
}

const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Runs a control action once per idempotency key. The response (accepted or
 * refused) is stored; a repeat returns it with `duplicate: true`.
 */
export async function withIdempotency(
  db: Db,
  ctx: RequestContext,
  key: string | undefined,
  action: string,
  fn: () => Promise<ControlResult>,
  now: () => Date = () => new Date(),
): Promise<ControlResult> {
  if (!key || !KEY.test(key)) return refused(new ServiceError("invalid-input", "Missing or invalid request key; reload the page and try again.", "invalid-key"), now());
  const [seen] = await db.select().from(controlRequests).where(and(eq(controlRequests.organizationId, ctx.organizationId), eq(controlRequests.idempotencyKey, key)));
  if (seen) {
    const first = seen.response as ControlResult;
    return { ...first, duplicate: true, approvalToken: undefined, message: `Already handled: ${first.message}` };
  }
  let result: ControlResult;
  try {
    result = await fn();
  } catch (e) {
    result = refused(e, now());
  }
  // Store without the one-time token (it is never persisted in plain text).
  const { approvalToken: _t, ...stored } = result;
  void _t;
  try {
    await db.insert(controlRequests).values({ organizationId: ctx.organizationId, idempotencyKey: key, action, actorId: ctx.principal.id, response: stored });
  } catch {
    // A concurrent duplicate stored first: return that response instead.
    const [other] = await db.select().from(controlRequests).where(and(eq(controlRequests.organizationId, ctx.organizationId), eq(controlRequests.idempotencyKey, key)));
    if (other) return { ...(other.response as ControlResult), duplicate: true };
  }
  return result;
}

/** Emergency stop status. Missing row = not suspended. */
export async function isNewWorkSuspended(db: Executor, organizationId: string): Promise<boolean> {
  const [row] = await db.select({ s: orgControls.newWorkSuspended }).from(orgControls).where(eq(orgControls.organizationId, organizationId));
  return row?.s ?? false;
}

export async function getControls(db: Executor, organizationId: string) {
  const [row] = await db.select().from(orgControls).where(eq(orgControls.organizationId, organizationId));
  return {
    newWorkSuspended: row?.newWorkSuspended ?? false,
    reason: row?.reason ?? null,
    changedBy: row?.changedBy ?? null,
    changedAt: row?.changedAt?.toISOString() ?? null,
  };
}

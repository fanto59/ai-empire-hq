import { cookies } from "next/headers";
import type { Db } from "@/infrastructure/db/client";
import { ServiceError } from "../errors";
import { authenticate } from "./api-tokens";
import type { RequestContext } from "./context";

/**
 * DASHBOARD SESSION (sign in with an API token)
 *
 * Writes from the browser (e.g. creating a research task) require a signed-in
 * user. Signing in = pasting an API token created with `npm run db:token`.
 * It is validated with the same rules as the API and kept in an httpOnly,
 * SameSite=Strict cookie (never readable by page scripts). Server Actions
 * also get Next.js's built-in Origin check. Expired or revoked tokens stop
 * working immediately because every request re-validates them.
 */
export const SESSION_COOKIE = "aehq_session";
const MAX_AGE_SECONDS = 8 * 60 * 60;

export async function getSessionContext(db: Db): Promise<RequestContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const ctx = await authenticate(db, `Bearer ${token}`);
    return ctx.principal.kind === "user" ? ctx : null;
  } catch {
    return null;
  }
}

export async function signIn(db: Db, token: string): Promise<RequestContext> {
  const ctx = await authenticate(db, `Bearer ${token.trim()}`);
  if (ctx.principal.kind !== "user") throw new ServiceError("forbidden", "Agent tokens cannot sign in to the dashboard.");
  if (!ctx.scopes.has("tasks:write")) throw new ServiceError("forbidden", "This token cannot create tasks (needs the tasks:write scope).");
  (await cookies()).set(SESSION_COOKIE, token.trim(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return ctx;
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

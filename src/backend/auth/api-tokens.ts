import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agents, apiTokens, businesses } from "@/infrastructure/db/schema";
import { ServiceError } from "../errors";
import { agentAccess } from "../org/rules";
import { API_SCOPES, type ApiScope, type RequestContext } from "./context";

/**
 * API TOKEN AUTHENTICATION
 *
 * Tokens look like `aehq_<43 base64url chars>` (256 bits of randomness).
 * Only their SHA-256 hash is stored, so a database leak does not leak
 * usable tokens. Revoked, expired, unknown and malformed tokens all get the
 * same 401 response (no oracle). Agent tokens are confined to the agent's
 * own business and can never decide approvals.
 */
const TOKEN_FORMAT = /^aehq_[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateTokenInput {
  organizationId: string;
  name: string;
  principalKind: "user" | "agent";
  agentId?: string;
  scopes: ApiScope[];
  businessIds?: string[] | null;
  hqAccess?: boolean;
  expiresAt?: Date | null;
}

/** Creates a token. The plaintext is returned ONCE and never stored. */
export async function createApiToken(db: Db, input: CreateTokenInput): Promise<{ token: string; id: string }> {
  for (const s of input.scopes) if (!API_SCOPES.includes(s)) throw new ServiceError("invalid-input", `Unknown scope ${s}.`);
  if (input.principalKind === "agent" && !input.agentId) throw new ServiceError("invalid-input", "Agent tokens need an agentId.");
  const token = `aehq_${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(apiTokens)
    .values({
      organizationId: input.organizationId,
      name: input.name.slice(0, 100),
      tokenHash: hashToken(token),
      principalKind: input.principalKind,
      agentId: input.agentId ?? null,
      scopes: input.scopes,
      businessIds: input.businessIds ?? null,
      hqAccess: input.hqAccess ?? false,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: apiTokens.id });
  return { token, id: row!.id };
}

const UNAUTHENTICATED = () => new ServiceError("unauthenticated", "A valid API token is required (Authorization: Bearer <token>).");

export async function authenticate(db: Db, authorization: string | null, now = new Date()): Promise<RequestContext> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  const token = match?.[1];
  if (!token || !TOKEN_FORMAT.test(token)) throw UNAUTHENTICATED();

  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(token)));
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) throw UNAUTHENTICATED();

  const scopes = new Set(row.scopes.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s)));
  let ctx: RequestContext;
  if (row.principalKind === "agent") {
    const [agent] = row.agentId ? await db.select().from(agents).where(eq(agents.id, row.agentId)) : [];
    if (!agent || agent.status !== "active" || agent.organizationId !== row.organizationId) throw UNAUTHENTICATED();
    scopes.delete("approvals:decide");
    scopes.delete("models:admin"); // agents can never change model assignments
    scopes.delete("businesses:admin"); // nor add or archive businesses
    // Business agents: their business. Sector agents: their sector's businesses. HQ agents: headquarters.
    const sectorBusinesses = agent.sectorId
      ? (await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.sectorId, agent.sectorId))).map((b) => b.id)
      : [];
    const access = agentAccess(agent, sectorBusinesses);
    ctx = {
      organizationId: row.organizationId,
      principal: { kind: "agent", id: `token:${row.id}`, agentId: agent.id },
      businesses: access.businesses,
      hq: access.hq,
      scopes,
    };
  } else {
    ctx = {
      organizationId: row.organizationId,
      principal: { kind: "user", id: `token:${row.id}`, agentId: null },
      businesses: row.businessIds ?? "*",
      hq: row.hqAccess,
      scopes,
    };
  }
  // Best effort; never blocks the request.
  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id)).catch(() => undefined);
  return ctx;
}

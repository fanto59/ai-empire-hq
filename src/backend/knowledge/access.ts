import { KnowledgeError } from "./errors";

/**
 * BUSINESS-SPECIFIC ACCESS CONTROL
 *
 * Every service call takes an access context. Decisions are made from the
 * note's PATH (its scope) before the file system is touched, so a denied
 * caller cannot even learn whether a note exists.
 *
 * Rules:
 * - A business note is readable/writable only if the business is in
 *   `businesses` (or `businesses` is "*").
 * - A headquarters note (business = null) requires `hq: true`.
 * - Writes additionally require `write: true`.
 * - "restricted" notes are readable only by user principals (never by
 *   agents), even inside an allowed business.
 *
 * Until authentication exists, the only context the app constructs is the
 * owner's (see `ownerContext`). Agent contexts are built per agent from its
 * AgentProfile.businessId once agents run.
 */
export interface KnowledgePrincipal {
  kind: "user" | "agent" | "system";
  id: string;
}

export interface KnowledgeAccessContext {
  principal: KnowledgePrincipal;
  hq: boolean;
  businesses: "*" | readonly string[];
  write: boolean;
}

export function ownerContext(): KnowledgeAccessContext {
  return { principal: { kind: "user", id: "owner" }, hq: true, businesses: "*", write: true };
}

/** An agent confined to one business (the default shape for sector agents). */
export function businessAgentContext(agentId: string, business: string, write = true): KnowledgeAccessContext {
  return { principal: { kind: "agent", id: agentId }, hq: false, businesses: [business], write };
}

export function canAccessScope(ctx: KnowledgeAccessContext, business: string | null): boolean {
  if (business === null) return ctx.hq;
  return ctx.businesses === "*" || ctx.businesses.includes(business);
}

export function assertCanRead(ctx: KnowledgeAccessContext, business: string | null): void {
  if (!canAccessScope(ctx, business)) {
    throw new KnowledgeError(
      "access-denied",
      business === null
        ? "This principal cannot access headquarters knowledge."
        : `This principal cannot access knowledge for business "${business}".`,
    );
  }
}

export function assertCanWrite(ctx: KnowledgeAccessContext, business: string | null): void {
  assertCanRead(ctx, business);
  if (!ctx.write) throw new KnowledgeError("access-denied", "This principal has read-only knowledge access.");
}

export function canReadConfidentiality(ctx: KnowledgeAccessContext, confidentiality: "internal" | "restricted"): boolean {
  return confidentiality === "internal" || ctx.principal.kind === "user";
}

/**
 * Request context: WHO is calling and WHAT they may touch. Built from an API
 * token (src/backend/auth/api-tokens.ts) or, for server-rendered pages, from
 * the owner's context until interactive login exists.
 */
export const API_SCOPES = ["tasks:read", "tasks:write", "tasks:transition", "approvals:decide", "models:admin"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface RequestContext {
  organizationId: string;
  principal: { kind: "user" | "agent" | "system"; id: string; agentId: string | null };
  /** Businesses this caller may access; "*" = all. */
  businesses: "*" | readonly string[];
  /** Access to headquarters-level records (business_id IS NULL). */
  hq: boolean;
  scopes: ReadonlySet<ApiScope>;
}

export function canAccessBusiness(ctx: RequestContext, businessId: string | null): boolean {
  if (businessId === null) return ctx.hq;
  return ctx.businesses === "*" || ctx.businesses.includes(businessId);
}

/** Full-access context for trusted server code (seeding, the owner's dashboard). */
export function ownerRequestContext(organizationId: string): RequestContext {
  return {
    organizationId,
    principal: { kind: "user", id: "owner", agentId: null },
    businesses: "*",
    hq: true,
    scopes: new Set(API_SCOPES),
  };
}

import { eq } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agents, businesses } from "@/infrastructure/db/schema";
import type { KnowledgeAccessContext } from "../knowledge/access";
import { agentAccess } from "./rules";

/**
 * Knowledge access for an agent, from its scope:
 * - business agent → its own business's notes only (businesses stay distinct);
 * - sector agent   → the notes of every business in its sector;
 * - headquarters   → headquarters notes (the Chief reads business records
 *   through its own read-only tools, never by widening this context).
 * Restricted notes stay person-only regardless (see knowledge/access.ts).
 */
export async function agentKnowledgeContext(db: Db, agentId: string, opts: { write?: boolean } = {}): Promise<KnowledgeAccessContext> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) throw new Error("Agent not found.");
  const bizRows = await db.select({ id: businesses.id, slug: businesses.slug, sectorId: businesses.sectorId }).from(businesses).where(eq(businesses.organizationId, agent.organizationId));
  const access = agentAccess(agent, bizRows.filter((b) => agent.sectorId !== null && b.sectorId === agent.sectorId).map((b) => b.id));
  return {
    principal: { kind: "agent", id: agent.slug },
    hq: access.hq,
    businesses: bizRows.filter((b) => access.businesses.includes(b.id)).map((b) => b.slug),
    write: opts.write ?? false,
  };
}

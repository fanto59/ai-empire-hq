/**
 * ORGANIZATION RULES (pure; no database) - business-level access, sector
 * scope, and cross-sector project/assignment rules. Used by the task engine,
 * TaskService, auth and knowledge contexts, so every path applies the same
 * rules.
 *
 * Levels:
 *   headquarters  agent.businessId = null, agent.sectorId = null  (Chief AI Manager, Central PM)
 *   sector        agent.sectorId set                               (sector manager / sector specialists)
 *   business      agent.businessId set                             (business leads / specialists)
 *
 * Businesses stay distinct: a business agent only ever works on, and reads,
 * its own business. A sector agent spans the businesses of its own sector.
 * Headquarters oversees everything: the Chief reads organization records
 * (org.read), and the Central PM may be assigned work in any business to
 * coordinate cross-sector projects.
 */
export interface AgentScope {
  role: string;
  businessId: string | null;
  sectorId: string | null;
}

export interface BusinessScope {
  id: string;
  sectorId: string | null;
  status: string;
}

export interface ProjectScope {
  businessId: string | null;
  sectorId: string | null;
}

export type RuleResult = { ok: true } | { ok: false; code: string; message: string };
const ok: RuleResult = { ok: true };
const no = (code: string, message: string): RuleResult => ({ ok: false, code, message });

export type AgentLevel = "hq" | "sector" | "business";

export function agentLevel(a: AgentScope): AgentLevel {
  if (a.businessId) return "business";
  if (a.sectorId) return "sector";
  return "hq";
}

/** May this agent be assigned a task that belongs to `business` (null = a headquarters task)? */
export function canAssignAgent(agent: AgentScope, business: BusinessScope | null): RuleResult {
  if (business?.status === "archived") return no("business-archived", "This business is archived; it takes no new work.");
  const level = agentLevel(agent);
  if (business === null) {
    return level === "hq" ? ok : no("business-mismatch", "Headquarters tasks can only be assigned to headquarters agents.");
  }
  if (level === "business") {
    return agent.businessId === business.id ? ok : no("business-mismatch", "Business agents only work on their own business; businesses stay distinct.");
  }
  if (level === "sector") {
    return agent.sectorId !== null && agent.sectorId === business.sectorId ? ok : no("sector-mismatch", "Sector agents only work on businesses in their own sector.");
  }
  // Headquarters: only the Central Project Manager coordinates work inside businesses.
  return agent.role === "central-project-manager" ? ok : no("business-mismatch", "Only the Central Project Manager can take business tasks from headquarters.");
}

/** May a task of `business` (null = headquarters) belong to `project`? */
export function canTaskJoinProject(project: ProjectScope, business: BusinessScope | null): RuleResult {
  if (project.businessId) {
    return business?.id === project.businessId ? ok : no("project-scope", "This project belongs to one business; only that business's tasks can join it.");
  }
  if (project.sectorId) {
    return business !== null && business.sectorId === project.sectorId ? ok : no("project-scope", "This sector project only takes tasks from businesses in its sector.");
  }
  return ok; // headquarters project: cross-sector by design
}

/** Who may own (lead) a project of this scope. */
export function canOwnProject(agent: AgentScope, project: ProjectScope, projectBusiness: BusinessScope | null): RuleResult {
  if (project.businessId) return canAssignAgent(agent, projectBusiness);
  if (project.sectorId) {
    const level = agentLevel(agent);
    if (level === "sector" && agent.sectorId === project.sectorId) return ok;
    if (level === "hq") return ok;
    return no("sector-mismatch", "A sector project is led by that sector's agents or by headquarters.");
  }
  return agentLevel(agent) === "hq" ? ok : no("business-mismatch", "Cross-sector projects are led by headquarters agents.");
}

/** Records/knowledge an agent may access: its business, its sector's businesses, or headquarters. */
export function agentAccess(agent: AgentScope, sectorBusinessIds: readonly string[]): { hq: boolean; businesses: string[] } {
  switch (agentLevel(agent)) {
    case "business":
      return { hq: false, businesses: [agent.businessId!] };
    case "sector":
      return { hq: false, businesses: [...sectorBusinessIds] };
    case "hq":
      return { hq: true, businesses: [] };
  }
}

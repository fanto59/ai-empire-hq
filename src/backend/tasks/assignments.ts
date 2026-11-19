import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, businesses, tasks } from "@/infrastructure/db/schema";
import type { RequestContext } from "../auth/context";
import { ServiceError, assertUuid } from "../errors";
import { createExecutiveTask } from "./executive";
import { createResearchTask } from "./research";
import { TaskService } from "./service";

/**
 * OWNER ASSIGNMENTS - give any agent a piece of work from the dashboard.
 *
 * What happens depends on what the agent can actually do:
 * - Chief AI Manager (org.read)          → executive objective; the Chief worker plans it.
 * - Agent with research.web_search        → research task; the Research worker runs it.
 * - Any other agent (needs task.execute)  → a tracked task assigned to it. No
 *   worker executes these agents yet, so the UI labels them "tracked only".
 * Only signed-in people (user principals with tasks:write) can assign work.
 */
export type AgentCapability = "plans-objectives" | "runs-research" | "tracked-only";

export interface AssignableAgent {
  id: string;
  slug: string;
  displayName: string;
  role: string;
  businessId: string | null;
  businessName: string | null;
  capability: AgentCapability;
  openTasks: number;
}

export async function listAssignableAgents(db: Db, organizationId: string): Promise<AssignableAgent[]> {
  const rows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      displayName: agents.displayName,
      role: agents.role,
      businessId: agents.businessId,
      businessName: businesses.name,
    })
    .from(agents)
    .leftJoin(businesses, eq(businesses.id, agents.businessId))
    .where(and(eq(agents.organizationId, organizationId), eq(agents.status, "active")));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [perms, open] = await Promise.all([
    db.select({ agentId: agentPermissions.agentId, p: agentPermissions.permission }).from(agentPermissions).where(inArray(agentPermissions.agentId, ids)),
    db
      .select({ agentId: tasks.assigneeAgentId, state: tasks.state })
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), inArray(tasks.state, ["assigned", "running", "waiting", "paused"]))),
  ]);
  return rows
    .map((r) => {
      const mine = new Set(perms.filter((p) => p.agentId === r.id).map((p) => p.p));
      const capability: AgentCapability =
        r.role === "chief-ai-manager" && mine.has("org.read") ? "plans-objectives" : mine.has("research.web_search") ? "runs-research" : "tracked-only";
      return { ...r, capability, openTasks: open.filter((t) => t.agentId === r.id).length };
    })
    .sort((a, b) => (a.businessId === null ? -1 : 0) - (b.businessId === null ? -1 : 0) || a.displayName.localeCompare(b.displayName));
}

export interface AssignmentInput {
  agentId: string;
  instructions: string;
  title?: string;
}

export async function assignWork(db: Db, ctx: RequestContext, input: AssignmentInput, idempotencyKey?: string) {
  if (ctx.principal.kind !== "user") throw new ServiceError("forbidden", "Only people can give agents assignments.");
  const agentId = assertUuid(input.agentId, "agentId");
  const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
  if (instructions.length < 10 || instructions.length > 4000) throw new ServiceError("invalid-input", "Assignments need 10-4,000 characters of instructions.");

  const list = await listAssignableAgents(db, ctx.organizationId);
  const agent = list.find((a) => a.id === agentId);
  if (!agent) throw new ServiceError("invalid-input", "That agent is not an active agent of this organization.");

  if (agent.capability === "plans-objectives") {
    const r = await createExecutiveTask(db, ctx, instructions, idempotencyKey);
    return { task: r.task, agent, note: `${r.note} The Chief AI Manager will propose a plan.` };
  }
  if (agent.capability === "runs-research" && agent.businessId) {
    const r = await createResearchTask(db, ctx, { businessId: agent.businessId, question: instructions, title: input.title }, idempotencyKey);
    return { task: r.task, agent, note: `${r.note} It runs automatically when the worker is on.` };
  }

  const svc = new TaskService(db);
  const title = (input.title?.trim() || instructions.replace(/\s+/g, " ").slice(0, 120)).slice(0, 200);
  const { task, created } = await svc.createTask(ctx, { title, description: instructions, businessId: agent.businessId, kind: "general" }, idempotencyKey);
  if (!created) return { task, agent, note: "Already submitted." };
  const assigned = await svc.transition(ctx, task.id, { action: "assign", agentId: agent.id, reason: "Owner assignment" });
  return {
    task: assigned,
    agent,
    note: `Assigned to ${agent.displayName}. This agent is not connected to a model yet, so the task is tracked but not run automatically.`,
  };
}

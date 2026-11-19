import { and, eq } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, businesses } from "@/infrastructure/db/schema";
import type { RequestContext } from "../auth/context";
import { ServiceError, assertUuid } from "../errors";
import { TaskService } from "./service";

/**
 * Creating a research task = create (validated, persisted) + assign it to the
 * business's active Research Agent (an agent holding research.web_search).
 * The worker then claims it. If the business has no research agent the task
 * stays queued and the dashboard says why.
 */
export interface ResearchRequest {
  businessId: string;
  question: string;
  title?: string;
}

export async function findResearchAgent(db: Db, organizationId: string, businessId: string) {
  const rows = await db
    .select({ id: agents.id, slug: agents.slug, displayName: agents.displayName, role: agents.role, modelProvider: agents.modelProvider, modelName: agents.modelName })
    .from(agents)
    .innerJoin(agentPermissions, eq(agentPermissions.agentId, agents.id))
    .where(
      and(
        eq(agents.organizationId, organizationId),
        eq(agents.businessId, businessId),
        eq(agents.status, "active"),
        eq(agentPermissions.permission, "research.web_search"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createResearchTask(db: Db, ctx: RequestContext, req: ResearchRequest, idempotencyKey?: string) {
  const businessId = assertUuid(req.businessId, "businessId");
  const question = typeof req.question === "string" ? req.question.trim().replace(/\r\n/g, "\n") : "";
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.organizationId, ctx.organizationId)));
  if (!business) throw new ServiceError("invalid-input", "Business not found.");
  const title = (req.title?.trim() || `Research: ${question.replace(/\s+/g, " ").slice(0, 80)}`).slice(0, 200);

  const svc = new TaskService(db);
  const { task, created } = await svc.createTask(
    ctx,
    { title, kind: "research", businessId, description: question, priority: 2, timeoutSeconds: 600, maxAttempts: 2 },
    idempotencyKey,
  );
  if (!created) return { task, agent: null, note: "Already submitted." };
  const agent = await findResearchAgent(db, ctx.organizationId, businessId);
  if (!agent) return { task, agent: null, note: `${business.name} has no active Research Agent, so the task stays queued.` };
  const assigned = await svc.transition(ctx, task.id, { action: "assign", agentId: agent.id, reason: "Research request from the dashboard" });
  return { task: assigned, agent, note: `Assigned to ${agent.displayName}.` };
}

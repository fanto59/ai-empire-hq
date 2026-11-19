import { and, eq } from "drizzle-orm";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents } from "@/infrastructure/db/schema";
import type { RequestContext } from "../auth/context";
import { TaskService } from "./service";

/**
 * Owner objective → executive task, assigned to the active Chief AI Manager
 * (an HQ-level agent holding org.read). The Chief worker then claims it.
 */
export async function findChiefAgent(db: Db, organizationId: string) {
  const [chief] = await db
    .select({ id: agents.id, slug: agents.slug, displayName: agents.displayName })
    .from(agents)
    .innerJoin(agentPermissions, eq(agentPermissions.agentId, agents.id))
    .where(
      and(
        eq(agents.organizationId, organizationId),
        eq(agents.role, "chief-ai-manager"),
        eq(agents.status, "active"),
        eq(agentPermissions.permission, "org.read"),
      ),
    )
    .limit(1);
  return chief ?? null;
}

export async function createExecutiveTask(db: Db, ctx: RequestContext, goal: string, idempotencyKey?: string) {
  const objective = typeof goal === "string" ? goal.trim().replace(/\r\n/g, "\n") : "";
  const svc = new TaskService(db);
  const { task, created } = await svc.createTask(
    ctx,
    {
      title: `Objective: ${objective.replace(/\s+/g, " ").slice(0, 90)}`,
      kind: "executive",
      businessId: null,
      description: objective,
      priority: 1,
      timeoutSeconds: 900,
      maxAttempts: 2,
    },
    idempotencyKey,
  );
  if (!created) return { task, note: "Already submitted." };
  const chief = await findChiefAgent(db, ctx.organizationId);
  if (!chief) return { task, note: "No active Chief AI Manager with org.read, so the objective stays queued." };
  const assigned = await svc.transition(ctx, task.id, { action: "assign", agentId: chief.id, reason: "Owner objective" });
  return { task: assigned, note: `Sent to ${chief.displayName}.` };
}

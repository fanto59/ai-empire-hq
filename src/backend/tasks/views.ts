import { asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TaskSummaryView } from "@/domain/task-view";
import type { Db } from "@/infrastructure/db/client";
import { agents, businesses, projects, tasks } from "@/infrastructure/db/schema";
import type { RequestContext } from "../auth/context";
import { TaskService } from "./service";

/** Task summaries for server-rendered pages, scoped by the caller's context. */
export async function loadTaskSummaries(db: Db, ctx: RequestContext, limit = 200): Promise<TaskSummaryView[]> {
  // Reuse the service's access rules, then enrich with names in one query.
  const visible = await new TaskService(db).listTasks(ctx, { limit });
  if (visible.length === 0) return [];
  const ids = new Set(visible.map((t) => t.id));
  const assignee = alias(agents, "assignee");
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      state: tasks.state,
      priority: tasks.priority,
      attempt: tasks.attempt,
      maxAttempts: tasks.maxAttempts,
      lastError: tasks.lastError,
      updatedAt: tasks.updatedAt,
      businessName: businesses.name,
      projectTitle: projects.title,
      assigneeSlug: assignee.slug,
      assigneeName: assignee.displayName,
    })
    .from(tasks)
    .leftJoin(businesses, eq(businesses.id, tasks.businessId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeAgentId))
    .where(eq(tasks.organizationId, ctx.organizationId))
    .orderBy(asc(tasks.priority), desc(tasks.updatedAt));
  return rows
    .filter((r) => ids.has(r.id))
    .map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

import type { AgentId, BusinessId, IsoTimestamp, ProjectId, TaskId } from "./ids";

export type ProjectStatus = "proposed" | "approved" | "in-progress" | "blocked" | "done" | "cancelled";

/**
 * Projects belong to exactly one business, or to HQ (businessId = null) for
 * cross-business initiatives owned by the Central Project Manager.
 */
export interface Project {
  id: ProjectId;
  businessId: BusinessId | null;
  title: string;
  summary: string;
  status: ProjectStatus;
  ownerAgentId: AgentId | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type TaskStatus = "todo" | "in-progress" | "awaiting-approval" | "blocked" | "done" | "cancelled";

export interface Task {
  id: TaskId;
  projectId: ProjectId;
  /** Denormalized from the project for cheap business-scoped queries. */
  businessId: BusinessId | null;
  title: string;
  status: TaskStatus;
  assigneeAgentId: AgentId | null;
  /** Human approval is required before any externally visible action. */
  requiresHumanApproval: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

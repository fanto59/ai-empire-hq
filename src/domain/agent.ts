import type { AgentId, BusinessId, DepartmentId, IsoTimestamp } from "./ids";

/**
 * Organizational roles.
 * - chief-ai-manager: HQ-level, sets priorities across all businesses.
 * - central-project-manager: HQ-level, coordinates projects and hand-offs.
 * - business-lead: leads one business sector.
 * - specialist: works inside one business (optionally one department).
 */
export type AgentRole =
  | "chief-ai-manager"
  | "central-project-manager"
  | "business-lead"
  | "specialist";

export type ModelProviderId = "anthropic" | "openai" | "xai";

export interface ModelBinding {
  provider: ModelProviderId;
  /** Provider model identifier. Stored as config, never hard-coded in logic. */
  model: string;
}

/**
 * Lifecycle status of the agent *record*. Live activity (working, idle, ...)
 * is NOT stored here; it is derived from real execution events
 * (src/agents/events) so the UI can never show invented activity.
 */
export type AgentLifecycle = "draft" | "enabled" | "disabled" | "retired";

export interface AgentProfile {
  id: AgentId;
  /** null for HQ-level agents (chief-ai-manager, central-project-manager). */
  businessId: BusinessId | null;
  departmentId: DepartmentId | null;
  role: AgentRole;
  displayName: string;
  title: string;
  lifecycle: AgentLifecycle;
  model: ModelBinding | null;
  /** Explicit allow-list of tool identifiers. Empty = no tools. */
  allowedTools: string[];
  /** Agents this agent reports to (org chart edges). */
  reportsTo: AgentId | null;
  avatar: AgentAvatarConfig;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Visual config consumed by the virtual office renderer. */
export interface AgentAvatarConfig {
  spriteKey: string;
  tint: string;
  /** Home desk tile within the owning business wing (or HQ core). */
  desk: { col: number; row: number };
}

export const HQ_LEVEL_ROLES: readonly AgentRole[] = [
  "chief-ai-manager",
  "central-project-manager",
];

export function isHqLevelRole(role: AgentRole): boolean {
  return HQ_LEVEL_ROLES.includes(role);
}

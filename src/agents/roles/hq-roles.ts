import type { AgentRole } from "@/domain/agent";

/**
 * Static descriptions of the organizational roles. These are role
 * DEFINITIONS (what a role is responsible for), not agent instances or
 * activity. No agent exists until one is explicitly created and enabled.
 */
export interface RoleDefinition {
  role: AgentRole;
  title: string;
  scope: "headquarters" | "business";
  responsibilities: string[];
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    role: "chief-ai-manager",
    title: "Chief AI Manager",
    scope: "headquarters",
    responsibilities: [
      "Sets priorities and goals across all business sectors",
      "Allocates agent capacity and model budgets",
      "Escalates decisions that need human approval",
    ],
  },
  {
    role: "central-project-manager",
    title: "Central Project Manager",
    scope: "headquarters",
    responsibilities: [
      "Breaks goals into projects and tasks",
      "Coordinates hand-offs between business sectors",
      "Tracks progress from real execution events",
    ],
  },
  {
    role: "business-lead",
    title: "Business Lead",
    scope: "business",
    responsibilities: [
      "Runs one independent business sector",
      "Directs that sector's specialist agents",
      "Reports status to headquarters",
    ],
  },
  {
    role: "specialist",
    title: "Specialist",
    scope: "business",
    responsibilities: ["Executes assigned tasks inside one business sector with allow-listed tools"],
  },
];

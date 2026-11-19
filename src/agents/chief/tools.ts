import type Anthropic from "@anthropic-ai/sdk";

/**
 * CHIEF AI MANAGER - TOOL SURFACE (the complete list; nothing else exists)
 *
 * Read-only organization tools, one bounded request tool, and the final
 * submit_plan tool. There is deliberately NO tool to approve spending, change
 * budgets, sign or execute contracts, change permissions, decide approval
 * requests, assign agents, or run code. Those actions stay with people.
 */
export const READ_TOOLS = [
  "list_businesses",
  "list_projects",
  "list_tasks",
  "get_task",
  "list_reports",
  "read_report",
  "get_budget_status",
] as const;
export const REQUEST_TOOL = "request_work_from_project_manager";
export const PLAN_TOOL = "submit_plan";
export const CHIEF_TOOL_NAMES: readonly string[] = [...READ_TOOLS, REQUEST_TOOL, PLAN_TOOL];

/** Max work requests per executive task (across attempts). */
export const MAX_WORK_REQUESTS = 5;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const TASK_STATES_FOR_TOOLS = ["queued", "assigned", "running", "waiting", "paused", "completed", "failed", "canceled"];

export const CHIEF_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_businesses",
    description: "List every business sector in the organization with its status. Read-only.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "list_projects",
    description: "List projects, optionally for one business (business_id) or headquarters only (business_id = \"hq\"). Read-only.",
    strict: true,
    input_schema: obj({ business_id: nullable({ type: "string" }) }),
  },
  {
    name: "list_tasks",
    description: "List tasks with state, assignee, result or last error. Filter by state and/or business_id (\"hq\" for headquarters). Read-only.",
    strict: true,
    input_schema: obj({
      state: nullable({ type: "string", enum: TASK_STATES_FOR_TOOLS }),
      business_id: nullable({ type: "string" }),
    }),
  },
  {
    name: "get_task",
    description: "Get one task's description, state, result, error, dependencies and recent history. Read-only.",
    strict: true,
    input_schema: obj({ task_id: { type: "string" } }),
  },
  {
    name: "list_reports",
    description: "List research reports and other notes in the knowledge vault (titles and paths). Read-only.",
    strict: true,
    input_schema: obj({ business_id: nullable({ type: "string" }) }),
  },
  {
    name: "read_report",
    description: "Read one knowledge-vault note by its path (from list_reports). Use this to review completed reports. Read-only.",
    strict: true,
    input_schema: obj({ path: { type: "string" } }),
  },
  {
    name: "get_budget_status",
    description: "This month's API budgets and spend for the organization and each business. Read-only; you cannot change budgets.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: REQUEST_TOOL,
    description:
      "Ask the Central Project Manager to take on a piece of work. Creates a request task that needs the owner's approval before it can be completed. It does not start execution, spend money, or assign other agents. Use sparingly (max 5).",
    strict: true,
    input_schema: obj({
      title: { type: "string", description: "Short imperative title." },
      description: { type: "string", description: "What is needed and why, and what done looks like." },
      business_id: nullable({ type: "string" }),
      priority: { type: "integer", enum: [1, 2, 3, 4, 5], description: "1 = most urgent." },
    }),
  },
  {
    name: PLAN_TOOL,
    description: "Submit your final executive plan and briefing. Call exactly once, when your review is complete.",
    strict: true,
    input_schema: obj({
      objective: { type: "string", description: "The owner's goal, restated precisely." },
      summary: { type: "string", description: "2-4 sentence executive summary." },
      priorities: {
        type: "array",
        items: obj({ rank: { type: "integer" }, title: { type: "string" }, rationale: { type: "string" }, business: nullable({ type: "string" }) }),
      },
      opportunities: { type: "array", items: { type: "string" } },
      risks: {
        type: "array",
        items: obj({ risk: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high"] }, mitigation: { type: "string" } }),
      },
      execution_plan: {
        type: "array",
        items: obj({
          step: { type: "integer" },
          owner: { type: "string", enum: ["owner", "chief-ai-manager", "central-project-manager", "business-lead", "research-agent"] },
          action: { type: "string" },
          needs_owner_approval: { type: "boolean" },
        }),
      },
      decisions_for_owner: { type: "array", items: { type: "string" }, description: "Decisions only the owner can make (spending, contracts, permissions, approvals)." },
      recommendation: { type: "string", description: "Your single most important recommendation." },
    }),
  },
];

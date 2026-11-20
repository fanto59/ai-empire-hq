import type { ToolSpec } from "../providers/types";

/**
 * SECTOR & BUSINESS AGENT - TOOL SURFACE (the complete list; nothing else exists)
 *
 * Read tools are confined to the agent's scope (its business, or its
 * sector's businesses). The only writes are a DRAFT note in the task's own
 * business folder and a PROPOSAL for an outside action, which a person must
 * approve and which nothing can carry out today. No tool sends, pays, signs,
 * publishes, deploys, changes budgets or permissions, assigns work, or runs
 * code.
 */
export const RESULT_TOOL = "submit_result";
export const DRAFT_TOOL = "save_draft_note";
export const PROPOSE_TOOL = "propose_outside_action";
export const BUSINESS_READ_TOOLS = ["get_business_profile", "list_tasks", "get_task", "list_projects", "list_notes", "read_note"] as const;
export const BUSINESS_TOOL_NAMES: readonly string[] = [...BUSINESS_READ_TOOLS, DRAFT_TOOL, PROPOSE_TOOL, RESULT_TOOL];

/** Bounds per task (across attempts are enforced by the toolbox). */
export const MAX_DRAFTS = 3;
export const MAX_PROPOSALS = 2;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, additionalProperties: false, required: Object.keys(properties), properties });
const STATES = ["queued", "assigned", "running", "waiting", "paused", "completed", "failed", "canceled"];
export const OUTSIDE_ACTION_KINDS = ["financial_transfer", "binding_commitment", "external_message", "public_publish", "production_deploy"];

export const BUSINESS_TOOLS: ToolSpec[] = [
  {
    name: "get_business_profile",
    description: "Read the profile the owner wrote for a business you work for (its business.md note). Read-only. business: the business slug, or null for the task's business.",
    inputSchema: obj({ business: nullable({ type: "string" }) }),
  },
  {
    name: "list_tasks",
    description: "List tasks of the businesses you work for, optionally by state. Read-only.",
    inputSchema: obj({ state: nullable({ type: "string", enum: STATES }) }),
  },
  { name: "get_task", description: "Read one task of your businesses: description, state, result, error. Read-only.", inputSchema: obj({ task_id: { type: "string" } }) },
  { name: "list_projects", description: "List projects of your businesses (and your sector's projects). Read-only.", inputSchema: obj({}) },
  {
    name: "list_notes",
    description: "List knowledge notes of the businesses you work for. Read-only. business: a slug or null for all you can read.",
    inputSchema: obj({ business: nullable({ type: "string" }) }),
  },
  { name: "read_note", description: "Read one knowledge note by its path (from list_notes). Read-only.", inputSchema: obj({ path: { type: "string" } }) },
  {
    name: DRAFT_TOOL,
    description: "Save a DRAFT note (Markdown) in this task's business folder for the owner to review. Drafts are never published or sent anywhere.",
    inputSchema: obj({ title: { type: "string" }, body: { type: "string" } }),
  },
  {
    name: PROPOSE_TOOL,
    description:
      "Propose an outside action (payment, contract, message to someone outside, public post, deployment) for the OWNER to approve. It is only recorded; you cannot carry it out and nothing will be sent. Use sparingly.",
    inputSchema: obj({
      kind: { type: "string", enum: OUTSIDE_ACTION_KINDS },
      summary: { type: "string" },
      details: { type: "string" },
      counterparty: nullable({ type: "string" }),
      amount_usd: nullable({ type: "number" }),
    }),
  },
  {
    name: RESULT_TOOL,
    description: "Finish the task: submit your result. Call exactly once when the work is done.",
    inputSchema: obj({
      summary: { type: "string" },
      deliverable_markdown: { type: "string" },
      next_steps: { type: "array", items: { type: "string" } },
      open_questions: { type: "array", items: { type: "string" } },
    }),
  },
];

export interface BusinessResult {
  summary: string;
  deliverable_markdown: string;
  next_steps: string[];
  open_questions: string[];
}

export class ResultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultValidationError";
  }
}

/** Never trust model output blindly: validate and bound the result. */
export function validateResult(input: unknown): BusinessResult {
  const o = (input ?? {}) as Record<string, unknown>;
  const text = (v: unknown, field: string, min: number, max: number) => {
    if (typeof v !== "string" || v.trim().length < min) throw new ResultValidationError(`"${field}" must be at least ${min} characters.`);
    return v.trim().slice(0, max);
  };
  const list = (v: unknown, field: string) => {
    if (!Array.isArray(v)) throw new ResultValidationError(`"${field}" must be a list.`);
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 300)).slice(0, 10);
  };
  return {
    summary: text(o.summary, "summary", 10, 600),
    deliverable_markdown: text(o.deliverable_markdown, "deliverable_markdown", 20, 20_000),
    next_steps: list(o.next_steps, "next_steps"),
    open_questions: list(o.open_questions, "open_questions"),
  };
}

export function renderDeliverable(r: BusinessResult, meta: { task: string; agent: string; business: string; model: string; costLabel: string; at: string }): string {
  const lines = [
    `> **AI-generated draft** by ${meta.agent} for ${meta.business} (${meta.model}, ${meta.costLabel}, ${meta.at}). Review before using it; nothing was sent or published.`,
    "",
    `**Task:** ${meta.task}`,
    "",
    `**Summary:** ${r.summary}`,
    "",
    r.deliverable_markdown,
  ];
  if (r.next_steps.length) lines.push("", "## Suggested next steps", ...r.next_steps.map((s) => `- ${s}`));
  if (r.open_questions.length) lines.push("", "## Open questions for the owner", ...r.open_questions.map((s) => `- ${s}`));
  return lines.join("\n");
}

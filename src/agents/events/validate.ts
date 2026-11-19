import {
  AGENT_EVENT_SCHEMA_VERSION,
  AGENT_EVENT_TYPES,
  type AgentExecutionEvent,
} from "./types";

/**
 * Boundary validation for events entering the system (e.g. from a future
 * agent runtime webhook or worker). Dependency-free on purpose. It validates
 * the envelope; payload shape is trusted only after the type is known.
 *
 * Returns a discriminated result instead of throwing so callers must handle
 * rejection explicitly.
 */
export type ValidationResult =
  | { ok: true; event: AgentExecutionEvent }
  | { ok: false; errors: string[] };

const ORIGINS = new Set(["live", "replay", "test", "simulation"]);
const TYPES = new Set<string>(AGENT_EVENT_TYPES);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const MAX_STRING = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING;
}

export function validateAgentEvent(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["event must be an object"] };

  if (input.schemaVersion !== AGENT_EVENT_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (!isId(input.id)) errors.push("id is required");
  if (typeof input.type !== "string" || !TYPES.has(input.type)) errors.push("unknown type");
  if (typeof input.origin !== "string" || !ORIGINS.has(input.origin)) errors.push("invalid origin");
  if (typeof input.occurredAt !== "string" || !ISO_UTC.test(input.occurredAt))
    errors.push("occurredAt must be an ISO-8601 UTC timestamp");
  if (typeof input.sequence !== "number" || !Number.isInteger(input.sequence) || input.sequence < 0)
    errors.push("sequence must be a non-negative integer");
  if (!isId(input.runId)) errors.push("runId is required");
  if (!isId(input.agentId)) errors.push("agentId is required");
  for (const key of ["businessId", "projectId", "taskId"] as const) {
    if (input[key] !== null && !isId(input[key])) errors.push(`${key} must be an id or null`);
  }
  if (!isRecord(input.payload)) errors.push("payload must be an object");

  return errors.length === 0
    ? { ok: true, event: input as unknown as AgentExecutionEvent }
    : { ok: false, errors };
}

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * OPERATIONAL DATABASE SCHEMA (PostgreSQL, Drizzle ORM)
 *
 * Conventions
 * - UUID primary keys (gen_random_uuid()), timestamps with time zone.
 * - Every business-owned row carries organization_id and business_id
 *   (NULL business_id = headquarters level) for isolation filters.
 * - Money is stored as integer micro-units (1 USD = 1_000_000) - never float.
 * - Migrations are generated into ./drizzle by `npm run db:generate`;
 *   never edit the database by hand.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---- enums -------------------------------------------------------------------

export const businessStatus = pgEnum("business_status", ["planning", "active", "paused", "archived"]);
export const agentRole = pgEnum("agent_role", ["chief-ai-manager", "central-project-manager", "business-lead", "specialist"]);
export const agentStatus = pgEnum("agent_status", ["draft", "active", "disabled", "retired"]);
export const agentPermission = pgEnum("agent_permission", [
  "task.read",
  "task.create",
  "task.execute",
  "approval.request",
  "knowledge.read",
  "knowledge.write",
  "budget.spend",
  // Read-only research capabilities (Anthropic server-side tools).
  "research.web_search",
  "research.web_fetch",
]);
export const projectStatus = pgEnum("project_status", ["proposed", "active", "on-hold", "done", "canceled"]);
/** What kind of work a task is; workers only execute kinds they support. */
export const taskKind = pgEnum("task_kind", ["general", "research"]);
export const taskState = pgEnum("task_state", ["queued", "assigned", "running", "waiting", "paused", "completed", "failed", "canceled"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "suspended", "succeeded", "failed", "timed_out", "canceled"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "expired"]);
export const eventOrigin = pgEnum("event_origin", ["live", "replay", "test", "simulation"]);
export const actorKind = pgEnum("actor_kind", ["user", "agent", "system"]);
export const budgetPeriod = pgEnum("budget_period", ["monthly"]);

// ---- organization structure ------------------------------------------------

export const organizations = pgTable("organizations", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** Marks seed/test organizations so they can never be mistaken for real ones. */
  isTestData: boolean("is_test_data").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sectors = pgTable(
  "sectors",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sectors_org_slug_uq").on(t.organizationId, t.slug)],
);

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sectorId: uuid("sector_id").references(() => sectors.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: businessStatus("status").notNull().default("planning"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("businesses_org_slug_uq").on(t.organizationId, t.slug)],
);

export const departments = pgTable(
  "departments",
  {
    id: id(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("departments_business_slug_uq").on(t.businessId, t.slug)],
);

export const agents = pgTable(
  "agents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** NULL = headquarters-level agent (Chief AI Manager, Central PM). */
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    role: agentRole("role").notNull(),
    status: agentStatus("status").notNull().default("draft"),
    /** Planned provider/model; no provider is connected. */
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("agents_org_slug_uq").on(t.organizationId, t.slug), index("agents_business_idx").on(t.businessId)],
);

export const agentPermissions = pgTable(
  "agent_permissions",
  {
    id: id(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    permission: agentPermission("permission").notNull(),
    /** Scope of the grant; NULL = the agent's own scope. */
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agent_permissions_uq").on(t.agentId, t.permission, t.businessId)],
);

// ---- work ------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    status: projectStatus("status").notNull().default("proposed"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("projects_org_slug_uq").on(t.organizationId, t.slug)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    kind: taskKind("kind").notNull().default("general"),
    state: taskState("state").notNull().default("queued"),
    priority: integer("priority").notNull().default(3),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    /** Execution attempts consumed so far, and the retry ceiling. */
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    timeoutSeconds: integer("timeout_seconds").notNull().default(900),
    /** Client-supplied key that makes task creation idempotent. */
    idempotencyKey: text("idempotency_key"),
    /** Optimistic-concurrency version; bumped on every state change. */
    version: integer("version").notNull().default(1),
    waitingReason: text("waiting_reason"),
    lastError: text("last_error"),
    resultSummary: text("result_summary"),
    createdByKind: actorKind("created_by_kind").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tasks_idempotency_uq").on(t.organizationId, t.idempotencyKey),
    index("tasks_business_state_idx").on(t.businessId, t.state),
    index("tasks_assignee_idx").on(t.assigneeAgentId),
    check("tasks_priority_ck", sql`${t.priority} between 1 and 5`),
    check("tasks_attempts_ck", sql`${t.attempt} >= 0 and ${t.maxAttempts} between 1 and 20 and ${t.attempt} <= ${t.maxAttempts}`),
    check("tasks_timeout_ck", sql`${t.timeoutSeconds} between 1 and 86400`),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }), check("task_dependencies_no_self_ck", sql`${t.taskId} <> ${t.dependsOnTaskId}`)],
);

// ---- execution ---------------------------------------------------------------------

export const executionRuns = pgTable(
  "execution_runs",
  {
    id: id(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    status: runStatus("status").notNull().default("queued"),
    /** Duplicate-job prevention: deterministic key per (task, attempt, segment). */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    workerId: text("worker_id"),
    /** Earliest time a worker may claim this run (retry backoff). */
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    /** Hard deadline for this attempt (started_at + task timeout). */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // At most ONE active run per task, enforced by the database itself.
    uniqueIndex("execution_runs_one_active_per_task_uq")
      .on(t.taskId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("execution_runs_claim_idx").on(t.status, t.availableAt),
  ],
);

export const executionEvents = pgTable(
  "execution_events",
  {
    id: id(),
    runId: uuid("run_id").notNull().references(() => executionRuns.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    origin: eventOrigin("origin").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("execution_events_run_seq_uq").on(t.runId, t.sequence)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => executionRuns.id, { onDelete: "set null" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("approval_requests_one_pending_per_task_uq")
      .on(t.taskId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// ---- knowledge, usage, budgets, audit -----------------------------------------------

/** Index of Markdown notes in the knowledge vault (bodies stay in Markdown). */
export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    vaultPath: text("vault_path").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    checksum: text("checksum").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("knowledge_documents_path_uq").on(t.organizationId, t.vaultPath)],
);

export const modelUsage = pgTable(
  "model_usage",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => executionRuns.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("model_usage_business_time_idx").on(t.businessId, t.recordedAt),
    check("model_usage_nonneg_ck", sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.costMicros} >= 0`),
  ],
);

/** Spending limits only. Not connected to any financial account. */
export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    period: budgetPeriod("period").notNull().default("monthly"),
    periodStart: date("period_start").notNull(),
    currency: text("currency").notNull().default("USD"),
    limitMicros: bigint("limit_micros", { mode: "number" }).notNull(),
    spentMicros: bigint("spent_micros", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("budgets_scope_period_uq").on(t.organizationId, t.businessId, t.period, t.periodStart),
    check("budgets_amounts_ck", sql`${t.limitMicros} >= 0 and ${t.spentMicros} >= 0`),
  ],
);

/** Append-only. A migration trigger rejects UPDATE and DELETE. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    businessId: uuid("business_id"),
    actorKind: actorKind("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_target_idx").on(t.targetType, t.targetId), index("audit_logs_time_idx").on(t.occurredAt)],
);

// ---- API authentication ---------------------------------------------------------------

/**
 * Bearer tokens for the API. Only a SHA-256 hash is stored; the plaintext is
 * shown once when created (scripts/db/create-api-token.ts).
 */
export const apiTokens = pgTable("api_tokens", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  principalKind: actorKind("principal_kind").notNull(),
  /** Set when the token acts as an agent. */
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  scopes: text("scopes").array().notNull(),
  /** Allowed business ids; NULL = all businesses. */
  businessIds: uuid("business_ids").array(),
  hqAccess: boolean("hq_access").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

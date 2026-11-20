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
export const agentRole = pgEnum("agent_role", ["chief-ai-manager", "central-project-manager", "business-lead", "specialist", "sector-manager"]);
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
  // Chief AI Manager: read-only access to organization records, and the
  // right to REQUEST (not approve or execute) work from the Project Manager.
  "org.read",
  "task.request",
]);
export const projectStatus = pgEnum("project_status", ["proposed", "active", "on-hold", "done", "canceled"]);
/** What kind of work a task is; workers only execute kinds they support. */
export const taskKind = pgEnum("task_kind", ["general", "research", "executive"]);
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
    /** Display order on the sector directory. */
    position: integer("position").notNull().default(0),
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
    description: text("description").notNull().default(""),
    status: businessStatus("status").notNull().default("planning"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("businesses_org_slug_uq").on(t.organizationId, t.slug),
    // Businesses must stay distinct: no two with the same name (any case) in one organization.
    uniqueIndex("businesses_org_name_uq").on(t.organizationId, sql`lower(${t.name})`),
    index("businesses_sector_idx").on(t.sectorId),
  ],
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
    /** NULL = headquarters- or sector-level agent. */
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    /** Sector-level agent (sector manager / sector specialist): set with business_id NULL. */
    sectorId: uuid("sector_id").references(() => sectors.id, { onDelete: "cascade" }),
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
  (t) => [
    uniqueIndex("agents_org_slug_uq").on(t.organizationId, t.slug),
    index("agents_business_idx").on(t.businessId),
    index("agents_sector_idx").on(t.sectorId),
    // An agent works for one business, OR one sector, OR headquarters - never two scopes.
    check("agents_one_scope_ck", sql`${t.businessId} is null or ${t.sectorId} is null`),
  ],
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
    /** Sector-wide project (business_id NULL). Both NULL = headquarters / cross-sector project. */
    sectorId: uuid("sector_id").references(() => sectors.id, { onDelete: "cascade" }),
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
    /** Global, monotonically increasing cursor for live streaming and replay (SSE Last-Event-ID). */
    streamId: bigserial("stream_id", { mode: "number" }).notNull().unique(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** The agent the event is about (the task's assignee when it was recorded). */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    runId: uuid("run_id").notNull().references(() => executionRuns.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    origin: eventOrigin("origin").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("execution_events_run_seq_uq").on(t.runId, t.sequence),
    index("execution_events_org_stream_idx").on(t.organizationId, t.streamId),
    index("execution_events_agent_stream_idx").on(t.agentId, t.streamId),
  ],
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

/**
 * Persistent working context of an agent on one task (the model conversation
 * so far). Saved after every step so a retried attempt resumes where the
 * previous one stopped instead of starting over.
 */
export const agentTaskContexts = pgTable("agent_task_contexts", {
  taskId: uuid("task_id")
    .primaryKey()
    .references(() => tasks.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
  messages: jsonb("messages").notNull(),
  /** Count of tool requests already made (enforces per-task caps across attempts). */
  workRequests: integer("work_requests").notNull().default(0),
  updatedAt: updatedAt(),
});

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
    /** Sector budget (business_id NULL). All scope columns NULL = organization budget. */
    sectorId: uuid("sector_id").references(() => sectors.id, { onDelete: "cascade" }),
    /** Per-agent budget (optional limit on one agent's spending). */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    /** Per-provider budget (optional limit on spending with one provider: anthropic/openai/xai). */
    provider: text("provider"),
    period: budgetPeriod("period").notNull().default("monthly"),
    periodStart: date("period_start").notNull(),
    currency: text("currency").notNull().default("USD"),
    limitMicros: bigint("limit_micros", { mode: "number" }).notNull(),
    spentMicros: bigint("spent_micros", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One budget per scope and period (NULLs coalesced so organization/sector budgets are unique too).
    uniqueIndex("budgets_scope_period_uq").on(
      t.organizationId,
      sql`coalesce(${t.businessId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.sectorId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.agentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.provider}, '')`,
      t.period,
      t.periodStart,
    ),
    check(
      "budgets_one_scope_ck",
      sql`(case when ${t.businessId} is null then 0 else 1 end + case when ${t.sectorId} is null then 0 else 1 end + case when ${t.agentId} is null then 0 else 1 end + case when ${t.provider} is null then 0 else 1 end) <= 1`,
    ),
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

// ---- Executive control center ---------------------------------------------------------

/** Organization-wide controls. `new_work_suspended` = emergency stop: no new runs start. */
export const orgControls = pgTable("org_controls", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  newWorkSuspended: boolean("new_work_suspended").notNull().default(false),
  reason: text("reason"),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true }),
});

export const proposalStatus = pgEnum("proposal_status", ["pending", "approved", "rejected", "expired", "executed", "canceled"]);

/**
 * Proposed sensitive actions. The exact action is stored (payload) with its
 * canonical hash; approving issues a single-use, expiring token bound to that
 * hash. Executing requires the token AND the identical payload.
 */
export const actionProposals = pgTable(
  "action_proposals",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: proposalStatus("status").notNull().default("pending"),
    proposedByKind: actorKind("proposed_by_kind").notNull(),
    proposedBy: text("proposed_by").notNull(),
    /** A pending proposal can no longer be approved after this. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** sha256 of the approval token (the token itself is shown once, never stored). */
    tokenHash: text("token_hash"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    executedBy: text("executed_by"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: text("result"),
    createdAt: createdAt(),
  },
  (t) => [index("action_proposals_org_status_idx").on(t.organizationId, t.status)],
);

/** Idempotency for control actions: a repeated key returns the first response, never applies twice. */
export const controlRequests = pgTable(
  "control_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    response: jsonb("response").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("control_requests_org_key_uq").on(t.organizationId, t.idempotencyKey)],
);

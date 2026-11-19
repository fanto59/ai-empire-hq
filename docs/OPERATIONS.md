# Operational Backend

PostgreSQL + Drizzle ORM. Code: `src/infrastructure/db/` (schema, client),
`src/backend/tasks/` (state machine engine, service), `src/backend/execution/`
(durable queue), `src/backend/auth/` (API tokens), `src/backend/api/` (HTTP).

## Databases

| `DATABASE_URL` | Use |
| --- | --- |
| `postgres://user:pass@host:5432/db` | Real PostgreSQL (production, staging) |
| `pglite:.data/pglite` | Embedded PostgreSQL (WASM) on disk — **default in development** |
| `pglite:memory` | In-memory (unit tests) |

In production `DATABASE_URL` must be set explicitly; without it pages show a
setup notice and the API answers `503`.

```bash
npm run db:setup     # migrate + seed TEST data (embedded DB by default)
npm run dev          # start AFTER db:setup (one process per PGlite directory)
npm run db:token -- --name "my laptop"   # prints an API token once
npm run db:migrate   # apply migrations (required step for real PostgreSQL)
npm run db:generate  # after editing schema.ts: write a new SQL migration
```

Migrations live in `drizzle/` (SQL, committed). `0001_audit_log_append_only`
adds a trigger that rejects `UPDATE`/`DELETE` on `audit_logs`.

## Data model (16 tables + API tokens)

organizations → sectors → businesses → departments; agents and
agent_permissions; projects → tasks ↔ task_dependencies; execution_runs →
execution_events; approval_requests; knowledge_documents (index of vault
notes); model_usage; budgets; audit_logs; api_tokens. See
[DATA_MODEL.md](DATA_MODEL.md) and `src/infrastructure/db/schema.ts`.

Key constraints enforced by PostgreSQL:
- one active (`queued`/`running`) run per task (partial unique index)
- unique run idempotency key; unique `(organization, idempotency_key)` for tasks
- one pending approval per task; no self-dependencies
- priority/attempt/timeout ranges; non-negative usage and budget amounts
- money as integer micro-units (no floats)

## Task state machine

States: **queued, assigned, running, waiting, paused, completed, failed,
canceled**. Pure definition in `src/domain/task-lifecycle.ts`.

| Action | From | To | Guards (database) |
| --- | --- | --- | --- |
| assign | queued, assigned | assigned | agent active, same business (HQ agents → HQ tasks), `task.execute` permission |
| unassign | assigned | queued | |
| start | assigned | running | assignee set, attempts remaining, all dependencies completed; opens a run |
| wait | running | waiting | suspends the run; may open an approval request |
| resume | waiting / paused | running / assigned (or queued) | from waiting: no pending approval; opens a new run segment |
| pause | queued, assigned, running, waiting | paused | suspends/cancels the active run |
| complete | running | completed | approval-gated tasks need an approved request |
| fail | running, waiting | failed | records the error; expires pending approvals |
| retry | failed | assigned (or queued) | attempts remaining |
| cancel | any non-terminal | canceled | ends runs, expires approvals |

Every change runs in a transaction holding a row lock, bumps `version`
(optimistic concurrency, `expectedVersion` → 409 on mismatch) and appends an
audit log entry.

## Task API

All endpoints need `Authorization: Bearer <token>`.

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/api/v1/tasks?state=&businessId=&projectId=&assigneeAgentId=&limit=` | tasks:read |
| POST | `/api/v1/tasks` (optional `Idempotency-Key` header) | tasks:write |
| GET | `/api/v1/tasks/:id` | tasks:read |
| POST | `/api/v1/tasks/:id/transitions` `{ action, agentId?, reason?, result?, error?, approval?, expectedVersion? }` | tasks:transition |
| POST | `/api/v1/approvals/:id/decision` `{ decision: "approved" \| "rejected" }` | approvals:decide (people only) |

Errors: `400` invalid input, `401` bad/missing token, `403` scope or role,
`404` not found **or outside your businesses** (no existence leak), `409`
invalid transition / version conflict / guard failure, `503` no database.

Tokens: 256-bit random, stored as SHA-256 only, optional expiry and
revocation, scoped to businesses. Agent tokens are confined to the agent's
own business, can only `start/wait/complete/fail` tasks assigned to that
agent, and can never decide approvals.

## Durable execution design

The queue is the `execution_runs` table (no extra broker).

1. **Enqueue**: `enqueue(task)` / `enqueueReady()` create a `queued` run for
   assigned tasks whose dependencies are complete. Idempotent.
2. **Claim**: `SELECT … FOR UPDATE SKIP LOCKED` on the oldest available run;
   the task moves to `running`; the run gets `worker_id`, a **lease** and a
   **deadline** (`now + task.timeout_seconds`).
3. **Heartbeat**: extends the lease; returns `false` once the lease or
   deadline has passed, telling the worker to stop.
4. **Finish**: `complete`/`fail` succeed only for the worker that still
   holds an unexpired lease (late or duplicate workers get `lease-lost`).
5. **Reap**: `reapExpired()` times out runs whose lease expired (worker died)
   or whose deadline passed (timeout).
6. **Retry**: failed or timed-out attempts are retried while
   `attempt < max_attempts`, with exponential backoff (30 s, 60 s, 120 s …,
   capped at 30 min) via `available_at`; then the task becomes `failed`.
   Non-retryable failures fail immediately.
7. **Events**: `recordEvent` appends gap-free, per-run sequenced execution
   events (unique `(run_id, sequence)`).

Duplicate-job prevention is layered: partial unique index (one active run per
task), unique idempotency keys, row locks with `SKIP LOCKED`, lease checks on
every write, and `Idempotency-Key` on task creation.

**Workers.** The Research Agent worker (`src/backend/execution/research-worker.ts`)
loops `reapExpired → enqueueReady(research) → claim(research) → execute with
heartbeats → complete/fail`. It runs only when `AGENT_EXECUTION_ENABLED` and
`PROVIDER_ANTHROPIC_ENABLED` are `true` and `AEHQ_ANTHROPIC_API_KEY` is set:
in-process (`AGENT_WORKER=in-process`, needed with the embedded database) or
as `npm run worker`. Tasks of other kinds are never claimed. See
[RESEARCH_AGENT.md](RESEARCH_AGENT.md).

## Test data

`npm run db:seed` creates organization `test-org` (`is_test_data = true`)
with two **Test Business** records, four test agents, two projects, and eight
tasks driven through the real state machine so that every state appears.
Usage and budgets are zero-value test rows; nothing is connected to any
financial account. The seed refuses to run twice.

## Testing

`npm test` runs everything on in-memory PGlite. To also run against a real
server (adds the concurrent-claim tests):

```bash
TEST_DATABASE_URL=postgres://user@localhost:5432/postgres npm test
```

Each test file creates and drops its own throwaway database there; never
point it at a server with real data.

## API usage & spending (`/usage`)

Built only from `model_usage` (one row per real Claude API call, written by the
SpendGuard; seeds insert none). Shows today / this month / all time, average
per day and a labelled month-end projection, monthly budgets (organization and
per business), a 30-day daily spend chart (UTC days, hover tooltip, table view),
breakdowns by agent, model and business, and the most recent calls. Hosting and
other costs are not tracked. Code: `src/backend/usage/report.ts`.

## Agent assignments (`/agents`)

Signed-in owners can give any active agent an assignment
(`src/backend/tasks/assignments.ts`). Routing by capability: the Chief AI
Manager gets an executive objective, agents with `research.web_search` get a
research task (both run automatically within budgets), and every other agent
gets a tracked `general` task assigned to it (requires `task.execute`; no worker
runs these agents yet, and the UI says so). Agents can never assign work.

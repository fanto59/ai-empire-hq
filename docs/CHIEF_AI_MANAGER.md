# Chief AI Manager

The organization-level agent. It takes an owner objective, reviews the
organization's real records, and returns a proposed execution plan and an
executive briefing. It **recommends**; the owner decides.

## Using it

Executive Floor → click **ORION** (the Chief AI Manager character) → sign in
if asked → write an objective → **Send to Chief AI Manager**. The panel shows,
from the database: the objective's state, live execution events, cost, any
error, and the final recommendation with priorities, risks, the proposed
execution plan (steps needing your approval are marked) and decisions for you.
The full plan is on the task page; the briefing is saved to the knowledge
vault (`hq/reports/…`). The character's movement remains a labelled simulation.

## Flow

```
ORION panel (signed in) → createExecutiveTask: validate (10-4,000 chars), persist kind=executive,
                          HQ scope, assign to the active Chief AI Manager (org.read)
ChiefWorker → claim (executive only) → authorize (active, chief-ai-manager, HQ, org.read)
            → resume saved context if any → Claude tool loop (budget-reserved calls)
            → plan validated + guardrail → HQ briefing note → run.completed {plan} → completed
            → on error: run.failed → failed (or retried if transient, resuming context)
```

## Responsibilities → capabilities

| Responsibility | Tool | Access |
| --- | --- | --- |
| Review active projects / tasks | `list_projects`, `list_tasks`, `get_task` | read-only (`tasks:read`) |
| Review completed reports | `list_reports`, `read_report` | read-only; restricted notes hidden |
| Oversee sectors, budgets | `list_businesses`, `get_budget_status` | read-only |
| Request work from the Project Manager | `request_work_from_project_manager` | needs `task.request`; see limits |
| Recommend priorities, risks, plan, briefing | `submit_plan` | final output |
| Coordinate sector managers | via plan steps (owner = business-lead) and PM requests | no direct control |

## Boundaries (enforced in code, covered by tests)

- **No tool exists** to approve spending, change budgets, sign/execute
  contracts, change permissions, decide approval requests, assign agents,
  or run code. Calls to any other tool name are refused, answered with an
  error, and logged as `agent.tool.denied` (test: forbidden actions leave
  budgets, permissions and approvals unchanged).
- Its identity cannot approve, assign or drive other tasks through the task
  service (agent principals are limited to their own tasks; approvals are
  people-only).
- Read tools use a read-only context and never modify records (test).
- Work requests are always `general` tasks (no worker executes them), always
  **require owner approval**, are always headquarters tasks assigned to the
  Central Project Manager, idempotent per title, max 5 per objective.
- Plan guardrail: any step mentioning approvals, spending, budgets, payments,
  contracts, signing, permissions, hiring or launches is marked as needing
  owner approval, even if the model did not mark it.
- Only an active, headquarters-level agent with role `chief-ai-manager` and
  `org.read` can execute objectives; anything else fails before any model
  call.
- Spending: every call reserves its worst case on the organization budget
  (default $0) and the per-attempt cap (`RESEARCH_MAX_COST_USD`).

## Persistent task context

The conversation is saved in `agent_task_contexts` after every step (the
provider transcript plus the input not yet sent). If an attempt fails
transiently, the retry resumes from the saved context (and the work-request
count carries over) instead of starting over. If the owner switched the
Chief to another model in between, the objective starts over on the new model.

## Setup

Runs on the model assigned on **/models** (initially OpenAI `gpt-6.2-sol`,
strategy work; see [MODEL_PROVIDERS.md](MODEL_PROVIDERS.md)). Needs that
provider's app key and switch (e.g. `AEHQ_OPENAI_API_KEY` +
`PROVIDER_OPENAI_ENABLED=true`), `AGENT_EXECUTION_ENABLED=true`, and a
worker (`AGENT_WORKER=in-process` or `npm run worker`). Set an organization
budget with `npm run budget:set -- --usd 2`. A fresh `npm run db:setup` gives
the seeded Chief `org.read`, `task.request` and `knowledge.write`.

# Sector managers and business agents

Sector managers, business leads and specialists now do real work. When a
person assigns them something, they run it on their one assigned model and
hand back a draft deliverable.

## What happens when you assign work

1. **Assign.** On a business page (`/businesses/<slug>`) or on `/agents`, a
   person with `tasks:write` gives an assignment to a sector manager,
   business lead or specialist that holds `task.execute`.
   - This creates a `business` task.
   - Older "tracked only" `general` tasks are never run.
2. **Claim.** The Business worker claims only `business` tasks that meet all
   of these:
   - assigned to one of those three roles;
   - not marked "requires approval";
   - the agent is active;
   - new work is not suspended.
3. **Re-check.** Before any model call, the worker checks again:
   - the agent's role;
   - `task.execute`;
   - the org rule that the agent may work on this business (`canAssignAgent`);
   - the provider is ready.
4. **Budget.** Every model call reserves its worst-case cost first. Each of
   these budgets must have room:
   - organization
   - business (default $0, which means nothing is spent until you set one)
   - sector, if one is set
   - agent, if one is set
   - provider, if one is set
5. **Work.** The agent uses its tools (below). The conversation is saved
   after every step, so a retry resumes where it stopped.
6. **Deliver.** `submit_result` returns a summary, a Markdown deliverable,
   next steps and open questions.
   - If the agent holds `knowledge.write`, the deliverable is saved as a
     **draft** note in `businesses/<slug>/reports/`, linked to the task.
   - The task completes, and `run.completed` carries `notePath`, the drafts
     and the proposals.

## Tools (the complete list)

| Tool | What it can do |
|---|---|
| `get_business_profile` | Read the owner's `business.md` for a business in scope |
| `list_tasks`, `get_task` | Read tasks of businesses in scope |
| `list_projects` | Read projects of businesses in scope, and the sector's projects |
| `list_notes`, `read_note` | Read notes of businesses in scope (restricted notes stay person-only) |
| `save_draft_note` | Write a **draft** note in the task's business only. Needs `knowledge.write`; at most 3 per task |
| `propose_outside_action` | Record a proposal for a payment, contract, outside message, public post or deployment. Needs `approval.request`; at most 2 per task |
| `submit_result` | Finish the task |

There are no web, shell, database, messaging, spending, approval, budget,
permission or assignment tools. A call to any other tool name is refused and
audited (`agent.tool.denied`).

Proposals wait on `/control`. Only a person can approve one, and executing an
approved external action returns `no-integration`, because nothing is
connected that could send, pay, sign, publish or deploy.

## Scope: businesses stay distinct

| Agent | Reads | Writes drafts |
|---|---|---|
| Business lead or specialist | Its own business only | Its own business |
| Sector manager | Every business in its sector | Only the business the task belongs to |

The scope comes from `agentAccess` in `src/backend/org/rules.ts`. The tools
use the same `TaskService` and `KnowledgeService` checks as every other
caller.

## Not inventing facts

The system prompt tells the agent to use only facts from the profile, tasks
and notes. Anything missing goes under "open questions", never guessed.
Every deliverable starts with an "AI-generated draft" line naming the agent,
the model, the cost and the time.

## Starting a business (XYZ PARTYS)

On `/businesses/xyz-partys`, an administrator presses **Set up the XYZ PARTYS
starter team**. The CLI does the same:
`npm run business:starter -- --business xyz-partys`.

It creates:

- **Departments:** Events & Bookings, Marketing & Promotion, Operations &
  Guest Experience.
- **Agents:** a Business Lead and one specialist per department, with the
  base permissions plus `knowledge.write` (for drafts). There are no research
  or spending permissions.
- **Projects:** four, in `proposed` status.
- **Profile:** a `business.md` template. Every section says "Not filled in
  yet", and nothing is invented.

It creates **no tasks** and spends nothing. It is idempotent: existing records
are kept, and the owner's profile is never overwritten. Only people with
`businesses:admin` can run it, and it is audited.

The owner fills in the profile on the same page (also `businesses:admin`,
audited, and secrets are refused). The page offers suggested assignments
that fill in the form; nothing runs until the owner submits one.

To let the agents actually work:

1. Assign their models on `/models`, and configure that provider's key
   (`AEHQ_*`).
2. Set a budget for the business:
   `npm run budget:set -- --usd 5 --business xyz-partys`
3. Turn on the worker (`AGENT_EXECUTION_ENABLED=true`, in-process, or
   `npm run worker`).

## Tests

`src/backend/execution/business-worker.test.ts` uses a scripted model, so
there is no network and no cost. It covers:

- the tool surface;
- an end-to-end run: profile → draft → proposal → deliverable, with usage and
  the budget charged;
- tracked, approval-gated and paused-agent work never being claimed;
- no budget, which means no model call;
- business isolation;
- the sector manager's scope;
- draft and proposal limits and permissions;
- unknown tools being refused and audited.

`src/backend/org/starter.test.ts` covers:

- what the starter creates;
- that it creates no tasks;
- idempotency;
- other businesses staying untouched;
- admin-only access;
- secrets being refused.

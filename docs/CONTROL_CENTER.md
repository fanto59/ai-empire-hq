# Executive control center (`/control`)

One page for the controls the owner needs to run AI Empire HQ safely. Every
control works the same way:

- **Server-side authorization.** Each call is made by a signed-in **person**
  (never an agent token), holds the control's permission, and has
  organization-wide access. The check runs again on every request; the page
  hiding a button is never the protection.
- **Audit log.** Every applied action, and every refused attempt to execute an
  approved action, writes an `audit_logs` entry. The result returns its id.
- **No double application.** Each submission carries a request key. A
  repeated key returns the first response, marked `duplicate`, and applies
  nothing again. A new request for a change that is already in effect (for
  example pausing a paused agent) is refused with the code `duplicate`.
- **Explicit results.** The server returns `{ accepted, message, auditId, at,
  code }`. The UI shows only that verdict: "✓ Accepted by the server · audit #N"
  or "✕ Rejected by the server (reason)", and nothing optimistic. A "Server
  responses" log keeps each verdict visible even after the page re-renders.

## Controls and permissions

| Control | Permission (scope) | Applies |
|---|---|---|
| Suspend all new work (emergency) | `emergency:operate` | Immediately |
| Lift the suspension | `emergency:operate`, and an approved proposal | After approval, with its token |
| Pause or resume an agent | `agents:operate` | Immediately |
| Cancel an agent's open work, or one task | `agents:operate` + `tasks:transition`, or `tasks:transition` | Immediately |
| Assign work | `tasks:write` | Immediately (assignment rules apply) |
| Project status | `tasks:write` | Immediately |
| Approve or reject a task waiting for approval | `approvals:decide` | Immediately |
| Approve or reject a proposed action | `approvals:decide` | Issues a token, or rejects |
| Lower a budget (organization, sector, business, agent, provider) | `budgets:admin` | Immediately |
| Raise a budget | `budgets:admin`, and an approved proposal | After approval, with its token |
| Model selection | `models:admin` | On `/models` |

Agent tokens never receive any of these scopes. Owner tokens from
`npm run db:token` get all of them.

**The rule:** actions that reduce risk (suspend, pause, cancel, lower a
budget) apply at once. Actions that increase risk or spending (lift the
suspension, raise a budget, anything with an outside effect) need an
approval token.

## Emergency suspension

`org_controls.new_work_suspended` stops every new run:

- The execution queue claims nothing for the organization.
- The task engine refuses `start`.
- Work already running continues until it finishes, or until you cancel it.
  A canceled run's worker finds out at its next heartbeat and stops its model
  calls.
- Queued tasks wait, and resume when the suspension is lifted. Lifting it
  goes through an approval token.

## Pausing and canceling agents

- A paused agent (status `disabled`) starts no new work. The queue only claims
  runs whose assigned agent is active, and the engine refuses `start`.
- **Cancel open work** cancels every open task of that agent through the
  state machine. A running worker loses its lease at the next heartbeat and
  aborts.

## Approval tokens tied to exact proposed actions

```
propose  → stores the exact action (JSON payload) and its canonical SHA-256 hash
approve  → a person issues a single-use token, valid 15 minutes; only its hash is stored
execute  → needs the token AND the identical payload (same hash), the action's own
           permission, an unexpired token, and a proposal not executed before
```

- Pending proposals expire after 72 hours.
- Expiry is recorded in the database, not just refused.
- A changed payload (`payload-mismatch`), a wrong token (`invalid-token`), an
  expired token (`expired`) and reuse (`duplicate`) are all refused, and the
  first three are audited.
- Agents may *propose* if they hold `approval.request`. Only people approve
  or execute.
- **Budget increases** are only applied if the budget still has the value the
  approver saw (`stale` otherwise).

### External actions cannot happen

Five kinds of action can be proposed and approved for the record:

- financial transfers
- binding commitments
- external messages
- public publishing
- production deployments

None has an executor, because no integration is connected. Executing an
approved one returns `no-integration`: "nothing was sent, paid, signed,
published or deployed". Any future integration must carry out its action
through `executeProposal`, so it is bound to an approved, unexpired,
single-use token for that exact payload.

## Budgets

These budget scopes exist:

| Scope | Required? |
|---|---|
| Organization | Required: no budget means no spending |
| Business | Required for business work |
| Sector | Optional |
| Agent | Optional: caps one agent |
| Provider (`anthropic`, `openai`, `xai`) | Optional: caps spending with one provider |

When an optional budget exists for the month, it must also have room before a
call is reserved. An exhausted budget is shown as "exhausted: calls stop".

## Execution history and errors

- **Execution history:** the latest runs, with task, agent, status, attempt,
  duration, model, recorded cost and error. Queued and running tasks can be
  canceled from here.
- **Error report:** `run.failed` events from the last 30 days, grouped by
  error code, with the count, the latest message and task, and the agents
  involved.

## Tests

- `src/backend/control/control.test.ts`:
  - **unauthorized** requests: agents, missing permission, limited tokens
  - **approval tokens:** exact payload, single use, budget increase flow
  - **expired approvals:** token after 15 minutes, proposal after 72 hours
  - external actions never execute
  - **duplicate actions:** same request key, and repeat state changes
  - **budget exhaustion:** per-agent and per-provider budgets, and the organization budget lowered to $0
  - emergency suspension and resume
  - pause and cancel, including the heartbeat stop
  - execution history and the error report
- The browser verification showed each action's real server verdict, including
  a rejected tampered token, a `no-integration` refusal and a missing session.

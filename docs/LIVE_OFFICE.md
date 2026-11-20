# Live office: real agent events in the Executive Floor

The Executive Floor (`/office`) shows the organization's **real agents** by
default. A character moves only when its agent's worker records an execution
event. The scripted prototype is still available behind the
"Show simulation demo" button, and it is clearly labelled.

## Data flow

```
worker / task engine ──► execution_events (PostgreSQL)
                               │  id, stream_id (global cursor), organization_id,
                               │  agent_id, task_id, run_id, sequence, occurred_at
                               ▼
GET /api/v1/events/stream  (SSE, authenticated: session cookie or Bearer, tasks:read)
                               │  snapshot · agent-event · health · ping
                               ▼
browser: stream-client ─► LiveDirector ─► state machine (machine.ts)
                               │            event → phase → character state + place
                               ▼
                          PixiJS renderer (movement per frame, in the browser)
```

## Event sources (all real, all stored)

| Event | Written by | When |
|---|---|---|
| `run.started`, `run.step`, `tool.called`, `tool.result`, `run.completed`, `run.failed` | the worker (`ExecutionQueue.recordEvent`) | during real agent runs |
| `approval.requested` | the task engine | a task enters `waiting` with an approval request |
| `approval.resolved` | `TaskService.decideApproval` | a person approves or rejects |
| `run.failed` (`WORKER_LOST` / `TIMED_OUT`) | the reaper | the worker stopped heartbeating, or the deadline passed |
| `run.completed` / `run.failed` / `run.canceled` | the task engine | a person completes, fails or cancels a task, only if no worker already reported the end |

A lifecycle event is only recorded when the task has a run, because without a
run nothing was executed. The test-data seed records **no** events
(`TaskService({ recordEvents: false })`), so a fresh database shows every agent
at rest. Only `origin = "live"` events are streamed. Payloads are reduced to a
whitelist of display-safe fields; for example, the Chief's full plan is never
sent.

## State machine (`src/frontend/office/live/machine.ts`)

| Input | Phase | Character |
|---|---|---|
| no events | offline | idle at the resting spot |
| `run.started` | ready | walks to the workstation, sits |
| `run.step`, `tool.result` | working | working |
| `tool.called` | using-tool | working (the tool is shown in the inspector) |
| `approval.requested` | awaiting-approval | stops, shows the approval badge |
| `approval.resolved` | ready | sits (a rejection is followed by `run.failed`) |
| `run.completed` | completed | completed badge |
| `run.failed` | failed | failed badge, error shown in the inspector |
| `run.canceled` | canceled | idle at the workstation |
| health: run `suspended` | paused | idle at the workstation |
| health: lease or deadline passed | (unchanged) + `stalled` | "worker not responding"; it only becomes failed when the reaper records it |

The workstation depends on the task kind: research tasks go to the
`research.desk`, executive objectives to the `chief.desk`, and anything else
to the agent's own desk. Movement uses A\* on the floor grid and is walked in
the browser at a fixed speed. No model or token is ever used for animation.

## Refresh, disconnects, replay, worker failure

- **Browser refresh:** the stream opens with a `snapshot`, which contains
  each agent's most recent run with its events, replayed in order. Characters
  are placed directly at the result, with no re-walking.
- **Network loss:** `EventSource` reconnects and sends `Last-Event-ID`, and
  the server replays only the missed events (`origin: "replay"`). If the
  connection closes for good, the client reconnects with `?after=<id>` and
  exponential backoff. A 401 or 403 stops retrying and shows "Sign in". If
  more than 500 events were missed, or the cursor is unknown, a fresh
  snapshot is sent instead.
- **Duplicate and out-of-order events:** within a run, any event whose
  sequence is at or below the last applied one is ignored. Events from an
  older run are ignored too. Replays are therefore idempotent.
- **Worker failure:** run health, sent every 5 s and immediately after
  lifecycle events, marks a running run whose lease or deadline has passed as
  stalled. When the reaper runs, it records `run.failed WORKER_LOST`, and
  the character shows failed.
- **Late commits:** each poll re-reads a small window below the cursor and
  skips ids it has already sent.

## Inspector

Click an agent to see:

- its true phase
- the task, linked, with its stored state and attempt
- any approval
- the model used by the run, or the assigned model before any run
- the recorded API cost of the run, from `model_usage`
- any error code and message
- output links: the report or briefing note and the result summary
- the stored execution events, with server timestamps; replayed events are marked

The Chief AI Manager's inspector also includes the objective panel.

## Tests

- `src/frontend/office/live/live.test.ts`:
  - every event-to-phase mapping
  - duplicate, stale and replayed events
  - stalled and paused runs
  - walking to the workstation per frame, instant placement on refresh,
    and clamped per-frame movement
- `src/frontend/office/live/stream-client.test.ts`: event wiring, reconnecting with `?after=<last id>`, and 401 handling.
- `src/backend/events/live.test.ts`:
  - stored ids
  - lifecycle events (approval, cancel, worker lost, no duplicates)
  - the seed records no events
  - organization and business scoping, with test-origin events never streamed
  - SSE snapshot, live events, Last-Event-ID replay, large-gap snapshot
  - authentication
  - **end to end:** a real `ResearchWorker` run (scripted model, real
    database) streamed into the `LiveDirector`: walk, then work, then
    complete, and a refresh shows the same state; a budget failure shows
    failed; a real approval request shows waiting-for-approval.

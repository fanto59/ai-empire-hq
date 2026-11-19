# Agent Execution Events

Contract: `src/agents/events/`. This is the **only** source of live activity
for the activity feed, status badges, and office animations.

## Envelope

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `1` | Bump on breaking changes |
| `id` | string | Unique event id (dedup key) |
| `type` | see below | Discriminant |
| `origin` | `live \| replay \| test \| simulation` | Mandatory provenance |
| `occurredAt` | ISO-8601 UTC | |
| `sequence` | int >= 0 | Monotonic per run; ordering + gap detection |
| `runId` | string | One agent run |
| `agentId` | `AgentId` | |
| `businessId` | `BusinessId \| null` | Isolation key; `null` = HQ |
| `projectId`, `taskId` | id or `null` | Optional context |
| `payload` | object | Type-specific |

## Event types

| Type | Payload | Derived activity |
| --- | --- | --- |
| `run.started` | provider, model, trigger | thinking |
| `run.step` | stepIndex, summary | thinking |
| `message.created` | role, text | thinking |
| `tool.called` | toolCallId, tool, inputSummary (redacted) | using-tool |
| `tool.result` | toolCallId, tool, ok, outputSummary | thinking |
| `approval.requested` | approvalId, action, reason | awaiting-approval |
| `approval.resolved` | approvalId, decision | thinking |
| `agent.handoff` | toAgentId, reason | idle |
| `run.completed` | summary, usage | idle |
| `run.failed` | errorCode, safe message | error |

No event for an agent => `offline`.

## Pipeline (planned)

```
Agent runtime (server worker)
   │  emits AgentExecutionEvent (origin: "live")
   ▼
validateAgentEvent()  ── reject ──► logged + dropped
   ▼
persist (append-only)  ──►  AgentEventBus.publish()
                                  │  filtered by businessId
                                  ▼
                       SSE /api/events (authenticated)
                                  ▼
               Browser: deriveActivity() per agent
                                  ▼
               buildOfficeScene() → OfficeRenderer.update()
```

## Live events

The Research Agent worker stores real events in `execution_events` with
`origin: "live"`: `run.started`, `run.step` (one per model call, with token
counts), `tool.called` / `tool.result` (web search and fetch), and
`run.completed` or `run.failed`. Tool use is also written to `audit_logs`
(`agent.tool.*`, `agent.tool.denied`).

## What exists now

- Types and envelope (`types.ts`).
- Dependency-free boundary validator (`validate.ts`).
- Pure activity reducer (`derive.ts`).
- In-memory, business-filtered event bus (`src/backend/events/event-bus.ts`).

Persistence: `execution_events` (id, stream_id cursor, organization, agent,
task, run, sequence, timestamp), written only through `appendEvent`
(`src/backend/execution/events.ts`). Live delivery: the authenticated SSE
stream `/api/v1/events/stream` (see [LIVE_OFFICE.md](LIVE_OFFICE.md)). Events
come only from the app's own workers and task engine; there is no external
ingestion endpoint.

## Rules

- Never emit events without a real run behind them. Tests use
  `origin: "test"`; the bus drops these in production.
- The Executive Floor prototype emits `origin: "simulation"` events in the
  browser only (`src/frontend/office/sim/director.ts`). The backend bus
  always drops them, and the UI labels them as simulated.
- Payload text is human-readable and redacted: no secrets, credentials, or
  full tool inputs that may contain personal data.
- Add new event types by extending the union, `AGENT_EVENT_TYPES`, and
  `deriveActivity` (TypeScript's exhaustive switch flags omissions).

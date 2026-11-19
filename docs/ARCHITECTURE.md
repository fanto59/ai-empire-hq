# Architecture

## Goals

- **Secure by default** - every integration off until explicitly enabled.
- **Expandable** - add business sectors, agents, providers, and renderers
  without restructuring.
- **Honest** - the UI shows only real state. Empty is a valid state.
- **Cloud-ready** - stateless server, env-driven config, standalone build.

## Layers

```
               +-------------------------------------------+
  Browser      |  src/frontend  (React UI, office renderers) |
               +----------------------^--------------------+
                                      | props (safe view models)
               +----------------------+--------------------+
  Next.js      |  src/app  (routes: pages + /api handlers)   |
               +---------+--------------------+------------+
                         |                    |
               +---------v--------+  +--------v-----------+
  Server       |  src/backend     |  |  src/agents        |
               |  services, repo  |  |  events, providers,|
               |  ports, event bus|  |  role definitions  |
               +---------+--------+  +--------+-----------+
                         |                    |
               +---------v--------------------v-----------+
               |  src/infrastructure (config, security,    |
               |  future: persistence, secrets, queues)    |
               +-------------------------------------------+

               src/domain - shared types used by every layer
```

| Layer | Responsibility | May import |
| --- | --- | --- |
| `domain` | Data model types, branded IDs, pure helpers | nothing |
| `agents` | Event contract, validation, activity derivation, provider interface, role definitions | `domain` |
| `backend` | Use-cases/services, repository ports, event bus | `domain`, `agents`, `infrastructure` |
| `infrastructure` | Env config, security headers, (future) DB/secret/queue adapters | `domain` |
| `frontend` | Components and office rendering | `domain`, `agents/events`, `agents/roles` |
| `app` | Routing and composition | everything |

The frontend boundary is enforced by ESLint (`no-restricted-imports`).

## Request flow (today)

1. `GET /` - `src/app/page.tsx` (server component, dynamic).
2. Calls `getHqOverview()` in `src/backend/services`, which reads runtime
   flags and queries the (currently empty) repositories.
3. Builds an `OfficeScene` with `buildOfficeScene()` - activity map is empty
   because no execution runtime exists.
4. Renders the UI. Only the safe view model crosses to the browser.

`GET /office` - interactive Executive Floor (client-side PixiJS, simulated
characters; see [VIRTUAL_OFFICE.md](VIRTUAL_OFFICE.md)).

`GET /knowledge`, `GET /knowledge/note?path=…` - knowledge vault browser
(see [KNOWLEDGE.md](KNOWLEDGE.md)).

`/tasks`, `/tasks/:id` - task list and detail from the database.
`/api/v1/tasks…` - authenticated task API (see [OPERATIONS.md](OPERATIONS.md)).

`GET /sectors` - placeholder sector overview (no sectors exist yet).

`GET /api/health` - liveness probe; returns `{ "status": "ok" }` only.

## Organization model

```
Headquarters
├── Chief AI Manager          (HQ-level agent)
├── Central Project Manager   (HQ-level agent)
└── Business sectors (independent, isolated)
    ├── Business Lead agent
    ├── Departments
    ├── Specialist agents
    ├── Projects -> Tasks
    └── Knowledge sources (Obsidian vaults, read-only)
```

See [DATA_MODEL.md](DATA_MODEL.md).

## Extension points

| Want to add | Where | Notes |
| --- | --- | --- |
| Database | `src/infrastructure/persistence/*` implementing ports in `src/backend/services/repositories.ts` | Pick a free/self-hosted option first (e.g. SQLite/Postgres). |
| Model provider | `src/agents/providers/<provider>.ts` implementing `ModelProvider` | One provider per PR; behind its flag. |
| Execution runtime | `src/agents/runtime/*` (new) emitting `AgentExecutionEvent` | Must honor `AGENT_EXECUTION_ENABLED` and approvals. |
| Live updates to UI | SSE route under `src/app/api/events` subscribing to `AgentEventBus` | Requires auth first. |
| PixiJS office | `src/frontend/office/pixi/*` implementing `OfficeRenderer` | See [VIRTUAL_OFFICE.md](VIRTUAL_OFFICE.md). |
| Obsidian knowledge | `src/backend/knowledge/*` (done), sync adapter in `src/infrastructure/knowledge/sync.ts` | Sync designed, disabled. |

## Roadmap (proposed, each step = its own PR)

1. **Foundation** (this PR).
2. Interactive login for the owner (API tokens exist; pages read as owner).
3. Persistence — **done**: PostgreSQL schema, task API, state machine,
   durable execution queue (no worker yet), audit log.
4. Agent event ingestion + SSE activity feed (still no providers).
5. PixiJS renderer with animated avatars — **prototype done** (Executive
   Floor, simulated); next: drive it from real events.
6. Knowledge service — **done** (local vault, business isolation); next:
   Obsidian Headless Sync once approved.
7. First model provider adapter behind flags, budgets, and approval gates.
8. Chief AI Manager / Central Project Manager orchestration.

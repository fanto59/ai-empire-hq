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
| Obsidian knowledge | `src/infrastructure/knowledge/obsidian.ts` | Read-only, server-side, path allow-list. |

## Roadmap (proposed, each step = its own PR)

1. **Foundation** (this PR).
2. Authentication for the single owner (required before any write API).
3. Persistence (local DB) + business CRUD with audit log.
4. Agent event ingestion + SSE activity feed (still no providers).
5. PixiJS renderer with animated avatars driven by derived activity.
6. Obsidian vault read-only indexing.
7. First model provider adapter behind flags, budgets, and approval gates.
8. Chief AI Manager / Central Project Manager orchestration.

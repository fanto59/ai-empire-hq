# CLAUDE.md - AI EMPIRE HQ

Project instructions for Claude Code (and any AI coding agent) working in this
repository. Read this file and `AGENTS.md` before making changes.

## What this is

AI EMPIRE HQ is a private, secure, expandable headquarters for running several
independent AI-operated business sectors. Long-term vision: a Chief AI Manager,
a Central Project Manager, isolated business sectors, animated isometric AI
employees (PixiJS), Obsidian knowledge, and Claude / OpenAI / Grok model
providers.

**Current phase: first real agents, multi-model.** The Research Agent
(read-only web research) and the Chief AI Manager (reads organization records,
proposes plans) run on Claude, OpenAI or Grok (all three owner-approved), one
model per agent, chosen on /models; all data is test data and nothing else
external is connected.

## Hard rules (never break these)

1. **Do not use OpenClaw.** Do not add it as a dependency or reference it.
2. **Only touch this repository.** Never modify the owner's other repositories.
3. **No paid services.** Do not add SDKs, keys, or config for paid APIs/hosting
   unless the owner explicitly asks in that task. (The owner approved the
   Claude, OpenAI and xAI APIs for agents; see docs/MODEL_PROVIDERS.md.)
4. **No public deployment.** Do not deploy, publish, or expose this app.
5. **No real business accounts.** Never connect to or read real business
   accounts (email, payments, social, stores, banks, ...).
6. **No fake production activity.** Never fabricate agent activity, metrics,
   revenue, or events for display. Empty states are correct. Test data must use
   `origin: "test"` and live only in tests. The only exception is the
   clearly labelled browser-side prototype simulation (Executive Floor):
   its events use `origin: "simulation"`, every surface showing it says
   "simulated", and it never reaches the server or storage.
7. **No secrets in git or Markdown.** Only `.env.example` is tracked. Never
   log secrets. The knowledge service refuses notes that look like secrets.
8. **Minimal dependencies.** Do not add frameworks or libraries without a clear
   need stated in the PR. Pin exact versions.
9. **Work on a branch and open a PR** for review. Never push to `main`.

10. **Agent credentials and capabilities.** Agents use only the app's own keys
    (`AEHQ_ANTHROPIC_API_KEY`, `AEHQ_OPENAI_API_KEY`, `AEHQ_XAI_API_KEY`;
    endpoints pinned) - never Claude Code session credentials or other
    `ANTHROPIC_*` / `OPENAI_*` variables. Keys never reach the browser.
    Agents get an explicit tool allowlist: no shell, no filesystem, no
    database access, no messaging. Every paid call reserves budget first
    (SpendGuard). Each task runs on ONE model (its agent's); never fan a task
    out to several providers.
11. **Agents recommend; people decide.** No agent may approve spending, change
    budgets or permissions, sign or execute contracts, or decide approval
    requests. Never add such a tool to an agent; route those items to the
    owner (see docs/CHIEF_AI_MANAGER.md).

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict)
- PixiJS 8 for the interactive virtual office (client-only, dynamic import)
- PostgreSQL + Drizzle ORM (`pg` driver; embedded PGlite for dev/tests)
- Tailwind CSS v4 (via `@tailwindcss/postcss`, config lives in `globals.css`)
- ESLint 9 flat config (`eslint-config-next`)
- Node 22.18+ (`.nvmrc`), npm
- Tests: Node's built-in test runner (`node:test`) with native TypeScript
  type stripping; `scripts/test/` maps the `@/` alias. No test framework.
  `erasableSyntaxOnly` is on: no enums or constructor parameter properties.

## Commands

```bash
npm install          # install exact pinned dependencies
npm run dev          # development server on http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test             # unit tests (src/**/*.test.ts)
npm run knowledge:seed  # regenerate the sample knowledge vault
npm run db:setup     # migrate + seed TEST data (embedded DB) — run before dev
npm run db:migrate   # apply migrations (explicit step for real PostgreSQL)
npm run db:generate  # create a migration after editing the schema
npm run db:token     # print a test API token once (also used to sign in)
npm run budget:set   # set this month's API budget (test org; default $0)
npm run worker       # standalone Research Agent worker (real PostgreSQL)
npm run test:e2e     # LIVE research test (E2E_MODEL, default claude-opus-5-5; needs its key)
npm run test:providers  # LIVE low-cost test per provider with a key set (< $0.01 each)
npm run build        # production build (.next/standalone output)
npm start            # serve the production build
npm run check        # typecheck + lint + test + build (run before every PR)
```

## Folder layout (enforced separation)

```
src/
  app/             Next.js routes only (thin composition layer + API routes)
  frontend/        React UI: components/, executive-floor/ (page shell),
                   office/ (floor data, navigation, simulation, pixi renderer)
  backend/         Server-only services, repositories (ports), event bus
  agents/          Agent contracts: events/, providers/, roles/
  domain/          Shared, framework-free types (the data model)
  infrastructure/  Config, security headers, db/ (Drizzle schema, client)
drizzle/           SQL migrations (generated; commit them, never edit applied ones)
knowledge/         sample-vault/ (committed demo notes; real vaults go in vaults/)
scripts/           test/ (alias hooks), knowledge/ (sample seed), db/ (migrate, seed, token)
docs/              Architecture, security, data model, office, events, knowledge, deploy
```

Import rules:
- `src/frontend/**` must NOT import `@/backend`, `@/infrastructure`, or
  `@/agents/providers` (ESLint enforces this).
- `src/domain/**` imports nothing outside `src/domain`.
- Only `src/app/**` composes backend + frontend.
- Use the `@/` alias for cross-layer imports.

## Conventions

- Every business-owned record carries `businessId`; every query is scoped by it.
- Task state changes go ONLY through `applyTransition` (src/backend/tasks/engine.ts)
  inside a transaction with the task row locked. Never update `tasks.state` directly.
- UIs read tasks from the database (server-side), never from hard-coded arrays.
- Usage and spending figures come only from `model_usage` rows written for real
  API calls; never seed or fabricate usage.
- Seed and test data must be fictional and marked (`is_test_data`, "Test:" titles).
- Knowledge notes go through `src/backend/knowledge` only (never raw `fs`), with
  an access context. Sync to Obsidian stays disabled until the owner approves.
- Agent "activity" is derived from execution events (`deriveActivity`), never
  stored or simulated. Real runs record `origin: "live"` events.
- Events are written only via `appendEvent` (src/backend/execution/events.ts):
  workers for activity, the task engine for lifecycle (approval, system/person
  ends). The seed records none. The live office animates ONLY from streamed
  events (`/api/v1/events/stream`) through the pure state machine
  (src/frontend/office/live/machine.ts); movement is computed in the browser.
- Model calls go through the provider interface (src/agents/providers/types.ts);
  agents never import an SDK. Claude uses `@anthropic-ai/sdk`; OpenAI and xAI
  use the official `openai` SDK (Responses API, `store: false`). Keep model IDs
  and prices (src/agents/providers/catalog.ts) current; a model is assignable
  only when the provider's live model list confirms it.
- Model assignments change only via `setAgentModel` (models:admin, audited).
- Renderers draw scene/floor data only; they never fetch or hold business logic.
- Keep simulation, pathfinding and floor data pure (no PixiJS/React) and tested.
- Feature flags default to disabled; only the exact string `"true"` enables.
- Add new docs to `docs/` and update this file when rules change.

## Key docs

- `docs/ARCHITECTURE.md` - layers, data flow, roadmap
- `docs/SECURITY.md` - security rules and threat model
- `docs/DATA_MODEL.md` - multi-business data model
- `docs/VIRTUAL_OFFICE.md` - isometric rendering architecture (PixiJS plan)
- `docs/AGENT_EVENTS.md` - real agent execution event contract
- `docs/KNOWLEDGE.md` - knowledge vault, access rules, Obsidian sync design
- `docs/OPERATIONS.md` - database, task state machine, task API, durable execution
- `docs/LIVE_OFFICE.md` - real-time office: event stream, state machine, refresh/replay/failure handling
- `docs/MODEL_PROVIDERS.md` - Claude / OpenAI / Grok: interface, keys, safety, model config, evaluation
- `docs/RESEARCH_AGENT.md` - the Research Agent: flow, limits, credentials
- `docs/CHIEF_AI_MANAGER.md` - the Chief AI Manager agent: tools, boundaries, persistent context
- `docs/DEPLOYMENT.md` - cloud-readiness notes (no deployment yet)

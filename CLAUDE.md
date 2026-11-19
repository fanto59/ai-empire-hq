# CLAUDE.md - AI EMPIRE HQ

Project instructions for Claude Code (and any AI coding agent) working in this
repository. Read this file and `AGENTS.md` before making changes.

## What this is

AI EMPIRE HQ is a private, secure, expandable headquarters for running several
independent AI-operated business sectors. Long-term vision: a Chief AI Manager,
a Central Project Manager, isolated business sectors, animated isometric AI
employees (PixiJS), Obsidian knowledge, and Claude / OpenAI / Grok model
providers.

**Current phase: foundation only.** Nothing external is connected.

## Hard rules (never break these)

1. **Do not use OpenClaw.** Do not add it as a dependency or reference it.
2. **Only touch this repository.** Never modify the owner's other repositories.
3. **No paid services.** Do not add SDKs, keys, or config for paid APIs/hosting
   unless the owner explicitly asks in that task.
4. **No public deployment.** Do not deploy, publish, or expose this app.
5. **No real business accounts.** Never connect to or read real business
   accounts (email, payments, social, stores, banks, ...).
6. **No fake production activity.** Never fabricate agent activity, metrics,
   revenue, or events for display. Empty states are correct. Test data must use
   `origin: "test"` and live only in tests.
7. **No secrets in git.** Only `.env.example` is tracked. Never log secrets.
8. **Minimal dependencies.** Do not add frameworks or libraries without a clear
   need stated in the PR. Pin exact versions.
9. **Work on a branch and open a PR** for review. Never push to `main`.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict)
- Tailwind CSS v4 (via `@tailwindcss/postcss`, config lives in `globals.css`)
- ESLint 9 flat config (`eslint-config-next`)
- Node 22 (`.nvmrc`), npm

## Commands

```bash
npm install          # install exact pinned dependencies
npm run dev          # development server on http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm run build        # production build (.next/standalone output)
npm start            # serve the production build
npm run check        # typecheck + lint + build (run before every PR)
```

## Folder layout (enforced separation)

```
src/
  app/             Next.js routes only (thin composition layer + API routes)
  frontend/        React UI: components/, office/ (virtual office renderers)
  backend/         Server-only services, repositories (ports), event bus
  agents/          Agent contracts: events/, providers/, roles/
  domain/          Shared, framework-free types (the data model)
  infrastructure/  Config, security headers, future persistence adapters
docs/              Architecture, security, data model, office, events, deploy
```

Import rules:
- `src/frontend/**` must NOT import `@/backend`, `@/infrastructure`, or
  `@/agents/providers` (ESLint enforces this).
- `src/domain/**` imports nothing outside `src/domain`.
- Only `src/app/**` composes backend + frontend.
- Use the `@/` alias for cross-layer imports.

## Conventions

- Every business-owned record carries `businessId`; every query is scoped by it.
- Agent "activity" is derived from execution events (`deriveActivity`), never
  stored or simulated.
- Renderers draw `OfficeScene` data only; they never read domain records.
- Feature flags default to disabled; only the exact string `"true"` enables.
- Add new docs to `docs/` and update this file when rules change.

## Key docs

- `docs/ARCHITECTURE.md` - layers, data flow, roadmap
- `docs/SECURITY.md` - security rules and threat model
- `docs/DATA_MODEL.md` - multi-business data model
- `docs/VIRTUAL_OFFICE.md` - isometric rendering architecture (PixiJS plan)
- `docs/AGENT_EVENTS.md` - real agent execution event contract
- `docs/DEPLOYMENT.md` - cloud-readiness notes (no deployment yet)

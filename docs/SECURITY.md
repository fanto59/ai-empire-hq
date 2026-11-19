# Security Rules

AI EMPIRE HQ will eventually orchestrate autonomous agents that can spend money
and act on behalf of businesses. The foundation is designed so that this power
is added deliberately, behind explicit gates.

## Project-level rules

1. Do not use OpenClaw.
2. Do not modify any repository other than `ai-empire-hq`.
3. Do not connect paid services.
4. Do not deploy publicly.
5. Do not access real business accounts.
6. Do not generate fake production activity.

## Secrets

- Only `.env.example` is committed; `.env*` is git-ignored.
- No API keys are read by the current code.
- When providers are added: keys are read server-side only, lazily, inside
  the adapter; they are never logged, returned from functions, sent to the
  browser, or stored in database rows (`IntegrationConnection.secretRef`
  points to a secret store entry instead).
- Never prefix a secret with `NEXT_PUBLIC_` - that ships it to the browser.

## Defaults: deny

- `AGENT_EXECUTION_ENABLED`, `PROVIDER_*_ENABLED` default to `false`; only the
  exact string `"true"` enables them.
- Agents have an explicit `allowedTools` list; empty means no tools.
- Integrations have explicit `scopes`; empty means nothing allowed.
- Tasks with `requiresHumanApproval` must emit `approval.requested` and wait.

## Business isolation

- Every business-owned record has a `businessId`.
- Repository methods take a `businessId` and must filter by it; there are no
  unscoped "list everything" queries for business data.
- The event bus filters subscriptions by `businessId`.
- HQ-level data uses `businessId: null` and is visible only to HQ-level roles.

## Research Agent (Claude API)

See [RESEARCH_AGENT.md](RESEARCH_AGENT.md). Dedicated key variable read only
by the provider adapter (endpoint pinned; other Claude credentials ignored),
explicit tool allowlist (web search/fetch on approved domains + one strict
report tool), refused tools logged, web content treated as untrusted,
worst-case cost reserved before every call on business and organization
budgets (default $0), per-attempt cap, deadline-bound requests, sources
verified against what was actually retrieved. Dashboard writes require
sign-in (API token in an httpOnly, SameSite=Strict cookie).

## Knowledge vault

See [KNOWLEDGE.md](KNOWLEDGE.md). Business-scoped access contexts, strict
path whitelist + root containment + symlink refusal, secret scanning on every
write, atomic writes, and sync disabled by a frozen default-deny policy.

## Prototype simulation

The Executive Floor (`/office`) runs a scripted, in-browser simulation:

- Events carry `origin: "simulation"`; the backend event bus drops them and
  nothing sends them to the server or storage.
- Every surface is labelled: banner, SIM chips, inspector disclaimer,
  "Not connected" model, `$0.00` cost placeholder.
- Characters use codenames; no real person, account, or business is shown.

## Layer boundaries

- `src/frontend` cannot import `src/backend`, `src/infrastructure`, or
  `src/agents/providers` (ESLint-enforced). Server data reaches the browser
  only as explicit view models (e.g. `HqOverview`).
- Knowledge `locationRef` values and raw config are never sent to the client.

## HTTP hardening (`src/infrastructure/security/headers.ts`)

- Strict Content-Security-Policy: same-origin only, `object-src 'none'`,
  `frame-ancestors 'none'`. `'unsafe-inline'` for scripts is currently needed
  by Next.js without nonces; planned move to nonce-based CSP with auth.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy` (camera/mic/geo/payment off),
  `Cross-Origin-Opener-Policy`.
- `X-Robots-Tag: noindex` + `robots` metadata: private app.
- `X-Powered-By` disabled.
- `/api/health` reveals no config or version info.
- PixiJS normally compiles shaders with `new Function`; we import
  `pixi.js/unsafe-eval` (a polyfill that *avoids* eval) so the CSP can keep
  `'unsafe-eval'` out of production.

## Agent execution safety (for future phases)

- Global kill switch (`AGENT_EXECUTION_ENABLED`).
- Per-run token/cost budgets enforced before provider calls.
- Human approval for externally visible actions (send, publish, pay, delete).
- Every agent action produces an execution event and an audit entry.
- Event payloads carry redacted summaries, never raw secrets or credentials.
- Event `origin` is mandatory; `"test"` events are dropped in production.

## Task API authentication

`/api/v1/*` requires a bearer token (see [OPERATIONS.md](OPERATIONS.md)):
256-bit random tokens stored only as SHA-256 hashes, scopes, business
restrictions, expiry and revocation, identical 401s for every bad token,
404 (not 403) for records outside the caller's businesses, agents confined to
their own tasks, and approvals reserved for people. Request bodies are capped
at 32 KB and checked for secrets. Server-rendered pages read as the owner
until interactive login exists, so **the app must not be exposed publicly**
before login is added.

## Database

Append-only audit log (trigger), integrity constraints in PostgreSQL,
credentials only via `DATABASE_URL` (never logged; UI shows a redacted
description), embedded dev database in `.data/` (git-ignored, mode 0700).
Seed data is fictional and flagged `is_test_data`.

## Dependencies

- Exact versions pinned; `package-lock.json` committed.
- Run `npm audit` when changing dependencies.
- Add a dependency only with a stated need in the PR.

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

## Before any write API or public exposure

Authentication and authorization must be implemented and reviewed first. No
endpoint that mutates data or ingests events may be added without it.

## Dependencies

- Exact versions pinned; `package-lock.json` committed.
- Run `npm audit` when changing dependencies.
- Add a dependency only with a stated need in the PR.

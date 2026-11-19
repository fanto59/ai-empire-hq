# Research Agent (Claude API)

The first real agent. It answers a research question with read-only web
research and saves a structured, source-checked report in the knowledge vault.

## Flow

```
Dashboard /tasks (signed in)            createResearchTask: validate, persist (kind=research),
  └─ "Create research task" ──────────▶ assign to the business's Research Agent
                                                  │
Worker (in-process or `npm run worker`)          ▼
  reapExpired → enqueueReady(research) → claim (SKIP LOCKED, lease, deadline)
  └─ authorize agent: active, same business, research.* + knowledge.write
  └─ run.started event
  └─ Claude tool loop (src/agents/research/agent.ts)
       before each call: reserve worst-case cost on business + org budgets
       web_search / web_fetch (Anthropic server tools, approved domains only)
       every tool use → execution_events (tool.called / tool.result) + audit_logs
       finish: strict submit_report tool → validated, sources verified
  └─ report → knowledge vault note (frontmatter links the task) + knowledge_documents
  └─ run.completed → task completed
  on error: run.failed → task failed (or re-queued if transient) → shown on the dashboard
```

## Capabilities (allowlist)

| Capability | How | Restriction |
| --- | --- | --- |
| Web search | `web_search_20260209` (runs on Anthropic's servers) | `allowed_domains` = approved list; `max_uses` per task |
| Web fetch | `web_fetch_20260209` | same domains; `max_uses`; 20k content tokens |
| Submit report | client tool `submit_report`, `strict: true` | the only way to finish |

Nothing else is offered to the model: no shell, no file system, no database,
no email or messaging. Any other tool call is refused, answered with an error
result and logged as `agent.tool.denied`. Capabilities are granted per agent
(`research.web_search`, `research.web_fetch`); the worker also requires
`knowledge.write` to save the report. Web content is treated as untrusted
(the system prompt tells the model to ignore instructions found on pages).

## Report

`title`, `summary`, `findings[{statement, confidence, source_ids}]`,
`uncertainties[]`, `sources[{id, title, url}]`. After validation, a source
is **verified** only if its URL was actually returned by a search or fetch in
that run. Low-confidence findings and findings without a verified source are
listed under **Uncertain or unverified**. The note is marked AI-generated.

## Limits

| Limit | Default | Setting |
| --- | --- | --- |
| Monthly budget (organization AND business) | $0 (no spending) | `npm run budget:set -- --usd 2 [--business slug]` |
| Cap per task attempt | $1.00 | `RESEARCH_MAX_COST_USD` |
| Searches / fetches per task | 5 / 3 | `RESEARCH_MAX_SEARCHES`, `RESEARCH_MAX_FETCHES` |
| Model calls per task | 8 | code (`DEFAULT_LIMITS`) |
| Output tokens per call | 8,000 | code |
| Time per attempt | task timeout (research: 10 min) | task `timeoutSeconds` |
| Attempts | 2 (transient errors only) | task `maxAttempts` |

Before every call the **worst-case** cost (estimated input + full output
allowance + remaining searches, priced at the more expensive of the model and
its refusal fallback) is reserved atomically; afterwards it is settled to the
actual cost from `usage`, and a `model_usage` row is written. Prices live in
`src/agents/research/pricing.ts` (verify against Anthropic's pricing page).
The task deadline aborts in-flight requests; heartbeats keep the lease.

Model: `claude-opus-5-5` (`RESEARCH_MODEL`), effort `medium`
(`RESEARCH_EFFORT`). If the model declines a request (`refusal`), the API's
server-side fallback re-runs it on `claude-opus-4-8` within the same call.

## Credentials

- The app reads **only** `AEHQ_ANTHROPIC_API_KEY` and passes it explicitly to
  the official SDK (`@anthropic-ai/sdk`), with the endpoint pinned to
  `https://api.anthropic.com`. It never uses `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ant` profiles, or any Claude
  Code session credentials.
- Use a dedicated API key from the Claude Console, ideally in its own
  workspace with a Console spend limit as a second safety net.
- The key is never logged, stored in the database or Markdown, or sent to the
  browser. The dashboard only shows whether one is configured.

## Running it

```bash
npm run db:setup                     # embedded DB, test data, dev knowledge vault
npm run budget:set -- --usd 2        # organization budget for this month
npm run budget:set -- --usd 1 --business test-business-a
npm run db:token -- --name browser   # sign-in token (shown once)

AEHQ_ANTHROPIC_API_KEY=... \
AGENT_EXECUTION_ENABLED=true PROVIDER_ANTHROPIC_ENABLED=true AGENT_WORKER=in-process \
npm run dev
# → /login (paste the token) → /tasks → "Create research task"
```

With a real PostgreSQL server, run the worker separately: `npm run worker`.

## Tests

- `npm test`: agent loop with a scripted model (pause_turn, tool allowlist,
  refusals, budget refusal, timeout), spend guard, worker integration against
  a real database and vault (success, no budget, no provider, transient retry,
  timeout, missing capability). No network, no cost.
- `npm run test:e2e`: **live** test against the Claude API with a harmless
  public question (Hubble Space Telescope, Wikipedia only, $1 cap). Requires
  `AEHQ_ANTHROPIC_API_KEY`; skipped otherwise.

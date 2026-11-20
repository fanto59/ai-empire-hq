# Model providers: Claude, OpenAI, Grok

AI Empire HQ can run its agents on three providers through one common
interface. The owner approved all three APIs (Anthropic, OpenAI, xAI) for
agent use. Each provider stays off until its switch and its own key are set.

| Provider | SDK | Endpoint (pinned) | App key variable | Switch |
|---|---|---|---|---|
| Claude (Anthropic) | `@anthropic-ai/sdk` (Messages API) | `https://api.anthropic.com` | `AEHQ_ANTHROPIC_API_KEY` | `PROVIDER_ANTHROPIC_ENABLED=true` |
| OpenAI | `openai` (Responses API) | `https://api.openai.com/v1` | `AEHQ_OPENAI_API_KEY` | `PROVIDER_OPENAI_ENABLED=true` |
| Grok (xAI) | `openai` (Responses API) | `https://api.x.ai/v1` | `AEHQ_XAI_API_KEY` | `PROVIDER_XAI_ENABLED=true` |

xAI documents its API as compatible with the official OpenAI SDK and shows
the OpenAI JavaScript client pointed at `https://api.x.ai/v1`. The app uses
the same SDK for OpenAI and xAI, which adds one dependency instead of two.
`AGENT_EXECUTION_ENABLED=true` is still the master switch.

## Initial roles (adjustable)

| Work type | Initial provider and model | Agents |
|---|---|---|
| Engineering and complex execution | Claude, `claude-opus-5-5` | business leads, specialists |
| Strategy and structured analysis | OpenAI, `gpt-6.2-sol` | Chief AI Manager, Central Project Manager |
| Research and trend monitoring | Grok, `grok-4.7` | agents with research permissions |

Administrators change any agent's model on **/models**. Each task runs on
exactly **one** model: the one assigned to the agent doing it. The workers
resolve that model and open a single provider. The app never sends a task
to several providers. A test (`research-worker.test.ts`, "each task uses
exactly ONE provider") checks this.

## Who can change models

- You need a signed-in **person** whose token has the `models:admin` scope
  and organization-wide access. `npm run db:token` creates owner tokens with
  every scope.
- Agent tokens never get `models:admin`, and no agent has a tool that changes
  models.
- Every change writes an `agent.model.changed` audit entry recording the old
  model, the new model, and whether the provider confirmed it.
- A research agent can only get a model that supports domain-limited web search.

## Verifying model IDs

The catalog (`src/agents/providers/catalog.ts`) lists model IDs and prices
checked against each provider's documentation on 2026-11-19. The catalog
alone does not prove a model exists. Before an assignment is saved, the app
asks the provider's **live Models endpoint** using the app's own key:

- **Available:** the provider lists the model, and the assignment is saved as verified.
- **Not offered:** the provider does not list it for the app's key, and the assignment is refused.
- **Unverified:** the provider has no key yet. The assignment is saved but
  marked unverified, and the agent cannot run until the key is set.

Results are cached for 10 minutes. The /models page shows the state of every model.

## The common interface (`src/agents/providers/types.ts`)

Agents talk to a `ChatSession`, which is one conversation with one model.

- **Requests:** system prompt, user text, effort, output limit, timeout/abort.
- **Structured responses:** JSON schema output. Claude uses `output_config.format`;
  OpenAI and xAI use `text.format` with `json_schema` and `strict`.
- **Tool use:** strict client function tools. Results go back as tool results.
- **Web search:** provider-hosted, read-only, limited to approved domains.
  Claude uses `web_search` / `web_fetch`; OpenAI and xAI use `web_search` with
  `filters.allowed_domains`.
- **Errors:** both SDKs' typed exceptions map to `ProviderError` with a kind and
  a retry decision: authentication, permission, model-not-found, rate-limited,
  bad-request, server, connection, timeout.
- **Retries:** transient errors are retried twice inside the SDK, with backoff
  and `retry-after`. After that the execution queue retries the whole attempt
  with exponential backoff. Non-retryable errors fail the task with a clear message.
- **Token usage and estimated cost:** uncached input, cached input, cache
  writes, output and web searches. Cost comes from catalog prices, rounded up.
  Where official sources disagreed, the higher price is used.
- **Model availability:** `listModels()` calls the provider's live model list.
- **Persistent context:** `snapshot()` saves the provider transcript.

## Provider-specific safety restrictions

**All providers**
- Only the app's own key is used. Each key is passed explicitly, so the SDKs
  never read `ANTHROPIC_*` or `OPENAI_*` variables, profiles, or Claude Code
  session credentials.
- Base URLs are pinned.
- OpenAI organization, project, admin key and webhook secret are forced to null.
- Keys are never logged, stored, or sent to the browser. The UI only shows
  whether each key is set.
- Before every call, its worst-case cost is reserved on the organization and
  business budgets (SpendGuard). Budgets default to $0.

**Claude**
- Opus 5.5, Fable 5.2 and Sonnet 5.5 use a server-side refusal fallback
  (Opus 4.8 or Sonnet 5). Budget reservations include its price.
- A refusal ends the task without a retry.
- Content block types outside the allowlist are refused and logged.

**OpenAI and xAI**
- `store: false`, so the provider does not keep conversations server-side.
- OpenAI reasoning is sent back encrypted (`reasoning.encrypted_content`).
  xAI reasoning items are not replayed.
- Only function tools and web search are sent. Any other output item is
  refused and written to the audit log. That includes code interpreter,
  shell, computer use, MCP, image generation and custom tools.
- Retrieved URLs outside the approved domains are discarded and reported,
  so they can never count as verified sources.
- Refusal content parts and `content_filter` stops count as refusals.

## Evaluation against real tasks

/models shows, per model and task type over the last 90 days: attempts,
success rate, average cost per **successful** attempt, average duration,
and total cost (`src/backend/models/evaluation.ts`).

The data comes only from `execution_runs` and `model_usage`. A run counts
toward the model that served most of its calls. Use the table to judge an
assignment, then change it on the same page.

## Tests

- `npm test` (no network, no cost) covers:
  - each adapter's request shape, tool round trips, reasoning replay,
    refusals, truncation, off-allowlist sources and unexpected tools
  - error mapping for both SDKs
  - cost rules
  - credential isolation (`ANTHROPIC_*` and `OPENAI_*` are ignored)
  - availability states
  - assignment permissions and audit
  - evaluation
  - a full research task on Grok through a scripted xAI client
- `npm run test:providers` is a **live, low-cost** test. It runs only for
  providers whose app key is set. For each, it makes one structured request
  to the cheapest model (`claude-haiku-5-5`, `gpt-6-luna`, `grok-4.3`) against
  a $0.10 test budget, checks that the model appears in the live model list,
  and checks that the single `model_usage` row matches the response's
  provider, model, tokens and cost and the budget. Cost is well under $0.01
  per provider.
- `E2E_MODEL=grok-4.7 npm run test:e2e` runs the full live research test on a
  chosen model. The default is `claude-opus-5-5`.

## Network access

In a restricted cloud environment, allow `api.anthropic.com`,
`api.openai.com` and `api.x.ai` for the providers you use.

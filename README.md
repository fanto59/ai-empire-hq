# AI EMPIRE HQ

A private, secure, expandable multi-business AI headquarters.

> **Status: foundation.** The app runs locally and shows the HQ structure. No
> model providers, business accounts, databases, or agents are connected, and
> no activity is simulated.

## Quick start

Requires Node.js 22.18 or newer (see `.nvmrc`).

```bash
npm install
npm run db:setup   # embedded PostgreSQL + test data (first time only)
npm run dev        # http://localhost:3000
```

Pages:

- `/` – Headquarters dashboard
- `/office` – **Executive Floor**: interactive 2.5D office (PixiJS). Live by
  default: your real agents move only on their real execution events (sign in
  required; see docs/LIVE_OFFICE.md). A clearly labelled simulation demo is one
  click away. Click a character to inspect it; drag to pan; scroll to zoom.
- `/tasks` – Tasks from the operational database (test data)
- `/agents` – Agents, their open work and spend; give any agent an assignment
- `/models` – Choose the provider/model per agent; provider status, live availability, results on real tasks
- `/usage` – Model API usage and spending: today, per day, by agent/model/business, budgets
- `/knowledge` – Knowledge vault (Markdown/Obsidian notes, sample content)
- `/sectors` – Sector overview placeholder

### Previewing in Claude Code on the web

Ask Claude to run `npm run dev` and open the preview, or run it yourself in a
local clone and open http://localhost:3000/office. Nothing is deployed.

Production build:

```bash
npm run build
npm start
```

Run every check before opening a pull request:

```bash
npm test           # unit tests (Node's built-in runner)
npm run check      # typecheck + lint + tests + production build
```

Optional: disable Next.js anonymous telemetry on your machine with
`npx next telemetry disable`.

## Documentation

| Doc | Purpose |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Rules for AI coding agents working in this repo |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, data flow, roadmap |
| [docs/SECURITY.md](docs/SECURITY.md) | Security rules |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Multi-business data model |
| [docs/VIRTUAL_OFFICE.md](docs/VIRTUAL_OFFICE.md) | Isometric office rendering plan |
| [docs/LIVE_OFFICE.md](docs/LIVE_OFFICE.md) | Live office: event stream, animation state machine, replay and failures |
| [docs/AGENT_EVENTS.md](docs/AGENT_EVENTS.md) | Agent execution event contract |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Database, task API, state machine, durable execution |
| [docs/CHIEF_AI_MANAGER.md](docs/CHIEF_AI_MANAGER.md) | Chief AI Manager agent: objectives → plans, boundaries |
| [docs/RESEARCH_AGENT.md](docs/RESEARCH_AGENT.md) | Claude-powered Research Agent: setup, limits, credentials |
| [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md) | Knowledge vault, access rules, Obsidian sync design |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Cloud readiness |

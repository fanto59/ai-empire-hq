# AI EMPIRE HQ

A private, secure, expandable multi-business AI headquarters.

> **Status: foundation.** The app runs locally and shows the HQ structure. No
> model providers, business accounts, databases, or agents are connected, and
> no activity is simulated.

## Quick start

Requires Node.js 22 (see `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

Run every check before opening a pull request:

```bash
npm run check      # typecheck + lint + production build
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
| [docs/AGENT_EVENTS.md](docs/AGENT_EVENTS.md) | Agent execution event contract |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Cloud readiness |

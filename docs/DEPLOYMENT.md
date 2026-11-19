# Deployment Readiness

**The app is not deployed and must not be deployed publicly** until
authentication exists and the owner approves. This doc records how the
foundation stays cloud-ready.

## What makes it cloud-suitable

- `output: "standalone"` in `next.config.ts` produces `.next/standalone/`, a
  minimal Node server that runs in any container platform.
- Stateless server: no local files written at runtime; all config from env.
- `GET /api/health` for liveness/readiness probes.
- Security headers applied to every response.
- Runs with zero environment variables (everything defaults to disabled).

## Running the standalone build

```bash
npm ci
npm run build
cp -r .next/static .next/standalone/.next/static
# copy public/ too once it has assets:  cp -r public .next/standalone/public
PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

`npm start` (`next start`) also works for local production testing.

## Environment variables

See `.env.example`. Set real values only in the hosting platform's secret
manager, never in the repository.

## Before a real deployment (checklist)

- [ ] Authentication + authorization implemented and reviewed
- [ ] Private access only (VPN / IP allow-list / identity-aware proxy)
- [ ] Nonce-based CSP
- [ ] Persistence and backups chosen (free/self-hosted first)
- [ ] Owner explicitly approves the target platform and any costs

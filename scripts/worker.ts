/**
 * Standalone agent worker (Research Agent + Chief AI Manager), for use with a
 * real PostgreSQL server. With the embedded database (PGlite) only one
 * process may open it, so run the worker inside the web server instead
 * (AGENT_WORKER=in-process).
 *
 *   AGENT_EXECUTION_ENABLED=true PROVIDER_XAI_ENABLED=true AEHQ_XAI_API_KEY=... \
 *   DATABASE_URL=postgres://... npm run worker
 *
 * Each task runs on the one provider/model assigned to its agent (/models).
 */
import { hostname } from "node:os";
import { getProvider, PROVIDER_IDS } from "@/agents/providers/registry";
import { ResearchWorker, startResearchWorkerLoop } from "@/backend/execution/research-worker";
import { ChiefWorker } from "@/backend/execution/chief-worker";
import { getKnowledgeService } from "@/backend/knowledge";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { migrateDatabase, openDatabase } from "@/infrastructure/db/client";

const config = loadRuntimeConfig();
const ready = PROVIDER_IDS.filter((id) => getProvider(id).status().ready);
if (ready.length === 0) {
  console.error(`Worker not started: no model provider is ready. ${PROVIDER_IDS.map((id) => `${id}: ${getProvider(id).status().reason}`).join(" ")}`);
  process.exit(1);
}
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(config.databaseUrl);
if (handle.kind === "pglite") await migrateDatabase(handle);

const id = `${hostname().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 30)}-${process.pid}`;
const shared = { db: handle.db, knowledge: getKnowledgeService(), providers: getProvider, config: config.research };
const stops = [
  startResearchWorkerLoop(new ResearchWorker({ ...shared, workerId: `research-${id}` })),
  startResearchWorkerLoop(new ChiefWorker({ ...shared, workerId: `chief-${id}` })),
];
const stop = () => stops.forEach((s) => s());
console.log(`Agent workers running (providers ready: ${ready.join(", ")}). Press Ctrl+C to stop.`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stop();
    await handle.close();
    process.exit(0);
  });
}

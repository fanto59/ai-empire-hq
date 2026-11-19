/**
 * Standalone Research Agent worker, for use with a real PostgreSQL server.
 * With the embedded database (PGlite) only one process may open it, so run
 * the worker inside the web server instead (AGENT_WORKER=in-process).
 *
 *   AGENT_EXECUTION_ENABLED=true PROVIDER_ANTHROPIC_ENABLED=true \
 *   AEHQ_ANTHROPIC_API_KEY=... DATABASE_URL=postgres://... npm run worker
 */
import { hostname } from "node:os";
import { anthropicStatus, createAnthropicMessages } from "@/agents/providers/anthropic";
import { ResearchWorker, startResearchWorkerLoop } from "@/backend/execution/research-worker";
import { getKnowledgeService } from "@/backend/knowledge";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { migrateDatabase, openDatabase } from "@/infrastructure/db/client";

const config = loadRuntimeConfig();
const status = anthropicStatus();
if (!status.ready) {
  console.error(`Worker not started: ${status.reason}`);
  process.exit(1);
}
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(config.databaseUrl);
if (handle.kind === "pglite") await migrateDatabase(handle);

const worker = new ResearchWorker({
  db: handle.db,
  knowledge: getKnowledgeService(),
  messages: createAnthropicMessages,
  config: config.research,
  workerId: `worker-${hostname().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 30)}-${process.pid}`,
});
const stop = startResearchWorkerLoop(worker);
console.log(`Research worker running (model ${config.research.model}). Press Ctrl+C to stop.`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stop();
    await handle.close();
    process.exit(0);
  });
}

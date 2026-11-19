/** Node.js-only part of the start-up hook (see instrumentation.ts). */
export async function startInProcessWorker() {
  const { loadRuntimeConfig } = await import("@/infrastructure/config/env");
  const config = loadRuntimeConfig();
  if (config.workerMode !== "in-process") return;

  const { getProvider, PROVIDER_IDS } = await import("@/agents/providers/registry");
  const ready = PROVIDER_IDS.filter((id) => getProvider(id).status().ready);
  if (ready.length === 0) {
    console.warn(`[workers] not started: no model provider is ready (${getProvider("anthropic").status().reason})`);
    return;
  }
  const [{ getDatabase }, { getKnowledgeService }, { ResearchWorker, startResearchWorkerLoop }, { ChiefWorker }] = await Promise.all([
    import("@/backend/db"),
    import("@/backend/knowledge"),
    import("@/backend/execution/research-worker"),
    import("@/backend/execution/chief-worker"),
  ]);
  const db = await getDatabase();
  if (!db) {
    console.warn("[workers] not started: no database configured.");
    return;
  }
  const g = globalThis as unknown as { __aehqWorkerStop?: () => void };
  g.__aehqWorkerStop?.(); // dev hot reload: never run two loops
  const shared = { db, knowledge: getKnowledgeService(), providers: getProvider, config: config.research };
  const stopResearch = startResearchWorkerLoop(new ResearchWorker({ ...shared, workerId: `web-research-${process.pid}` }));
  const stopChief = startResearchWorkerLoop(new ChiefWorker({ ...shared, workerId: `web-chief-${process.pid}` }));
  g.__aehqWorkerStop = () => {
    stopResearch();
    stopChief();
  };
  console.log(`[workers] Research Agent and Chief AI Manager running in-process (providers ready: ${ready.join(", ")}).`);
}

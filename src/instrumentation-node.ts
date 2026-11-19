/** Node.js-only part of the start-up hook (see instrumentation.ts). */
export async function startInProcessWorker() {
  const { loadRuntimeConfig } = await import("@/infrastructure/config/env");
  const config = loadRuntimeConfig();
  if (config.workerMode !== "in-process") return;

  const { anthropicStatus, createAnthropicMessages } = await import("@/agents/providers/anthropic");
  const status = anthropicStatus();
  if (!status.ready) {
    console.warn(`[research-worker] not started: ${status.reason}`);
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
    console.warn("[research-worker] not started: no database configured.");
    return;
  }
  const g = globalThis as unknown as { __aehqWorkerStop?: () => void };
  g.__aehqWorkerStop?.(); // dev hot reload: never run two loops
  const shared = { db, knowledge: getKnowledgeService(), messages: createAnthropicMessages };
  const stopResearch = startResearchWorkerLoop(new ResearchWorker({ ...shared, config: config.research, workerId: `web-research-${process.pid}` }));
  const stopChief = startResearchWorkerLoop(new ChiefWorker({ ...shared, config: config.research, workerId: `web-chief-${process.pid}` }));
  g.__aehqWorkerStop = () => {
    stopResearch();
    stopChief();
  };
  console.log(`[workers] Research Agent and Chief AI Manager running in-process (model ${config.research.model}).`);
}

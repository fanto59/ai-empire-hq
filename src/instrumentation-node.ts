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
  const [{ getDatabase }, { getKnowledgeService }, { ResearchWorker, startResearchWorkerLoop }] = await Promise.all([
    import("@/backend/db"),
    import("@/backend/knowledge"),
    import("@/backend/execution/research-worker"),
  ]);
  const db = await getDatabase();
  if (!db) {
    console.warn("[research-worker] not started: no database configured.");
    return;
  }
  const g = globalThis as unknown as { __aehqWorkerStop?: () => void };
  g.__aehqWorkerStop?.(); // dev hot reload: never run two loops
  g.__aehqWorkerStop = startResearchWorkerLoop(
    new ResearchWorker({
      db,
      knowledge: getKnowledgeService(),
      messages: createAnthropicMessages,
      config: config.research,
      workerId: `web-${process.pid}`,
    }),
  );
  console.log(`[research-worker] running in-process (model ${config.research.model}).`);
}

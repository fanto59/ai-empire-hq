/**
 * Next.js server start-up hook. Starts the Research Agent worker inside the
 * web server when ALL of these are set (each defaults to off):
 *
 *   AGENT_WORKER=in-process
 *   AGENT_EXECUTION_ENABLED=true
 *   PROVIDER_ANTHROPIC_ENABLED=true
 *   AEHQ_ANTHROPIC_API_KEY=<the app's own Claude API key>
 *
 * In-process mode exists for the embedded database (one process only). With a
 * real PostgreSQL server, prefer the separate `npm run worker` process.
 */
export async function register() {
  // Next.js also compiles this file for the Edge runtime; keep Node-only
  // code (database, worker) in a module that only the Node runtime imports.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startInProcessWorker } = await import("./instrumentation-node");
    await startInProcessWorker();
  }
}

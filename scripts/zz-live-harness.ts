// SCRATCH verification harness (not committed): plays the worker side against a scratch DB.
import { promises as fs } from "node:fs";
import { and, eq } from "drizzle-orm";
import { createCompatProvider } from "@/agents/providers/openai-compatible";
import { ownerRequestContext } from "@/backend/auth/context";
import { ExecutionQueue } from "@/backend/execution/queue";
import { ResearchWorker } from "@/backend/execution/research-worker";
import { KnowledgeService } from "@/backend/knowledge";
import { createResearchTask } from "@/backend/tasks/research";
import { TaskService } from "@/backend/tasks/service";
import { openDatabase } from "@/infrastructure/db/client";
import { agents, businesses, organizations } from "@/infrastructure/db/schema";

const mode = process.argv[2];
const h = await openDatabase(process.env.DATABASE_URL!);
const db = h.db;
const [org] = await db.select().from(organizations).where(eq(organizations.slug, "test-org"));
const ctx = ownerRequestContext(org!.id);
const [bizA] = await db.select().from(businesses).where(and(eq(businesses.organizationId, org!.id), eq(businesses.slug, "test-business-a")));
const agent = async (slug: string) => (await db.select().from(agents).where(and(eq(agents.organizationId, org!.id), eq(agents.slug, slug))))[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = "https://en.wikipedia.org/wiki/Hubble_Space_Telescope";
const resp = (output: unknown[]) => ({ id: "r", model: "grok-4.7", status: "completed", output, usage: { input_tokens: 1800, output_tokens: 240, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }, incomplete_details: null, error: null });

if (mode === "research" || mode === "stall") {
  const { task } = await createResearchTask(db, ctx, { businessId: bizA!.id, question: "When was the Hubble Space Telescope launched, and what does it observe?" });
  console.log("task", task.id, task.state);
  if (mode === "research") {
    const script = [
      resp([
        { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", query: "Hubble Space Telescope launch", sources: [{ type: "url", url }] } },
        { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Found it.", annotations: [{ type: "url_citation", url, title: "Hubble", start_index: 0, end_index: 1 }] }] },
      ]),
      resp([{ type: "function_call", id: "fc1", call_id: "c1", name: "submit_report", status: "completed", arguments: JSON.stringify({ title: "Hubble Space Telescope overview", summary: "Hubble launched in 1990 aboard Discovery.", findings: [{ statement: "Hubble launched in April 1990.", confidence: "high", source_ids: [1] }], uncertainties: ["Instrument list changes after servicing missions."], sources: [{ id: 1, title: "Hubble Space Telescope", url }] }) }]),
    ];
    const xai = createCompatProvider("xai", { responses: () => ({ create: async () => (await sleep(Number(process.env.STEP_MS ?? 3000)), script.shift()) }) as never, status: () => ({ ready: true, keyConfigured: true, enabled: true, reason: "scripted" }) });
    await fs.mkdir(process.env.KNOWLEDGE_VAULT_DIR!, { recursive: true });
    const w = new ResearchWorker({ db, knowledge: new KnowledgeService({ root: process.env.KNOWLEDGE_VAULT_DIR! }), providers: () => xai, config: { effort: "medium", allowedDomains: ["wikipedia.org"], maxRunMicros: 1_000_000, maxSearches: 3, maxFetches: 1 }, workerId: "harness-worker" });
    await sleep(Number(process.env.START_DELAY_MS ?? 1500));
    console.log("tick", await w.tick());
  } else {
    // A worker that claims, reports a start and a step, then dies (no heartbeats).
    const q = new ExecutionQueue(db, { leaseMs: 4000 });
    await q.enqueueReady({ kinds: ["research"] });
    const c = (await q.claim("doomed-worker", { kinds: ["research"] }))!;
    await q.recordEvent(c.run.id, "doomed-worker", "run.started", { provider: "xai", model: "grok-4.7", trigger: "schedule", attempt: 1 });
    await sleep(1500);
    await q.recordEvent(c.run.id, "doomed-worker", "run.step", { stepIndex: 1, summary: "Model call 1 (then the worker process dies)" });
    console.log("worker died on run", c.run.id);
  }
} else if (mode === "reap") {
  console.log("reaped", await new ExecutionQueue(db).reapExpired());
} else if (mode === "approval") {
  const svc = new TaskService(db);
  const pm = await agent("test-pm");
  const { task } = await svc.createTask(ctx, { title: "Test: Weekly HQ summary for the owner", businessId: null, description: "Draft and send the weekly summary.", requiresApproval: true });
  await svc.transition(ctx, task.id, { action: "assign", agentId: pm.id });
  await svc.transition(ctx, task.id, { action: "start" });
  await sleep(1000);
  await svc.transition(ctx, task.id, { action: "wait", approval: { action: "Send the weekly summary", reason: "Owner sign-off required before sending" } });
  console.log("approval requested on", task.id);
}
await h.close();

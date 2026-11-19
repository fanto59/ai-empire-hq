import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { ModelAvailability } from "@/agents/providers/registry";
import { MODELS } from "@/agents/providers/catalog";
import { agentPermissions, agents, auditLogs, executionRuns, modelUsage, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { agentCtx, createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { listAgentModels, resolveAgentModel, setAgentModel } from "./assignment";
import { getModelEvaluation } from "./evaluation";

let tdb: TestDatabase;
let f: Fixture;
let n = 0;

/** Availability as if every provider's live list included exactly these models. */
const live = (ids: string[], unverified: string[] = []): Map<string, ModelAvailability> =>
  new Map(
    MODELS.map((m) => [
      m.id,
      {
        state: unverified.includes(m.provider) ? "unverified" : ids.includes(m.id) ? "available" : "unavailable",
        checkedAt: null,
        detail: "test",
      },
    ]),
  );

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  f = await createFixture(tdb.db, `models-org-${++n}`);
  await tdb.db.insert(agentPermissions).values([
    { agentId: f.agents.research, permission: "research.web_search", grantedBy: "test" },
    { agentId: f.agents.chief, permission: "org.read", grantedBy: "test" },
  ]);
});

test("initial assignments follow the work types: Claude engineering, OpenAI strategy, Grok research", async () => {
  const rows = await listAgentModels(tdb.db, f.orgId);
  const by = (id: string) => rows.find((r) => r.id === id)!;
  assert.deepEqual([by(f.agents.chief).provider, by(f.agents.chief).model, by(f.agents.chief).workType], ["openai", "gpt-6.2-sol", "strategy"]);
  assert.deepEqual([by(f.agents.research).provider, by(f.agents.research).model, by(f.agents.research).workType], ["xai", "grok-4.7", "research"]);
  assert.deepEqual([by(f.agents.ops).provider, by(f.agents.ops).workType], ["anthropic", "engineering"]);
  assert.ok(rows.every((r) => r.isDefault));
  assert.equal(by(f.agents.research).runsAutomatically, true);
  assert.equal(by(f.agents.ops).runsAutomatically, false);

  // A provider chosen without a valid model gets that provider's default model.
  const r = resolveAgentModel({ role: "specialist", modelProvider: "openai", modelName: "gpt-unknown" }, new Set());
  assert.deepEqual([r.provider, r.model, r.isDefault], ["openai", "gpt-6.2-sol", true]);
});

test("an administrator can reassign an agent; the change is stored, audited and verified live", async () => {
  const res = await setAgentModel(tdb.db, userCtx(f.orgId), { agentId: f.agents.chief, model: "claude-opus-5-5" }, { availability: live(["claude-opus-5-5"]) });
  assert.equal(res.verified, true);
  const [row] = await tdb.db.select().from(agents).where(eq(agents.id, f.agents.chief));
  assert.deepEqual([row!.modelProvider, row!.modelName], ["anthropic", "claude-opus-5-5"]);
  const [audit] = await tdb.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, f.agents.chief), eq(auditLogs.action, "agent.model.changed")));
  assert.deepEqual(audit!.metadata, { fromProvider: null, fromModel: null, toProvider: "anthropic", toModel: "claude-opus-5-5", verified: true });
  const listed = (await listAgentModels(tdb.db, f.orgId)).find((r) => r.id === f.agents.chief)!;
  assert.deepEqual([listed.provider, listed.model, listed.isDefault], ["anthropic", "claude-opus-5-5", false]);
});

test("a model the provider does not offer is refused; an unconfigured provider is saved as unverified", async () => {
  await assert.rejects(
    setAgentModel(tdb.db, userCtx(f.orgId), { agentId: f.agents.chief, model: "gpt-6.2-astra" }, { availability: live(["gpt-6.2-sol"]) }),
    /not offered to the app's openai key/,
  );
  const r = await setAgentModel(tdb.db, userCtx(f.orgId), { agentId: f.agents.chief, model: "grok-4.3" }, { availability: live([], ["xai"]) });
  assert.equal(r.verified, false);
});

test("only people with models:admin and organization-wide access can change models", async () => {
  const opts = { availability: live(["claude-opus-5-5"]) };
  const input = { agentId: f.agents.ops, model: "claude-opus-5-5" };
  await assert.rejects(setAgentModel(tdb.db, agentCtx(f.orgId, f.agents.chief, f.bizA), input, opts), /Only people/);
  await assert.rejects(setAgentModel(tdb.db, userCtx(f.orgId, { scopes: new Set(["tasks:read", "tasks:write"]) }), input, opts), /models:admin/);
  await assert.rejects(setAgentModel(tdb.db, userCtx(f.orgId, { businesses: [f.bizA] }), input, opts), /organization-wide/);
  // Other organization's agent, unknown/fallback-only models, research without web search.
  const other = await createFixture(tdb.db, `models-other-${n}`);
  await assert.rejects(setAgentModel(tdb.db, userCtx(f.orgId), { agentId: other.agents.ops, model: "claude-opus-5-5" }, opts), /not found/);
  await assert.rejects(setAgentModel(tdb.db, userCtx(f.orgId), { agentId: f.agents.ops, model: "claude-opus-4-8" }, opts), /catalog/);
  await assert.rejects(setAgentModel(tdb.db, userCtx(f.orgId), { agentId: f.agents.ops, model: "gpt-99" }, opts), /catalog/);
  await assert.rejects(
    setAgentModel(tdb.db, userCtx(f.orgId), { agentId: f.agents.research, model: "claude-haiku-5-5" }, { availability: live(["claude-haiku-5-5"]) }),
    /no web search/,
  );
  const [row] = await tdb.db.select().from(agents).where(eq(agents.id, f.agents.ops));
  assert.equal(row!.modelName, null, "nothing changed");
});

test("evaluation: real runs are grouped by the model that served them, with success rate and cost per completed task", async () => {
  const mkTask = async (kind: "research" | "executive") =>
    (await tdb.db.insert(tasks).values({ organizationId: f.orgId, businessId: kind === "research" ? f.bizA : null, title: "Test: eval", kind, createdByKind: "user", createdById: "t" }).returning())[0]!.id;
  const mkRun = async (taskId: string, status: "succeeded" | "failed", seconds: number, n: number) =>
    (
      await tdb.db
        .insert(executionRuns)
        .values({ taskId, attempt: n, status, idempotencyKey: `eval-${taskId}-${n}`, startedAt: new Date("2026-11-19T10:00:00Z"), finishedAt: new Date(Date.parse("2026-11-19T10:00:00Z") + seconds * 1000) })
        .returning()
    )[0]!.id;
  const use = (runId: string, provider: string, model: string, costMicros: number) =>
    tdb.db.insert(modelUsage).values({ organizationId: f.orgId, runId, provider, model, inputTokens: 100, outputTokens: 10, costMicros, recordedAt: new Date("2026-11-19T10:00:00Z") });

  const t1 = await mkTask("research");
  const r1 = await mkRun(t1, "succeeded", 60, 1);
  await use(r1, "xai", "grok-4.7", 10_000);
  await use(r1, "xai", "grok-4.7", 20_000);
  const t2 = await mkTask("research");
  const r2 = await mkRun(t2, "failed", 30, 1);
  await use(r2, "xai", "grok-4.7", 5_000);
  const t3 = await mkTask("executive");
  const r3 = await mkRun(t3, "succeeded", 120, 1);
  await use(r3, "anthropic", "claude-opus-5-5", 100_000);
  await use(r3, "anthropic", "claude-opus-5-5", 50_000);
  await use(r3, "anthropic", "claude-opus-4-8", 40_000); // one refusal-fallback call

  const rows = await getModelEvaluation(tdb.db, f.orgId, { now: new Date("2026-11-20T00:00:00Z") });
  const grok = rows.find((r) => r.model === "grok-4.7")!;
  assert.deepEqual(
    { runs: grok.runs, ok: grok.succeeded, failed: grok.failed, total: grok.totalCostMicros, perSuccess: grok.avgCostPerSuccessMicros, secs: grok.avgDurationSeconds, kind: grok.taskKind },
    { runs: 2, ok: 1, failed: 1, total: 35_000, perSuccess: 30_000, secs: 60, kind: "research" },
  );
  const opus = rows.find((r) => r.model === "claude-opus-5-5")!;
  assert.equal(opus.runs, 1);
  assert.equal(opus.totalCostMicros, 190_000, "the fallback call's cost counts toward the run");
  assert.equal(opus.avgCallsPerRun, 3);
  assert.equal(rows.length, 2, "runs are attributed to one model each");
  assert.deepEqual(await getModelEvaluation(tdb.db, (await createFixture(tdb.db, `models-empty-${n}`)).orgId), []);
});

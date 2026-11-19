import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { agentPermissions, agents, auditLogs, budgets, businesses, executionRuns, modelUsage, sectors, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { authenticate, createApiToken } from "../auth/api-tokens";
import { BudgetExceededError, SpendGuard, monthStart } from "../budgets/spend-guard";
import { TaskService } from "../tasks/service";
import { agentCtx, createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { canAssignAgent, canOwnProject, canTaskJoinProject } from "./rules";
import { getSectorReport, listSectorSummaries } from "./sector-report";
import { archiveBusiness, createAgent, createBusiness, createProject, provisionInitialStructure, restoreBusiness } from "./structure";

let tdb: TestDatabase;
let f: Fixture;
let n = 0;
const ids: Record<string, string> = {};

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  f = await createFixture(tdb.db, `org-${++n}`);
  await provisionInitialStructure(tdb.db, f.orgId);
  for (const s of await tdb.db.select().from(sectors).where(eq(sectors.organizationId, f.orgId))) ids[`sector:${s.slug}`] = s.id;
  for (const b of await tdb.db.select().from(businesses).where(eq(businesses.organizationId, f.orgId))) ids[b.slug] = b.id;
  for (const a of await tdb.db.select().from(agents).where(eq(agents.organizationId, f.orgId))) ids[`agent:${a.slug}`] = a.id;
});

// ---- pure rules -----------------------------------------------------------------------------

test("rules: business agents stay in their business, sector agents in their sector, HQ oversees", () => {
  const biz = (id: string, sectorId: string, status = "planning") => ({ id, sectorId, status });
  const xyz = biz("xyz", "night");
  const e305 = biz("305", "night");
  const shop = biz("shop", "ecom");
  const lead = { role: "business-lead", businessId: "xyz", sectorId: null };
  const manager = { role: "sector-manager", businessId: null, sectorId: "night" };
  const pm = { role: "central-project-manager", businessId: null, sectorId: null };
  const chief = { role: "chief-ai-manager", businessId: null, sectorId: null };
  assert.equal(canAssignAgent(lead, xyz).ok, true);
  assert.equal(canAssignAgent(lead, e305).ok, false, "businesses stay distinct, even in one sector");
  assert.equal(canAssignAgent(manager, e305).ok, true);
  assert.equal(canAssignAgent(manager, shop).ok, false, "a sector manager never works another sector");
  assert.equal(canAssignAgent(manager, null).ok, false);
  assert.equal(canAssignAgent(pm, shop).ok, true, "the Central PM coordinates work in any business");
  assert.equal(canAssignAgent(chief, shop).ok, false);
  assert.equal(canAssignAgent(chief, null).ok, true);
  assert.equal(canAssignAgent(lead, biz("xyz", "night", "archived")).ok, false);

  assert.equal(canTaskJoinProject({ businessId: "xyz", sectorId: null }, e305).ok, false);
  assert.equal(canTaskJoinProject({ businessId: null, sectorId: "night" }, e305).ok, true);
  assert.equal(canTaskJoinProject({ businessId: null, sectorId: "night" }, shop).ok, false);
  assert.equal(canTaskJoinProject({ businessId: null, sectorId: null }, shop).ok, true, "HQ projects are cross-sector");
  assert.equal(canOwnProject(manager, { businessId: null, sectorId: "night" }, null).ok, true);
  assert.equal(canOwnProject(manager, { businessId: null, sectorId: null }, null).ok, false);
  assert.equal(canOwnProject(pm, { businessId: null, sectorId: null }, null).ok, true);
});

// ---- provisioning -----------------------------------------------------------------------------

test("provisioning creates the six sectors, four distinct nightlife businesses and a manager per sector - once, with no work", async () => {
  const sectorRows = await tdb.db.select().from(sectors).where(eq(sectors.organizationId, f.orgId));
  for (const name of ["Nightlife & Entertainment", "E-Commerce", "Investments & Acquisitions", "Business Development", "Technology & Automation", "Shared Services"]) {
    assert.ok(sectorRows.some((s) => s.name === name), name);
  }
  const night = await tdb.db.select().from(businesses).where(eq(businesses.sectorId, ids["sector:nightlife-entertainment"]!));
  assert.deepEqual(night.map((b) => b.name).sort(), ["305 Events", "713 Society", "Party Street", "XYZ PARTYS"]);
  assert.equal(new Set(night.map((b) => b.id)).size, 4);
  const managers = await tdb.db.select().from(agents).where(and(eq(agents.organizationId, f.orgId), eq(agents.role, "sector-manager")));
  assert.equal(managers.length, 6);
  assert.ok(managers.every((m) => m.sectorId && !m.businessId && m.status === "active"));
  const perms = await tdb.db.select().from(agentPermissions).where(eq(agentPermissions.agentId, managers[0]!.id));
  assert.deepEqual(perms.map((p) => p.permission).sort(), ["approval.request", "knowledge.read", "task.execute", "task.read"], "no research or spending permissions");

  const again = await provisionInitialStructure(tdb.db, f.orgId);
  assert.deepEqual(again, { sectorsCreated: 0, businessesCreated: 0, managersCreated: 0 });
  const agentIds = managers.map((m) => m.id);
  const work = await tdb.db.select().from(tasks).where(eq(tasks.organizationId, f.orgId));
  assert.ok(work.every((t) => !t.assigneeAgentId || !agentIds.includes(t.assigneeAgentId)), "no tasks for new agents");
  assert.equal((await tdb.db.select().from(modelUsage).where(eq(modelUsage.organizationId, f.orgId))).length, 0);
});

// ---- add / archive -----------------------------------------------------------------------------

test("only administrators add businesses; names stay distinct; changes are audited", async () => {
  const input = { name: "Night Owl Club", sectorId: ids["sector:nightlife-entertainment"] };
  await assert.rejects(createBusiness(tdb.db, agentCtx(f.orgId, f.agents.research, f.bizA), input), /Only people/);
  await assert.rejects(createBusiness(tdb.db, userCtx(f.orgId, { scopes: new Set(["tasks:write"]) }), input), /businesses:admin/);
  await assert.rejects(createBusiness(tdb.db, userCtx(f.orgId, { businesses: [f.bizA] }), input), /organization-wide/);
  const b = await createBusiness(tdb.db, userCtx(f.orgId), input);
  assert.deepEqual([b.slug, b.status, b.sectorId], ["night-owl-club", "planning", ids["sector:nightlife-entertainment"]]);
  await assert.rejects(createBusiness(tdb.db, userCtx(f.orgId), { name: "xyz partys", sectorId: ids["sector:e-commerce"] }), /already exists/);
  await assert.rejects(createBusiness(tdb.db, userCtx(f.orgId), { name: "x", sectorId: ids["sector:e-commerce"] }), /2-80/);
  const [audit] = await tdb.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, b.id), eq(auditLogs.action, "business.created")));
  assert.ok(audit);
});

test("archiving: refused with open tasks; archived businesses take no new work; restore brings them back", async () => {
  const svc = new TaskService(tdb.db);
  const ctx = userCtx(f.orgId);
  const xyz = ids["xyz-partys"]!;
  const { task } = await svc.createTask(ctx, { title: "Test: plan launch night", businessId: xyz, description: "Test." });
  await assert.rejects(archiveBusiness(tdb.db, ctx, xyz), /open task/);
  await svc.transition(ctx, task.id, { action: "cancel", reason: "Test" });
  const archived = await archiveBusiness(tdb.db, ctx, xyz);
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
  await assert.rejects(svc.createTask(ctx, { title: "Test: more", businessId: xyz, description: "Test." }), /archived/);
  const restored = await restoreBusiness(tdb.db, ctx, xyz);
  assert.deepEqual([restored.status, restored.archivedAt], ["planning", null]);
  await svc.createTask(ctx, { title: "Test: after restore", businessId: xyz, description: "Test." });
});

// ---- agents, assignment and project rules through the real services ------------------------------

test("assignment rules are enforced by the task engine (sector manager, business lead, Central PM, Chief)", async () => {
  const svc = new TaskService(tdb.db);
  const ctx = userCtx(f.orgId);
  const lead = await createAgent(tdb.db, ctx, { name: "XYZ Lead", role: "business-lead", businessId: ids["xyz-partys"] });
  const manager = ids["agent:nightlife-entertainment-manager"]!;
  const mk = async (businessId: string | null) => (await svc.createTask(ctx, { title: "Test: work", businessId, description: "Test." })).task.id;
  const assign = (taskId: string, agentId: string) => svc.transition(ctx, taskId, { action: "assign", agentId });

  await assign(await mk(ids["xyz-partys"]!), lead.id);
  await assert.rejects(assign(await mk(ids["305-events"]!), lead.id), /distinct/);
  await assign(await mk(ids["305-events"]!), manager);
  await assign(await mk(ids["713-society"]!), manager);
  await assert.rejects(assign(await mk(f.bizA), manager), /own sector/, "Test Business A is not in Nightlife");
  await assign(await mk(ids["party-street"]!), f.agents.pm);
  await assert.rejects(assign(await mk(ids["party-street"]!), f.agents.chief), /Central Project Manager/);
  await assert.rejects(createAgent(tdb.db, ctx, { name: "Bad Manager", role: "sector-manager", businessId: ids["xyz-partys"] }), /sector manager works for a sector/);
  await assert.rejects(createAgent(tdb.db, agentCtx(f.orgId, f.agents.research, f.bizA), { name: "Sneaky", role: "specialist", sectorId: ids["sector:e-commerce"] }), /Only people/);
  // New agents get no work and no paid permissions.
  assert.equal((await tdb.db.select().from(tasks).where(eq(tasks.assigneeAgentId, lead.id))).length, 1, "only the task assigned above");
  assert.ok(!(await tdb.db.select().from(agentPermissions).where(eq(agentPermissions.agentId, lead.id))).some((p) => p.permission.startsWith("research.")));
});

test("cross-sector project rules: business, sector and headquarters projects", async () => {
  const svc = new TaskService(tdb.db);
  const ctx = userCtx(f.orgId);
  const night = ids["sector:nightlife-entertainment"]!;
  const bizProject = await createProject(tdb.db, ctx, { title: "XYZ summer series", businessId: ids["xyz-partys"] });
  const sectorProject = await createProject(tdb.db, ctx, { title: "Nightlife shared calendar", sectorId: night, ownerAgentId: ids["agent:nightlife-entertainment-manager"] });
  const hqProject = await createProject(tdb.db, ctx, { title: "Group brand refresh", ownerAgentId: f.agents.pm });
  const task = (businessId: string | null, projectId: string) => svc.createTask(ctx, { title: "Test: t", businessId, projectId, description: "Test." });

  await task(ids["xyz-partys"]!, bizProject.id);
  await assert.rejects(task(ids["305-events"]!, bizProject.id), /only that business/);
  await task(ids["305-events"]!, sectorProject.id);
  await assert.rejects(task(f.bizA, sectorProject.id), /its sector/);
  await task(f.bizA, hqProject.id);
  await task(ids["713-society"]!, hqProject.id);
  await assert.rejects(createProject(tdb.db, ctx, { title: "Wrong owner", ownerAgentId: ids["agent:nightlife-entertainment-manager"] }), /headquarters agents/);
  await assert.rejects(createProject(tdb.db, userCtx(f.orgId, { businesses: [f.bizA], hq: false }), { title: "No HQ access" }), /organization-wide/);
});

// ---- access & budgets -----------------------------------------------------------------------------

test("a sector agent's token reaches exactly its sector's businesses; a business agent's only its own", async () => {
  const manager = ids["agent:nightlife-entertainment-manager"]!;
  const { token } = await createApiToken(tdb.db, { organizationId: f.orgId, name: "m", principalKind: "agent", agentId: manager, scopes: ["tasks:read", "businesses:admin"] });
  const ctx = await authenticate(tdb.db, `Bearer ${token}`);
  assert.equal(ctx.hq, false);
  assert.deepEqual([...(ctx.businesses as string[])].sort(), [ids["305-events"], ids["713-society"], ids["party-street"], ids["xyz-partys"]].sort());
  assert.equal(ctx.scopes.has("businesses:admin"), false, "agents never get administrator scopes");
  const tasksSeen = await new TaskService(tdb.db).listTasks(ctx, {});
  assert.ok(tasksSeen.every((t) => t.businessId && (ctx.businesses as string[]).includes(t.businessId)));
});

test("sector budgets apply on top of organization and business budgets when set", async () => {
  const period = monthStart(new Date());
  const xyz = ids["xyz-partys"]!;
  const night = ids["sector:nightlife-entertainment"]!;
  await tdb.db.insert(budgets).values([
    { organizationId: f.orgId, periodStart: period, limitMicros: 1_000_000 },
    { organizationId: f.orgId, businessId: xyz, periodStart: period, limitMicros: 1_000_000 },
  ]);
  const guard = () => new SpendGuard(tdb.db, { organizationId: f.orgId, businessId: xyz, sectorId: night, agentId: null, runId: null, provider: "test", maxRunMicros: 1_000_000 });
  const r = await guard().reserve(10_000); // no sector budget: org + business only
  assert.ok(r);
  await tdb.db.insert(budgets).values({ organizationId: f.orgId, sectorId: night, periodStart: period, limitMicros: 5_000 });
  await assert.rejects(guard().reserve(10_000), (e: unknown) => e instanceof BudgetExceededError && /This sector/.test(e.message));
  // The organization budget row is unaffected by the sector row (scopes never mix).
  const [orgBudget] = await tdb.db.select().from(budgets).where(and(eq(budgets.organizationId, f.orgId), eq(budgets.limitMicros, 1_000_000), eq(budgets.businessId, xyz)));
  assert.equal(orgBudget!.spentMicros, 10_000);
});

test("sector reporting respects business-level access", async () => {
  const xyz = ids["xyz-partys"]!;
  await tdb.db.insert(modelUsage).values({ organizationId: f.orgId, businessId: xyz, provider: "test", model: "m", inputTokens: 1, outputTokens: 1, costMicros: 12_345 });
  const full = await getSectorReport(tdb.db, userCtx(f.orgId), "nightlife-entertainment");
  assert.ok(full);
  assert.equal(full.businesses.length, 4);
  assert.equal(full.fullAccess, true);
  assert.equal(full.sectorAgents[0]?.role, "sector-manager");
  assert.equal(full.totals.spendMonthMicros, 12_345);
  assert.ok(full.oversight.some((a) => a.role === "chief-ai-manager") && full.oversight.some((a) => a.role === "central-project-manager"));

  const limited = await getSectorReport(tdb.db, userCtx(f.orgId, { businesses: [xyz], hq: false }), "nightlife-entertainment");
  assert.deepEqual(limited?.businesses.map((b) => b.name), ["XYZ PARTYS"]);
  assert.equal(limited?.fullAccess, false);
  assert.deepEqual(limited?.sectorAgents, [], "sector-wide details need access to the whole sector");
  assert.equal(await getSectorReport(tdb.db, userCtx(f.orgId, { businesses: [xyz], hq: false }), "e-commerce"), null);
  const list = await listSectorSummaries(tdb.db, userCtx(f.orgId, { businesses: [xyz], hq: false }));
  assert.deepEqual(list.map((s) => s.slug), ["nightlife-entertainment"]);
  assert.equal((await listSectorSummaries(tdb.db, userCtx(f.orgId))).length >= 6, true);
  void executionRuns;
});

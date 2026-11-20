import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { NOT_FILLED, profileCompleteness } from "@/domain/business-starter";
import { agentPermissions, agents, auditLogs, businesses, departments, projects, tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { ServiceError } from "../errors";
import { KnowledgeService } from "../knowledge";
import { listAssignableAgents } from "../tasks/assignments";
import { createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { readBusinessProfile, saveBusinessProfile, setupBusinessStarter } from "./starter";
import { provisionInitialStructure } from "./structure";

let tdb: TestDatabase;
let knowledge: KnowledgeService;
let f: Fixture;
let xyz: string;
let n = 0;

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  knowledge = new KnowledgeService({ root: await fs.mkdtemp(path.join(os.tmpdir(), "aehq-starter-")) });
  f = await createFixture(tdb.db, `starter-org-${++n}`);
  await provisionInitialStructure(tdb.db, f.orgId);
  xyz = (await tdb.db.select().from(businesses).where(and(eq(businesses.organizationId, f.orgId), eq(businesses.slug, "xyz-partys"))))[0]!.id;
});

const owner = () => userCtx(f.orgId);

test("starter gives XYZ PARTYS departments, a lead, specialists, proposed projects and a blank profile - and no tasks", async () => {
  const r = await setupBusinessStarter(tdb.db, knowledge, owner(), xyz);
  assert.deepEqual(r, { departmentsCreated: 3, agentsCreated: 4, projectsCreated: 4, profileCreated: true });

  const depts = await tdb.db.select().from(departments).where(eq(departments.businessId, xyz));
  assert.deepEqual(depts.map((d) => d.name).sort(), ["Events & Bookings", "Marketing & Promotion", "Operations & Guest Experience"]);
  const team = await tdb.db.select().from(agents).where(eq(agents.businessId, xyz));
  assert.equal(team.filter((a) => a.role === "business-lead").length, 1);
  assert.equal(team.filter((a) => a.role === "specialist").length, 3);
  assert.ok(team.every((a) => a.status === "active"));
  const perms = await tdb.db.select().from(agentPermissions).where(eq(agentPermissions.agentId, team[0]!.id));
  assert.deepEqual(perms.map((p) => p.permission).sort(), ["approval.request", "knowledge.read", "knowledge.write", "task.execute", "task.read"], "no research, spending or org permissions");

  const projs = await tdb.db.select().from(projects).where(eq(projects.businessId, xyz));
  assert.equal(projs.length, 4);
  assert.ok(projs.every((p) => p.status === "proposed"));
  assert.equal((await tdb.db.select().from(tasks).where(eq(tasks.businessId, xyz))).length, 0, "nothing is assigned, so nothing runs or spends");

  const profile = await readBusinessProfile(knowledge, owner(), "xyz-partys");
  assert.ok(profile);
  assert.match(profile.body, /# XYZ PARTYS/);
  assert.ok(profile.body.includes(NOT_FILLED));
  assert.deepEqual(profileCompleteness(profile.body), { filled: 0, total: 8 }, "the template contains no invented facts");

  const caps = (await listAssignableAgents(tdb.db, f.orgId)).filter((a) => a.businessId === xyz);
  assert.ok(caps.every((a) => a.capability === "runs-work"));
  const [audit] = await tdb.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, xyz), eq(auditLogs.action, "business.starter_applied")));
  assert.ok(audit);
});

test("starter is idempotent and never overwrites the owner's profile", async () => {
  await setupBusinessStarter(tdb.db, knowledge, owner(), xyz);
  await saveBusinessProfile(tdb.db, knowledge, owner(), xyz, "# XYZ PARTYS\n\n## What the business does\nTest: owner-written text.");
  const again = await setupBusinessStarter(tdb.db, knowledge, owner(), xyz);
  assert.deepEqual(again, { departmentsCreated: 0, agentsCreated: 0, projectsCreated: 0, profileCreated: false });
  const profile = await readBusinessProfile(knowledge, owner(), "xyz-partys");
  assert.match(profile!.body, /owner-written text/);
  assert.deepEqual(profileCompleteness(profile!.body), { filled: 1, total: 1 });
});

test("other businesses stay untouched and separate", async () => {
  await setupBusinessStarter(tdb.db, knowledge, owner(), xyz);
  const e305 = (await tdb.db.select().from(businesses).where(and(eq(businesses.organizationId, f.orgId), eq(businesses.slug, "305-events"))))[0]!.id;
  assert.equal((await tdb.db.select().from(agents).where(eq(agents.businessId, e305))).length, 0);
  assert.equal(await readBusinessProfile(knowledge, owner(), "305-events"), null);
});

test("only people with businesses:admin can apply the starter or edit the profile; secrets are refused", async () => {
  const forbidden = (p: Promise<unknown>) => assert.rejects(p, (e: unknown) => e instanceof ServiceError && e.code === "forbidden");
  await forbidden(setupBusinessStarter(tdb.db, knowledge, userCtx(f.orgId, { scopes: new Set(["tasks:write"]) }), xyz));
  await forbidden(setupBusinessStarter(tdb.db, knowledge, { ...owner(), principal: { kind: "agent", id: "agent:x", agentId: f.agents.pm } }, xyz));
  await forbidden(saveBusinessProfile(tdb.db, knowledge, userCtx(f.orgId, { businesses: [xyz], hq: false }), xyz, "Some profile text here."));
  await assert.rejects(saveBusinessProfile(tdb.db, knowledge, owner(), xyz, "Our key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { agentPermissions, agents } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { ServiceError } from "../errors";
import { agentCtx, createFixture, userCtx, type Fixture } from "../testing/fixtures";
import { assignWork, listAssignableAgents } from "./assignments";

let tdb: TestDatabase;
let f: Fixture;
let n = 0;

before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});
beforeEach(async () => {
  f = await createFixture(tdb.db, `assign-org-${++n}`);
  await tdb.db.insert(agentPermissions).values([
    { agentId: f.agents.chief, permission: "org.read", grantedBy: "test" },
    { agentId: f.agents.research, permission: "research.web_search", grantedBy: "test" },
  ]);
});

const owner = () => userCtx(f.orgId);
const rejects = (p: Promise<unknown>, code: ServiceError["code"]) => assert.rejects(p, (e: unknown) => e instanceof ServiceError && e.code === code);

test("lists active agents with what they can do", async () => {
  const list = await listAssignableAgents(tdb.db, f.orgId);
  const cap = Object.fromEntries(list.map((a) => [a.slug, a.capability]));
  assert.equal(cap["test-chief"], "plans-objectives");
  assert.equal(cap["test-research"], "runs-research");
  assert.equal(cap["test-pm"], "tracked-only");
  assert.equal(cap["test-disabled"], undefined, "disabled agents are not offered");
});

test("assignments are routed by capability", async () => {
  const toChief = await assignWork(tdb.db, owner(), { agentId: f.agents.chief, instructions: "Review all projects and propose next steps." });
  assert.equal(toChief.task.kind, "executive");
  assert.equal(toChief.task.assigneeAgentId, f.agents.chief);

  const toResearch = await assignWork(tdb.db, owner(), { agentId: f.agents.research, instructions: "Find three facts about the Hubble Space Telescope." });
  assert.equal(toResearch.task.kind, "research");
  assert.equal(toResearch.task.businessId, f.bizA);
  assert.equal(toResearch.task.assigneeAgentId, f.agents.research);

  const toPm = await assignWork(tdb.db, owner(), { agentId: f.agents.pm, instructions: "Draft the weekly headquarters summary.", title: "Weekly summary" });
  assert.equal(toPm.task.kind, "general");
  assert.equal(toPm.task.businessId, null);
  assert.equal(toPm.task.state, "assigned");
  assert.equal(toPm.task.title, "Weekly summary");
  assert.match(toPm.note, /not run automatically/);

  const toOps = await assignWork(tdb.db, owner(), { agentId: f.agents.ops, instructions: "Prepare the onboarding checklist." });
  assert.equal(toOps.task.businessId, f.bizB, "business agents get work in their own business");
});

test("only signed-in people can assign; agents and bad input are refused", async () => {
  await rejects(assignWork(tdb.db, agentCtx(f.orgId, f.agents.chief, f.bizA), { agentId: f.agents.pm, instructions: "Do something important." }), "forbidden");
  await rejects(assignWork(tdb.db, owner(), { agentId: f.agents.pm, instructions: "short" }), "invalid-input");
  await rejects(assignWork(tdb.db, owner(), { agentId: f.agents.disabled, instructions: "Disabled agents get nothing." }), "invalid-input");
  await rejects(assignWork(tdb.db, owner(), { agentId: "not-a-uuid", instructions: "Bad id is refused." }), "invalid-input");
  const other = await createFixture(tdb.db, `assign-other-${n}`);
  await rejects(assignWork(tdb.db, owner(), { agentId: other.agents.pm, instructions: "Another organization's agent." }), "invalid-input");
  const readOnly = userCtx(f.orgId, { scopes: new Set(["tasks:read"]) });
  await rejects(assignWork(tdb.db, readOnly, { agentId: f.agents.pm, instructions: "Needs the write scope." }), "forbidden");
});

test("an agent without task.execute cannot be given tracked work", async () => {
  await rejects(assignWork(tdb.db, owner(), { agentId: f.agents.noPerm, instructions: "Agent without execute permission." }), "forbidden");
  const [a] = await tdb.db.select().from(agents).where(eq(agents.id, f.agents.noPerm));
  assert.equal(a!.status, "active");
});

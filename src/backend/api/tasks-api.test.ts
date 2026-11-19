import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { apiTokens } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { createApiToken, hashToken } from "../auth/api-tokens";
import { createFixture, type Fixture } from "../testing/fixtures";
import * as api from "./tasks-api";

let tdb: TestDatabase;
let f: Fixture;
let owner: string;
let bOnly: string;
let reader: string;
let agentToken: string;
const base = "http://localhost/api/v1";

before(async () => {
  tdb = await createTestDatabase();
  f = await createFixture(tdb.db, "api-test-org");
  const mk = (over: Partial<Parameters<typeof createApiToken>[1]>) =>
    createApiToken(tdb.db, {
      organizationId: f.orgId,
      name: "test",
      principalKind: "user",
      scopes: ["tasks:read", "tasks:write", "tasks:transition", "approvals:decide"],
      hqAccess: true,
      ...over,
    }).then((r) => r.token);
  owner = await mk({});
  bOnly = await mk({ businessIds: [f.bizB], hqAccess: false });
  reader = await mk({ scopes: ["tasks:read"] });
  agentToken = await mk({ principalKind: "agent", agentId: f.agents.research, scopes: ["tasks:read", "tasks:transition", "approvals:decide"] });
});
after(async () => {
  await tdb.close();
});

const deps = () => ({ db: tdb.db });
function req(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
async function call(res: Promise<Response>) {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Record<string, any>, headers: r.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("rejects missing, malformed, unknown, revoked and expired tokens with 401", async () => {
  const noToken = await call(api.listTasks(deps(), req("GET", "/tasks")));
  assert.equal(noToken.status, 401);
  assert.match(noToken.headers.get("www-authenticate") ?? "", /Bearer/);
  assert.equal((await call(api.listTasks(deps(), req("GET", "/tasks", "nope")))).status, 401);
  assert.equal((await call(api.listTasks(deps(), req("GET", "/tasks", `aehq_${"x".repeat(43)}`)))).status, 401);

  const { token: revoked } = await createApiToken(tdb.db, { organizationId: f.orgId, name: "r", principalKind: "user", scopes: ["tasks:read"] });
  await tdb.db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.tokenHash, hashToken(revoked)));
  assert.equal((await call(api.listTasks(deps(), req("GET", "/tasks", revoked)))).status, 401);

  const { token: expired } = await createApiToken(tdb.db, {
    organizationId: f.orgId,
    name: "e",
    principalKind: "user",
    scopes: ["tasks:read"],
    expiresAt: new Date(Date.now() - 1000),
  });
  assert.equal((await call(api.listTasks(deps(), req("GET", "/tasks", expired)))).status, 401);
});

test("tokens are stored hashed", async () => {
  const rows = await tdb.db.select().from(apiTokens);
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash) && !r.tokenHash.includes("aehq_")));
});

test("returns 503 when no database is configured", async () => {
  assert.equal((await call(api.listTasks({ db: null }, req("GET", "/tasks", owner)))).status, 503);
});

test("create → get → assign → start → complete over HTTP", async () => {
  const created = await call(api.createTask(deps(), req("POST", "/tasks", owner, { title: "Test: API task", businessId: f.bizA, priority: 2 })));
  assert.equal(created.status, 201);
  const id = created.body.task.id as string;
  assert.equal(created.body.task.state, "queued");

  const assigned = await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, owner, { action: "assign", agentId: f.agents.research }), id));
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.task.state, "assigned");

  // The assigned agent drives execution with its own token.
  const started = await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, agentToken, { action: "start" }), id));
  assert.equal(started.body.task.state, "running");
  const done = await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, agentToken, { action: "complete", result: "Test done" }), id));
  assert.equal(done.body.task.state, "completed");

  const detail = await call(api.getTask(deps(), req("GET", `/tasks/${id}`, reader), id));
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.history.map((h: { action: string }) => h.action), ["task.create", "task.assign", "task.start", "task.complete"]);
  assert.equal(detail.body.runs[0].status, "succeeded");

  const list = await call(api.listTasks(deps(), req("GET", "/tasks?state=completed", reader)));
  assert.ok(list.body.tasks.some((t: { id: string }) => t.id === id));
});

test("Idempotency-Key returns the original task with 200", async () => {
  const headers = { "idempotency-key": "test-idem-key-42" };
  const a = await call(api.createTask(deps(), req("POST", "/tasks", owner, { title: "Test: idem", businessId: f.bizA }, headers)));
  const b = await call(api.createTask(deps(), req("POST", "/tasks", owner, { title: "Test: idem", businessId: f.bizA }, headers)));
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(a.body.task.id, b.body.task.id);
});

test("validation errors are 400 with a clear message", async () => {
  const bad = await call(api.createTask(deps(), req("POST", "/tasks", owner, "{not json")));
  assert.equal(bad.status, 400);
  const noType = await call(api.createTask(deps(), new Request(`${base}/tasks`, { method: "POST", headers: { authorization: `Bearer ${owner}` }, body: "{}" })));
  assert.equal(noType.status, 400);
  const badTitle = await call(api.createTask(deps(), req("POST", "/tasks", owner, { title: "", businessId: f.bizA })));
  assert.equal(badTitle.status, 400);
  assert.match(badTitle.body.error.message, /title/);
  const huge = await call(api.createTask(deps(), req("POST", "/tasks", owner, { title: "x", businessId: f.bizA, description: "y".repeat(40_000) })));
  assert.equal(huge.status, 400);
});

test("invalid transitions are 409; other businesses' tasks are 404; missing scopes are 403", async () => {
  const created = await call(api.createTask(deps(), req("POST", "/tasks", owner, { title: "Test: guarded", businessId: f.bizA })));
  const id = created.body.task.id as string;
  const invalid = await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, owner, { action: "complete" }), id));
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.error.code, "invalid-transition");

  assert.equal((await call(api.getTask(deps(), req("GET", `/tasks/${id}`, bOnly), id))).status, 404);
  assert.equal((await call(api.getTask(deps(), req("GET", "/tasks/not-a-uuid", owner), "not-a-uuid"))).status, 404);
  assert.equal((await call(api.createTask(deps(), req("POST", "/tasks", reader, { title: "x", businessId: f.bizA })))).status, 403);
  const agentCancel = await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, agentToken, { action: "cancel" }), id));
  assert.equal(agentCancel.status, 403);
});

test("only people can decide approvals, even if an agent token claims the scope", async () => {
  const created = await call(api.createTask(deps(), req("POST", "/tasks", owner, { title: "Test: approval", businessId: f.bizA, requiresApproval: true })));
  const id = created.body.task.id as string;
  await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, owner, { action: "assign", agentId: f.agents.research }), id));
  await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, agentToken, { action: "start" }), id));
  await call(api.transitionTask(deps(), req("POST", `/tasks/${id}/transitions`, agentToken, { action: "wait", approval: { action: "Publish", reason: "Test" } }), id));
  const detail = await call(api.getTask(deps(), req("GET", `/tasks/${id}`, owner), id));
  const approvalId = detail.body.approvals[0].id as string;
  const byAgent = await call(api.decideApproval(deps(), req("POST", `/approvals/${approvalId}/decision`, agentToken, { decision: "approved" }), approvalId));
  assert.equal(byAgent.status, 403);
  const byOwner = await call(api.decideApproval(deps(), req("POST", `/approvals/${approvalId}/decision`, owner, { decision: "approved" }), approvalId));
  assert.equal(byOwner.status, 200);
});

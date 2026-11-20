import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TASK_STATES } from "@/domain/task-lifecycle";
import { tasks } from "@/infrastructure/db/schema";
import { createTestDatabase, type TestDatabase } from "@/infrastructure/db/test-database";
import { seedTestData } from "./seed";

let tdb: TestDatabase;
before(async () => {
  tdb = await createTestDatabase();
});
after(async () => {
  await tdb.close();
});

test("seed creates test data covering every task state, and refuses to run twice", async () => {
  const result = await seedTestData(tdb.db);
  const rows = await tdb.db.select({ state: tasks.state, title: tasks.title }).from(tasks);
  assert.equal(rows.length, result.tasks);
  assert.deepEqual([...new Set(rows.map((r) => r.state))].sort(), [...TASK_STATES].sort());
  assert.ok(rows.every((r) => r.title.startsWith("Test:")), "every seeded task is visibly test data");
  await assert.rejects(seedTestData(tdb.db), /already exists/);
});

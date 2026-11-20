import { randomBytes } from "node:crypto";
import { migrateDatabase, openDatabase, type DatabaseHandle } from "./client";

/**
 * Fresh, fully migrated database for one test file.
 *
 * - Default: in-memory PGlite (no server needed, fully isolated).
 * - With TEST_DATABASE_URL=postgres://... : a brand-new throwaway database
 *   is created on that server and dropped afterwards.
 *
 * Never point TEST_DATABASE_URL at a server holding real data: only the
 * throwaway databases it creates are touched.
 */
export interface TestDatabase extends DatabaseHandle {
  realPostgres: boolean;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    const handle = await openDatabase("pglite:memory");
    await migrateDatabase(handle);
    return { ...handle, realPostgres: false };
  }

  const { Client } = await import("pg");
  const name = `aehq_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const handle = await openDatabase(url.toString());
  await migrateDatabase(handle);
  return {
    ...handle,
    realPostgres: true,
    async close() {
      await handle.close();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

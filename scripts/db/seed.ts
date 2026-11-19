/**
 * Seeds the TEST organization (fictional data only). Run before `npm run dev`
 * when using the embedded database: two processes must not open the same
 * PGlite directory at once.
 */
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { describeDatabaseUrl, migrateDatabase, openDatabase } from "@/infrastructure/db/client";
import { seedTestData } from "@/backend/testing/seed";

const url = loadRuntimeConfig().databaseUrl;
if (!url) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(url);
try {
  await migrateDatabase(handle);
  const result = await seedTestData(handle.db);
  console.log(`Seeded test organization with ${result.tasks} tasks into ${describeDatabaseUrl(url)}.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await handle.close();
}

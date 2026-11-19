/** Applies pending migrations from ./drizzle to DATABASE_URL (or the embedded dev database). */
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { describeDatabaseUrl, migrateDatabase, openDatabase } from "@/infrastructure/db/client";

const url = loadRuntimeConfig().databaseUrl;
if (!url) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(url);
try {
  await migrateDatabase(handle);
  console.log(`Migrations applied to ${describeDatabaseUrl(url)}.`);
} finally {
  await handle.close();
}

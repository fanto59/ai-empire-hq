import { eq } from "drizzle-orm";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { describeDatabaseUrl, migrateDatabase, openDatabase, type DatabaseHandle, type Db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";

/**
 * Process-wide database handle for the Next.js server.
 *
 * - Embedded PGlite (local development) is migrated automatically on first use.
 * - A real PostgreSQL server is NOT migrated by the web app; run
 *   `npm run db:migrate` as a deliberate deployment step.
 * Returns null when no database is configured (pages show a setup notice,
 * the API answers 503).
 */
const globalForDb = globalThis as unknown as { __aehqDb?: Promise<DatabaseHandle | null> };

export async function getDatabase(): Promise<Db | null> {
  const url = loadRuntimeConfig().databaseUrl;
  if (!url) return null;
  globalForDb.__aehqDb ??= (async () => {
    try {
      const handle = await openDatabase(url);
      if (handle.kind === "pglite") await migrateDatabase(handle);
      return handle;
    } catch (e) {
      console.error(`[db] could not open ${describeDatabaseUrl(url)}:`, e instanceof Error ? e.message : e);
      globalForDb.__aehqDb = undefined;
      return null;
    }
  })();
  return (await globalForDb.__aehqDb)?.db ?? null;
}

export interface DashboardOrg {
  id: string;
  name: string;
  isTestData: boolean;
}

/** The organization the dashboard shows (AEHQ_ORGANIZATION, default "test-org"). */
export async function getDashboardOrganization(db: Db): Promise<DashboardOrg | null> {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, isTestData: organizations.isTestData })
    .from(organizations)
    .where(eq(organizations.slug, loadRuntimeConfig().organizationSlug));
  return org ?? null;
}

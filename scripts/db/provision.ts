/**
 * Adds the initial sector structure (six sectors, the Nightlife & Entertainment
 * businesses and one manager agent per sector) to an EXISTING database.
 * Idempotent: existing sectors, businesses and agents are left as they are.
 * Starts no tasks and no paid work.
 *
 *   npm run db:migrate && npm run org:provision
 */
import { eq } from "drizzle-orm";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { openDatabase } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { provisionInitialStructure } from "@/backend/org/structure";

const config = loadRuntimeConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(config.databaseUrl);
try {
  const [org] = await handle.db.select().from(organizations).where(eq(organizations.slug, config.organizationSlug));
  if (!org) throw new Error(`Organization "${config.organizationSlug}" not found. Run npm run db:seed first.`);
  const r = await provisionInitialStructure(handle.db, org.id);
  console.log(`Provisioned ${org.name}: ${r.sectorsCreated} sectors, ${r.businessesCreated} businesses, ${r.managersCreated} sector managers created (existing records kept).`);
} finally {
  await handle.close();
}

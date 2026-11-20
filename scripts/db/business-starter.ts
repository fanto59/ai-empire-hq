/**
 * Gives one business its starter team: departments, a Business Lead and
 * specialists, proposed projects, and a BLANK profile template to fill in.
 * Idempotent; never overwrites the profile; creates no tasks; spends nothing.
 *
 *   npm run business:starter -- --business xyz-partys
 */
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { ownerRequestContext } from "@/backend/auth/context";
import { getKnowledgeService } from "@/backend/knowledge";
import { setupBusinessStarter } from "@/backend/org/starter";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { openDatabase } from "@/infrastructure/db/client";
import { businesses, organizations } from "@/infrastructure/db/schema";

const { values } = parseArgs({ options: { business: { type: "string" } } });
if (!values.business) throw new Error("Usage: npm run business:starter -- --business <slug>");
const config = loadRuntimeConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(config.databaseUrl);
try {
  const [org] = await handle.db.select().from(organizations).where(eq(organizations.slug, config.organizationSlug));
  if (!org) throw new Error(`Organization "${config.organizationSlug}" not found. Run npm run db:setup first.`);
  const [b] = await handle.db.select().from(businesses).where(and(eq(businesses.organizationId, org.id), eq(businesses.slug, values.business)));
  if (!b) throw new Error(`Business "${values.business}" not found. Run npm run org:provision first.`);
  const ctx = { ...ownerRequestContext(org.id), principal: { kind: "user" as const, id: "owner-cli", agentId: null } };
  const r = await setupBusinessStarter(handle.db, getKnowledgeService(), ctx, b.id);
  console.log(
    `${b.name}: ${r.departmentsCreated} departments, ${r.agentsCreated} agents, ${r.projectsCreated} projects created; profile ${r.profileCreated ? "template created" : "kept as it was"}. No work was started.`,
  );
} finally {
  await handle.close();
}

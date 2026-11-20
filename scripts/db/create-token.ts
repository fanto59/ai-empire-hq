/**
 * Creates an API token for the TEST organization and prints it once.
 *
 *   npm run db:token -- --name "my laptop"                    (owner, all scopes)
 *   npm run db:token -- --name reader --scopes tasks:read
 *   npm run db:token -- --name lyra --agent test-research      (agent token)
 *
 * The plaintext is never stored; keep it out of git and chat.
 */
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { openDatabase } from "@/infrastructure/db/client";
import { agents, organizations } from "@/infrastructure/db/schema";
import { createApiToken } from "@/backend/auth/api-tokens";
import { API_SCOPES, type ApiScope } from "@/backend/auth/context";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "local test token" },
    scopes: { type: "string", default: API_SCOPES.join(",") },
    agent: { type: "string" },
    "expires-days": { type: "string", default: "30" },
  },
});
const config = loadRuntimeConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
const handle = await openDatabase(config.databaseUrl);
try {
  const [org] = await handle.db.select().from(organizations).where(eq(organizations.slug, config.organizationSlug));
  if (!org) throw new Error(`Organization "${config.organizationSlug}" not found. Run npm run db:seed first.`);
  if (!org.isTestData) throw new Error("Refusing: this script only creates tokens for test organizations.");
  let agentId: string | undefined;
  if (values.agent) {
    const [a] = await handle.db.select().from(agents).where(and(eq(agents.organizationId, org.id), eq(agents.slug, values.agent)));
    if (!a) throw new Error(`Agent "${values.agent}" not found.`);
    agentId = a.id;
  }
  const days = Number(values["expires-days"]);
  const { token } = await createApiToken(handle.db, {
    organizationId: org.id,
    name: values.name!,
    principalKind: agentId ? "agent" : "user",
    agentId,
    scopes: values.scopes!.split(",").map((s) => s.trim()) as ApiScope[],
    hqAccess: !agentId,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });
  console.log(`Token (shown once, expires in ${days} days):\n${token}`);
} finally {
  await handle.close();
}

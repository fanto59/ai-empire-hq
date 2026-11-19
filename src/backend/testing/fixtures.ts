import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents, businesses, organizations, projects, sectors } from "@/infrastructure/db/schema";
import { API_SCOPES, type ApiScope, type RequestContext } from "../auth/context";

/**
 * TEST DATA ONLY. Builds a tiny organization with two businesses and a few
 * agents. Used by unit tests and by the local seed script; never contains
 * real business information.
 */
export interface Fixture {
  orgId: string;
  sectorId: string;
  bizA: string;
  bizB: string;
  projectA: string;
  agents: { chief: string; pm: string; research: string; ops: string; disabled: string; noPerm: string };
}

export async function createFixture(db: Db, slug = "test-org"): Promise<Fixture> {
  const [org] = await db.insert(organizations).values({ slug, name: "Test Organization", isTestData: true }).returning();
  const [sector] = await db.insert(sectors).values({ organizationId: org!.id, slug: "test-research", name: "Test Research Sector" }).returning();
  const [a, b] = await db
    .insert(businesses)
    .values([
      { organizationId: org!.id, sectorId: sector!.id, slug: "test-business-a", name: "Test Business A", status: "active" },
      { organizationId: org!.id, sectorId: sector!.id, slug: "test-business-b", name: "Test Business B", status: "active" },
    ])
    .returning();
  const mk = (s: string, name: string, role: (typeof agents.$inferInsert)["role"], businessId: string | null, status: "active" | "disabled" = "active") => ({
    organizationId: org!.id,
    businessId,
    slug: s,
    displayName: name,
    role,
    status,
    modelProvider: null,
    modelName: null,
  });
  const rows = await db
    .insert(agents)
    .values([
      mk("test-chief", "Test Chief AI Manager", "chief-ai-manager", null),
      mk("test-pm", "Test Central PM", "central-project-manager", null),
      mk("test-research", "Test Research Agent", "specialist", a!.id),
      mk("test-ops", "Test Ops Agent", "specialist", b!.id),
      mk("test-disabled", "Test Disabled Agent", "specialist", a!.id, "disabled"),
      mk("test-no-perm", "Test Agent Without Permission", "specialist", a!.id),
    ])
    .returning();
  const id = (s: string) => rows.find((r) => r.slug === s)!.id;
  await db.insert(agentPermissions).values(
    ["test-chief", "test-pm", "test-research", "test-ops", "test-disabled"].flatMap((s) => [
      { agentId: id(s), permission: "task.execute" as const, grantedBy: "test-fixture" },
      { agentId: id(s), permission: "task.read" as const, grantedBy: "test-fixture" },
    ]),
  );
  const [project] = await db
    .insert(projects)
    .values({ organizationId: org!.id, businessId: a!.id, slug: "test-sector-discovery", title: "Test: Sector discovery", status: "active", ownerAgentId: id("test-research") })
    .returning();
  return {
    orgId: org!.id,
    sectorId: sector!.id,
    bizA: a!.id,
    bizB: b!.id,
    projectA: project!.id,
    agents: { chief: id("test-chief"), pm: id("test-pm"), research: id("test-research"), ops: id("test-ops"), disabled: id("test-disabled"), noPerm: id("test-no-perm") },
  };
}

export function userCtx(orgId: string, over: Partial<RequestContext> = {}): RequestContext {
  return {
    organizationId: orgId,
    principal: { kind: "user", id: "test-owner", agentId: null },
    businesses: "*",
    hq: true,
    scopes: new Set<ApiScope>(API_SCOPES),
    ...over,
  };
}

export function agentCtx(orgId: string, agentId: string, businessId: string): RequestContext {
  return {
    organizationId: orgId,
    principal: { kind: "agent", id: `agent:${agentId}`, agentId },
    businesses: [businessId],
    hq: false,
    scopes: new Set<ApiScope>(["tasks:read", "tasks:transition"]),
  };
}

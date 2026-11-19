import Link from "next/link";
import { getHqOverview } from "@/backend/services/hq-overview";
import { PROVIDER_LABELS } from "@/agents/providers/registry";
import { ROLE_DEFINITIONS } from "@/agents/roles/hq-roles";
import { EmptyState } from "@/frontend/components/EmptyState";
import { Panel } from "@/frontend/components/Panel";
import { RoleCard } from "@/frontend/components/RoleCard";
import { SystemStatus } from "@/frontend/components/SystemStatus";
import { OfficeViewport, buildOfficeScene } from "@/frontend/office";

// Runtime config is read per request (not baked in at build time).
export const dynamic = "force-dynamic";

export default async function HeadquartersPage() {
  const overview = await getHqOverview();
  const scene = buildOfficeScene({
    businesses: overview.businesses,
    agents: overview.hqAgents,
    // No execution runtime exists yet, so there are no real events and every
    // agent is shown as offline. Activity is never simulated.
    activity: new Map(),
  });
  const hqRoles = ROLE_DEFINITIONS.filter((r) => r.scope === "headquarters");

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-semibold tracking-[0.2em] text-indigo-400 uppercase">Foundation build</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">AI Empire HQ</h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          Private headquarters for independent AI-run business sectors. Nothing is connected yet: no
          model providers, no business accounts, and no agent activity.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Virtual office" subtitle="Static floor plan of headquarters data. No agents are configured yet.">
            <OfficeViewport scene={scene} />
            <Link
              href="/office"
              className="mt-4 flex items-center justify-between rounded-lg bg-sky-500/10 px-4 py-3 text-sm ring-1 ring-sky-400/25 transition hover:bg-sky-500/15"
            >
              <span>
                <span className="font-medium text-sky-200">Open the interactive Executive Floor</span>
                <span className="block text-xs text-slate-400">2.5D prototype with simulated characters (clearly labelled).</span>
              </span>
              <span aria-hidden className="text-sky-300">→</span>
            </Link>
          </Panel>

          <Panel title="Business sectors">
            {overview.businesses.length === 0 ? (
              <EmptyState title="No business sectors yet">
                Each business will get its own isolated wing, agents, projects and knowledge.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {overview.businesses.map((b) => (
                  <li key={b.id} className="text-slate-200">
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Headquarters leadership">
            <div className="space-y-3">
              {hqRoles.map((role) => (
                <RoleCard
                  key={role.role}
                  title={role.title}
                  responsibilities={role.responsibilities}
                  assigned={overview.hqAgents.some((a) => a.role === role.role)}
                />
              ))}
            </div>
          </Panel>

          <Panel title="System status">
            <SystemStatus
              appEnv={overview.appEnv}
              agentExecutionEnabled={overview.agentExecutionEnabled}
              providers={overview.providers.map((p) => ({ ...p, label: PROVIDER_LABELS[p.id] }))}
            />
          </Panel>

          <Panel title="Activity feed">
            <EmptyState title="No activity">
              Only real agent execution events will appear here.
            </EmptyState>
          </Panel>
        </div>
      </div>
    </main>
  );
}

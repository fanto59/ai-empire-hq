import Link from "next/link";
import { getHqOverview } from "@/backend/services/hq-overview";
import { PROVIDER_LABELS } from "@/agents/providers/registry";
import { ROLE_DEFINITIONS } from "@/agents/roles/hq-roles";
import { EmptyState } from "@/frontend/components/EmptyState";
import { Panel } from "@/frontend/components/Panel";
import { RoleCard } from "@/frontend/components/RoleCard";
import { SystemStatus } from "@/frontend/components/SystemStatus";
import { OfficeViewport, buildOfficeScene } from "@/frontend/office";
import { noteHref } from "@/frontend/knowledge/Markdown";
import { TASK_STATES } from "@/domain/task-lifecycle";
import { DatabaseSetupNotice, TaskStateBadge, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { KindBadge, SampleBadge, scopeLabel } from "@/frontend/knowledge/NoteBadges";

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

          <Panel title="Tasks" subtitle="Live records from the operational database.">
            {!overview.tasks ? (
              <DatabaseSetupNotice />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {overview.tasks.isTestData && <TestDataBadge />}
                  {TASK_STATES.map((s) => {
                    const n = overview.tasks!.items.filter((t) => t.state === s).length;
                    return n > 0 ? (
                      <Link key={s} href={`/tasks?state=${s}`} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
                        <TaskStateBadge state={s} />
                        <span className="tabular-nums">{n}</span>
                      </Link>
                    ) : null;
                  })}
                </div>
                <ul className="divide-y divide-slate-800">
                  {overview.tasks.items
                    .filter((t) => t.state !== "canceled" && t.state !== "completed")
                    .slice(0, 6)
                    .map((t) => (
                      <li key={t.id}>
                        <Link href={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:text-white">
                          <TaskStateBadge state={t.state} />
                          <span className="min-w-0 flex-1 text-slate-200">{t.title}</span>
                          <span className="text-xs text-slate-500">{t.assigneeName ?? "Unassigned"}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
                <Link href="/tasks" className="mt-3 inline-block text-sm text-sky-300 hover:text-sky-200">
                  All tasks →
                </Link>
              </>
            )}
          </Panel>

          <Panel title="Knowledge" subtitle={`${overview.knowledge.total} notes in the local vault · sync ${overview.knowledge.syncState}`}>
            {overview.knowledge.latestReport && (
              <Link
                href={noteHref(overview.knowledge.latestReport.path)}
                className="mb-4 block rounded-lg bg-slate-950/60 p-4 ring-1 ring-slate-800 transition hover:ring-sky-400/40"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold tracking-wider text-sky-400 uppercase">Latest research report</span>
                  {overview.knowledge.latestReport.meta.origin === "sample" && <SampleBadge />}
                </span>
                <span className="mt-1 block text-lg font-semibold text-white">{overview.knowledge.latestReport.meta.title}</span>
                <span className="mt-1 block text-xs text-slate-400">
                  {scopeLabel(overview.knowledge.latestReport.meta.business)}
                  {overview.knowledge.latestReport.meta.project ? ` · project ${overview.knowledge.latestReport.meta.project}` : ""}
                  {overview.knowledge.latestReport.meta.tasks.length > 0
                    ? ` · linked task ${overview.knowledge.latestReport.meta.tasks.join(", ")}`
                    : ""}
                </span>
              </Link>
            )}
            {overview.knowledge.recent.length === 0 ? (
              <EmptyState title="No notes yet">Run npm run knowledge:seed to create the sample vault.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-800">
                {overview.knowledge.recent.map((n) => (
                  <li key={n.path}>
                    <Link href={noteHref(n.path)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:text-white">
                      <KindBadge kind={n.meta.kind} />
                      <span className="min-w-0 flex-1 text-slate-200">{n.meta.title}</span>
                      <span className="text-xs text-slate-500">{scopeLabel(n.meta.business)}</span>
                      {n.meta.origin === "sample" && <SampleBadge />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/knowledge" className="mt-3 inline-block text-sm text-sky-300 hover:text-sky-200">
              Open the knowledge vault →
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

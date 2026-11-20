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
import { formatUsd } from "@/domain/money";
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

          <Panel title="API spending" subtitle="Model API costs (Claude, OpenAI, Grok) recorded for every agent call (UTC days).">
            {!overview.spending ? (
              <DatabaseSetupNotice />
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Today", formatUsd(overview.spending.todayMicros), `${overview.spending.callsToday} API call${overview.spending.callsToday === 1 ? "" : "s"}`],
                    ["This month", formatUsd(overview.spending.monthMicros), "so far"],
                    ["Month-end", formatUsd(overview.spending.projectedMonthMicros), "projection"],
                    [
                      "Monthly budget",
                      overview.spending.budget ? formatUsd(overview.spending.budget.limitMicros) : "Not set",
                      overview.spending.budget ? `${formatUsd(overview.spending.budget.spentMicros)} used` : "agents can't spend",
                    ],
                  ].map(([label, value, detail]) => (
                    <div key={label} className="rounded-lg bg-slate-950/60 p-3 ring-1 ring-slate-800">
                      <dt className="text-xs text-slate-400">{label}</dt>
                      <dd className="mt-0.5 text-lg font-semibold text-white tabular-nums">{value}</dd>
                      <dd className="text-[11px] text-slate-500">{detail}</dd>
                    </div>
                  ))}
                </dl>
                <Link href="/usage" className="mt-3 inline-block text-sm text-sky-300 hover:text-sky-200">
                  Daily spending, by agent and model →
                </Link>
              </>
            )}
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

          <Panel title="Business sectors" subtitle="Each sector has its own office, manager, businesses, projects and budget.">
            {!overview.sectors || overview.sectors.length === 0 ? (
              <EmptyState title="No business sectors yet">
                Run npm run org:provision to create the initial sectors.
              </EmptyState>
            ) : (
              <>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {overview.sectors.map((s) => (
                    <li key={s.id}>
                      <Link href={`/sectors/${s.slug}`} className="block rounded-lg bg-slate-950/60 p-3 ring-1 ring-slate-800 transition hover:ring-sky-400/40">
                        <span className="block font-medium text-slate-100">{s.name}</span>
                        <span className="block text-xs text-slate-400 tabular-nums">
                          {s.businessCount - s.archivedBusinesses} business{s.businessCount - s.archivedBusinesses === 1 ? "" : "es"} · {s.agentCount} agent{s.agentCount === 1 ? "" : "s"} · {s.openTasks} open task{s.openTasks === 1 ? "" : "s"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href="/sectors" className="mt-3 inline-block text-sm text-sky-300 hover:text-sky-200">
                  All sectors and their offices →
                </Link>
              </>
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

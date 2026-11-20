import type { Metadata } from "next";
import Link from "next/link";
import { formatUsd } from "@/domain/money";
import { ownerRequestContext } from "@/backend/auth/context";
import { getSessionContext } from "@/backend/auth/session";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { listAssignableAgents, type AgentCapability } from "@/backend/tasks/assignments";
import { loadTaskSummaries } from "@/backend/tasks/views";
import { getUsageReport } from "@/backend/usage/report";
import { AssignmentForm } from "@/frontend/tasks/AssignmentForm";
import { DatabaseSetupNotice, TaskStateBadge, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { assignWorkAction } from "./actions";

export const metadata: Metadata = { title: "Agents · AI Empire HQ" };
export const dynamic = "force-dynamic";

const CAPABILITY: Record<AgentCapability, { label: string; className: string }> = {
  "plans-objectives": { label: "Plans objectives", className: "bg-sky-500/10 text-sky-200 ring-sky-400/30" },
  "runs-research": { label: "Runs research", className: "bg-sky-500/10 text-sky-200 ring-sky-400/30" },
  "runs-work": { label: "Works on assignments", className: "bg-emerald-500/10 text-emerald-200 ring-emerald-400/30" },
  "tracked-only": { label: "Tracked only", className: "bg-slate-800 text-slate-300 ring-slate-700" },
};

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent: preselect } = await searchParams;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  if (!db || !org) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <DatabaseSetupNotice />
      </main>
    );
  }
  const [agents, tasks, usage, session] = await Promise.all([
    listAssignableAgents(db, org.id),
    loadTaskSummaries(db, ownerRequestContext(org.id), 500),
    getUsageReport(db, org.id),
    getSessionContext(db),
  ]);
  const spend = new Map(usage.byAgent.map((a) => [a.key, a.costMicros]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Organization</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">Agents</h1>
          {org.isTestData && <TestDataBadge />}
        </div>
        <p className="mt-2 max-w-2xl text-slate-400">
          Give any agent an assignment. The Chief AI Manager, Research Agents, sector managers, business leads and specialists run their work on the model chosen for them (see
          Models), within your budgets; headquarters coordinators keep it on their task list.
        </p>
      </header>

      <section aria-labelledby="assign-title" className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 id="assign-title" className="mb-3 text-sm font-semibold tracking-wide text-slate-100 uppercase">
          New assignment
        </h2>
        {session ? (
          <AssignmentForm
            key={preselect ?? "none"}
            action={assignWorkAction}
            defaultAgentId={agents.find((a) => a.slug === preselect)?.id}
            agents={agents.map((a) => ({
              id: a.id,
              label: `${a.displayName} · ${a.businessName ?? (a.sectorName ? `${a.sectorName} sector` : "Headquarters")}`,
              capability: a.capability,
              businesses: a.sectorId ? a.sectorBusinesses : undefined,
            }))}
          />
        ) : (
          <p className="text-sm text-slate-400">
            <Link href="/login" className="text-sky-300 hover:text-sky-200">
              Sign in
            </Link>{" "}
            to give assignments.
          </p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((a) => {
          const open = tasks.filter((t) => t.assigneeSlug === a.slug && !["completed", "canceled"].includes(t.state));
          return (
            <section key={a.id} className="flex min-w-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold text-white">{a.displayName}</h2>
                  <p className="text-xs text-slate-400">
                    {a.role.replace(/-/g, " ")} · {a.businessName ?? (a.sectorName ? `${a.sectorName} sector` : "Headquarters")}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] ring-1 ${CAPABILITY[a.capability].className}`}>{CAPABILITY[a.capability].label}</span>
              </div>
              <dl className="mt-3 flex gap-6 text-xs">
                <div>
                  <dt className="text-slate-500">API spend this month</dt>
                  <dd className="text-sm text-slate-100 tabular-nums">{formatUsd(spend.get(a.slug) ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Open tasks</dt>
                  <dd className="text-sm text-slate-100 tabular-nums">{open.length}</dd>
                </div>
              </dl>
              <ul className="mt-3 flex-1 space-y-1.5">
                {open.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <TaskStateBadge state={t.state} />
                    <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-slate-300 hover:text-white">
                      {t.title}
                    </Link>
                  </li>
                ))}
                {open.length === 0 && <li className="text-sm text-slate-500">No open tasks.</li>}
              </ul>
              {session && (
                <Link href={`/agents?agent=${a.slug}#assign-title`} className="mt-3 text-xs text-sky-300 hover:text-sky-200">
                  Give {a.displayName} an assignment →
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ownerRequestContext } from "@/backend/auth/context";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { listSectorSummaries } from "@/backend/org/sector-report";
import { formatUsd } from "@/domain/money";
import { DatabaseSetupNotice, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";

export const metadata: Metadata = { title: "Sectors · AI Empire HQ" };
export const dynamic = "force-dynamic";

export default async function SectorsPage() {
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  if (!db || !org) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <DatabaseSetupNotice />
      </main>
    );
  }
  const sectors = await listSectorSummaries(db, ownerRequestContext(org.id));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Organization</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">Business sectors</h1>
          {org.isTestData && <TestDataBadge />}
        </div>
        <p className="mt-2 max-w-2xl text-slate-400">
          Each sector has its own office, manager, businesses, projects and budget. The Chief AI Manager and the Central
          Project Manager oversee all of them from the <Link href="/office" className="text-sky-300 hover:text-sky-200">Executive Floor</Link>.
        </p>
      </header>

      {sectors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center">
          <p className="font-medium text-slate-200">No sectors yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Run <code className="text-slate-300">npm run org:provision</code> to create the initial sectors.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sectors.map((s) => (
            <li key={s.id} className="flex min-w-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="text-lg font-semibold text-white">{s.name}</h2>
              <p className="mt-1 text-sm text-slate-400">{s.description}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Businesses</dt>
                  <dd className="text-slate-100 tabular-nums">
                    {s.businessCount - s.archivedBusinesses}
                    {s.archivedBusinesses > 0 && <span className="text-xs text-slate-500"> (+{s.archivedBusinesses} archived)</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Agents</dt>
                  <dd className="text-slate-100 tabular-nums">{s.agentCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Open tasks</dt>
                  <dd className="text-slate-100 tabular-nums">{s.openTasks}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">API spend this month</dt>
                  <dd className="text-slate-100 tabular-nums">
                    {formatUsd(s.spendMonthMicros)}
                    {s.budget && <span className="text-xs text-slate-500"> of {formatUsd(s.budget.limitMicros)}</span>}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-slate-500">Manager: {s.managerName ?? "none yet"}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <Link href={`/sectors/${s.slug}`} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700">
                  Sector report
                </Link>
                <Link href={`/sectors/${s.slug}/office`} className="rounded-md bg-sky-500/15 px-3 py-1.5 text-sm text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-500/25">
                  Enter office →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

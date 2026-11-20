import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ownerRequestContext } from "@/backend/auth/context";
import { getSessionContext } from "@/backend/auth/session";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { getSectorReport } from "@/backend/org/sector-report";
import { formatUsd } from "@/domain/money";
import { BUSINESS_STATUS_LABELS, type BusinessStatus } from "@/domain/sectors";
import { AddAgentForm, AddBusinessForm, AddProjectForm, BusinessStatusButtons } from "@/frontend/sectors/AdminForms";
import { DatabaseSetupNotice, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { businessStatusAction, createAgentAction, createBusinessAction, createProjectAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return { title: `${(await params).slug.replace(/-/g, " ")} · Sectors · AI Empire HQ` };
}

const STATUS_CHIP: Record<string, string> = {
  planning: "bg-sky-950 text-sky-300 ring-sky-800",
  active: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  paused: "bg-amber-950 text-amber-300 ring-amber-800",
  archived: "bg-slate-900 text-slate-500 ring-slate-800",
};
const role = (r: string) => r.replace(/-/g, " ");

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  if (!db || !org) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <DatabaseSetupNotice />
      </main>
    );
  }
  const [report, session] = await Promise.all([getSectorReport(db, ownerRequestContext(org.id), slug), getSessionContext(db)]);
  if (!report) notFound();
  const isAdmin = Boolean(session && session.scopes.has("businesses:admin") && session.businesses === "*" && session.hq);
  const canPlan = Boolean(session?.scopes.has("tasks:write"));
  const live = report.businesses.filter((b) => b.status !== "archived");
  const archived = report.businesses.filter((b) => b.status === "archived");
  const scopeOptions = [{ value: `sector:${report.sector.id}`, label: `${report.sector.name} (sector-wide)` }, ...live.map((b) => ({ value: `business:${b.id}`, label: b.name }))];
  const owners = [
    ...report.sectorAgents.filter((a) => a.status === "active").map((a) => ({ id: a.id, name: a.name })),
    ...live.flatMap((b) => b.agents.map((a) => ({ id: a.id, name: `${a.name} (${b.name})` }))),
    ...report.oversight.map((a) => ({ id: a.id, name: `${a.name} (headquarters)` })),
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <nav className="mb-3 text-sm">
        <Link href="/sectors" className="text-sky-300 hover:text-sky-200">
          ← All sectors
        </Link>
      </nav>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Sector</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-white">{report.sector.name}</h1>
            {report.isTestData && <TestDataBadge />}
          </div>
          <p className="mt-2 max-w-2xl text-slate-400">{report.sector.description}</p>
        </div>
        <Link href={`/sectors/${slug}/office`} className="rounded-md bg-sky-500/15 px-4 py-2 text-sm text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-500/25">
          Enter the {report.sector.name} office →
        </Link>
      </header>

      <section aria-label="Sector totals" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Businesses", String(live.length), archived.length ? `${archived.length} archived` : "none archived"],
          ["Open tasks", String(report.totals.openTasks), `${report.totals.completedTasks} completed · ${report.totals.failedTasks} failed`],
          ["API spend this month", formatUsd(report.totals.spendMonthMicros), "recorded calls of this sector's businesses"],
          ["Sector budget", report.sectorBudget ? formatUsd(report.sectorBudget.limitMicros) : "None", report.sectorBudget ? `${formatUsd(report.sectorBudget.spentMicros)} used` : "only organization & business limits apply"],
          ["Agents", String(report.sectorAgents.length + live.reduce((n, b) => n + b.agents.length, 0)), `${report.sectorAgents.length} sector-level`],
        ].map(([label, value, detail]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-xl font-semibold text-white tabular-nums">{value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 lg:col-span-2" aria-labelledby="biz-title">
          <h2 id="biz-title" className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Businesses
          </h2>
          <p className="mt-1 text-xs text-slate-400">Each business is separate: its own agents, tasks, budget and knowledge.</p>
          {report.businesses.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No businesses in this sector yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {[...live, ...archived].map((b) => (
                <li key={b.id} className={`py-3 ${b.status === "archived" ? "opacity-70" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-100">{b.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${STATUS_CHIP[b.status]}`}>{BUSINESS_STATUS_LABELS[b.status as BusinessStatus] ?? b.status}</span>
                  </div>
                  {b.description && <p className="mt-0.5 text-xs text-slate-400">{b.description}</p>}
                  <p className="mt-1 text-xs text-slate-500 tabular-nums">
                    {b.agents.length} agent{b.agents.length === 1 ? "" : "s"} · {b.openTasks} open task{b.openTasks === 1 ? "" : "s"} · {formatUsd(b.spendMonthMicros)} this month
                    {b.budget ? ` of ${formatUsd(b.budget.limitMicros)} budget` : " · no budget (no API spending)"}
                  </p>
                  {isAdmin && (
                    <div className="mt-2">
                      <BusinessStatusButtons businessId={b.id} name={b.name} status={b.status} action={businessStatusAction} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isAdmin ? (
            <div className="mt-4 border-t border-slate-800 pt-4">
              <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">Add a business</h3>
              <AddBusinessForm sectorId={report.sector.id} sectorName={report.sector.name} action={createBusinessAction} />
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">
              {session ? "Your token can't add or archive businesses (needs businesses:admin)." : <><Link href="/login" className="text-sky-300">Sign in</Link> as an administrator to add or archive businesses.</>}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5" aria-labelledby="people-title">
          <h2 id="people-title" className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Agents
          </h2>
          <h3 className="mt-3 text-xs font-semibold text-slate-400">Sector team</h3>
          {report.sectorAgents.length === 0 ? (
            <p className="text-sm text-slate-500">No sector manager yet.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {report.sectorAgents.map((a) => (
                <li key={a.id} className="text-slate-200">
                  {a.name} <span className="text-xs text-slate-500">· {role(a.role)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-3 text-xs font-semibold text-slate-400">Business teams</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {live.map((b) => (
              <li key={b.id} className="text-slate-300">
                <span className="text-slate-400">{b.name}:</span> {b.agents.length ? b.agents.map((a) => a.name).join(", ") : <span className="text-slate-500">no agents yet</span>}
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-xs font-semibold text-slate-400">Oversight (headquarters)</h3>
          <p className="text-sm text-slate-300">{report.oversight.map((a) => a.name).join(", ") || "None"}</p>
          <p className="mt-3 text-xs text-slate-500">
            Assign work on the <Link href="/agents" className="text-sky-300 hover:text-sky-200">Agents</Link> page. Rules: business agents work only on their
            business; the sector team works across this sector; the Central Project Manager coordinates across sectors.
          </p>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5" aria-labelledby="proj-title">
        <h2 id="proj-title" className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
          Projects
        </h2>
        {report.projects.length === 0 && report.crossSectorProjects.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No projects yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-800 text-sm">
            {report.projects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-slate-100">{p.title}</span>
                <span className="text-xs text-slate-500">{p.scope === "sector" ? "sector-wide" : p.businessName}</span>
                <span className="text-xs text-slate-500">· {p.status}</span>
                {p.ownerName && <span className="text-xs text-slate-500">· lead {p.ownerName}</span>}
                <span className="ml-auto text-xs text-slate-400 tabular-nums">{p.openTasks} open</span>
              </li>
            ))}
            {report.crossSectorProjects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-slate-100">{p.title}</span>
                <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-200 ring-1 ring-violet-400/30">cross-sector</span>
                <span className="ml-auto text-xs text-slate-400 tabular-nums">{p.tasksHere} tasks here</span>
              </li>
            ))}
          </ul>
        )}
        {canPlan && (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">New project</h3>
            <AddProjectForm scopes={[...scopeOptions, { value: "hq:", label: "Headquarters (cross-sector)" }]} owners={owners} action={createProjectAction} />
            <p className="mt-1 text-xs text-slate-500">
              Business projects take that business&apos;s tasks; sector projects any business of this sector; headquarters projects any sector.
            </p>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5" aria-labelledby="agent-title">
          <h2 id="agent-title" className="mb-2 text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Add an agent
          </h2>
          <AddAgentForm scopes={scopeOptions} action={createAgentAction} />
        </section>
      )}
    </main>
  );
}

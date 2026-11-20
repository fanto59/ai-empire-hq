import type { Metadata } from "next";
import Link from "next/link";
import { formatUsd } from "@/domain/money";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { getUsageReport, type UsageBreakdownRow } from "@/backend/usage/report";
import { DatabaseSetupNotice, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { DailySpendChart } from "@/frontend/usage/DailySpendChart";

export const metadata: Metadata = { title: "API usage · AI Empire HQ" };
export const dynamic = "force-dynamic";

const usd = formatUsd;
const calls = (n: number) => `${int(n)} API call${n === 1 ? "" : "s"}`;
const int = (n: number) => n.toLocaleString("en-US");

export default async function UsagePage() {
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  const report = db && org ? await getUsageReport(db, org.id) : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Operations</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">API usage &amp; spending</h1>
          {org?.isTestData && <TestDataBadge />}
        </div>
        <p className="mt-2 max-w-2xl text-slate-400">
          Every model API call your agents make (Claude, OpenAI or Grok) is recorded with its tokens and cost. Days are in UTC. Hosting and other
          costs are not tracked here; this is the AI spend of running the empire.
        </p>
      </header>

      {!report ? (
        <DatabaseSetupNotice />
      ) : (
        <div className="space-y-6">
          <section aria-label="Spending summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Today" value={usd(report.today.costMicros)} detail={calls(report.today.calls)} />
            <Stat label="This month" value={usd(report.month.costMicros)} detail={calls(report.month.calls)} />
            <Stat label="Average per day" value={usd(report.averagePerDayMicros)} detail={`this month, ${report.dayOfMonth} days`} />
            <Stat label="Month-end projection" value={usd(report.projectedMonthMicros)} detail="estimate at the current pace" />
            <Stat label="All time" value={usd(report.allTime.costMicros)} detail={`${int(report.allTime.inputTokens + report.allTime.outputTokens)} tokens`} />
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">Budgets this month</h2>
            {report.budgets.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">
                No budgets are set, so agents cannot spend anything. Set one with <code className="text-slate-300">npm run budget:set -- --usd 2</code>.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {report.budgets.map((b) => {
                  const pct = b.limitMicros > 0 ? Math.min(100, (b.spentMicros / b.limitMicros) * 100) : 100;
                  const status =
                    b.limitMicros === 0
                      ? { bar: "bg-slate-700", text: "No budget: agents can't spend", tone: "text-slate-400" }
                      : pct >= 100
                        ? { bar: "bg-red-500", text: "Limit reached: agents stop", tone: "text-red-300" }
                        : pct >= 80
                          ? { bar: "bg-amber-400", text: "Over 80% used", tone: "text-amber-300" }
                          : null;
                  return (
                    <li key={b.scope}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span className="text-slate-200">{b.scope}</span>
                        <span className="text-slate-400 tabular-nums">
                          {usd(b.spentMicros)} of {usd(b.limitMicros)}
                          {status && <span className={`ml-2 text-xs ${status.tone}`}>· {status.text}</span>}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${b.scope} budget used`}>
                        <div className={`h-full rounded-full ${status?.bar ?? "bg-[#2b9be0]"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">Daily API spend · last 30 days</h2>
              <span className="text-xs text-slate-500">Hover a day for details</span>
            </div>
            {report.allTime.calls === 0 && <p className="mb-2 text-sm text-slate-400">No API calls yet. Spending appears here as soon as an agent runs.</p>}
            <DailySpendChart data={report.daily} />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <Breakdown title="By agent · this month" rows={report.byAgent} />
            <Breakdown title="By model · this month" rows={report.byModel} />
            <Breakdown title="By business · this month" rows={report.byBusiness} />
          </div>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">Recent API calls</h2>
            {report.recent.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">None yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm tabular-nums">
                  <thead className="text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="py-1.5 pr-3 font-semibold">Time (UTC)</th>
                      <th className="py-1.5 pr-3 font-semibold">Agent</th>
                      <th className="py-1.5 pr-3 font-semibold">Model</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Tokens in / out</th>
                      <th className="py-1.5 text-right font-semibold">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {report.recent.map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-3 font-mono text-xs">{r.at.slice(0, 16).replace("T", " ")}</td>
                        <td className="py-1.5 pr-3">
                          {r.taskId ? (
                            <Link href={`/tasks/${r.taskId}`} className="hover:text-sky-300">
                              {r.agent}
                            </Link>
                          ) : (
                            r.agent
                          )}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs">{r.model}</td>
                        <td className="py-1.5 pr-3 text-right">
                          {int(r.inputTokens)} / {int(r.outputTokens)}
                        </td>
                        <td className="py-1.5 text-right text-slate-100">{usd(r.costMicros)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: UsageBreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.costMicros));
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No usage this month.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.key} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-slate-200">{r.label}</span>
                <span className="text-slate-100 tabular-nums">{usd(r.costMicros)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-[#2b9be0]" style={{ width: `${(r.costMicros / max) * 100}%` }} />
              </div>
              <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                {calls(r.calls)} · {int(r.inputTokens)} in / {int(r.outputTokens)} out tokens
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

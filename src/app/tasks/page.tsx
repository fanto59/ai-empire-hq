import type { Metadata } from "next";
import Link from "next/link";
import { ownerRequestContext } from "@/backend/auth/context";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { loadTaskSummaries } from "@/backend/tasks/views";
import { TASK_STATES, type TaskState } from "@/domain/task-lifecycle";
import { TASK_STATE_LABELS } from "@/domain/task-view";
import { DatabaseSetupNotice, TaskStateBadge, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { getSessionContext } from "@/backend/auth/session";
import { getResearchStatus } from "@/backend/tasks/research-status";
import { formatUsd } from "@/agents/research/pricing";
import { ResearchForm } from "@/frontend/tasks/ResearchForm";
import { AutoRefresh } from "@/frontend/tasks/AutoRefresh";
import { signOutAction } from "../login/actions";
import { createResearchTaskAction } from "./actions";

export const metadata: Metadata = { title: "Tasks · AI Empire HQ" };
export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const filter = TASK_STATES.includes(state as TaskState) ? (state as TaskState) : undefined;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  const all = db && org ? await loadTaskSummaries(db, ownerRequestContext(org.id), 500) : null;
  const research = db && org ? await getResearchStatus(db, org.id) : null;
  const session = db ? await getSessionContext(db) : null;
  const active = (all ?? []).some((t) => ["queued", "assigned", "running"].includes(t.state));
  const shown = all?.filter((t) => !filter || t.state === filter) ?? [];
  const counts = new Map<TaskState, number>();
  for (const t of all ?? []) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Operations</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">Tasks</h1>
          {org?.isTestData && <TestDataBadge />}
        </div>
        <p className="mt-2 max-w-2xl text-slate-400">
          Task records from the operational database. Changes go through the authenticated API (
          <code className="text-slate-300">/api/v1/tasks</code>), which enforces the task state machine.
        </p>
      </header>

      {!all ? (
        <DatabaseSetupNotice />
      ) : (
        <>
          <AutoRefresh active={active} intervalMs={5_000} />
          {research && (
            <section aria-labelledby="research-title" className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="research-title" className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
                    Research Agent
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Claude ({research.model}) with read-only web search on approved sites: {research.allowedDomains.join(", ")}.
                    Cap per attempt {formatUsd(research.maxRunMicros)}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2.5 py-0.5 ring-1 ${research.providerReady ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" : "bg-amber-500/10 text-amber-200 ring-amber-500/30"}`}>
                    {research.providerReady ? "Claude API key configured" : "Claude API not configured"}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 ring-1 ${research.workerMode === "in-process" ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" : "bg-slate-800 text-slate-300 ring-slate-700"}`}>
                    Worker: {research.workerMode === "in-process" ? "running in this server" : "separate process / off"}
                  </span>
                </div>
              </div>
              {!research.providerReady && <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-100 ring-1 ring-amber-500/25">{research.providerReason} Tasks will wait in the queue until it is configured.</p>}
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                {research.budgets.map((b) => (
                  <div key={b.scope} className="flex gap-1.5">
                    <dt className="text-slate-500">{b.scope} budget (this month)</dt>
                    <dd className={`tabular-nums ${b.spentMicros >= b.limitMicros ? "text-red-300" : "text-slate-300"}`}>
                      {formatUsd(b.spentMicros)} / {formatUsd(b.limitMicros)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 border-t border-slate-800 pt-4">
                {session ? (
                  <>
                    <ResearchForm action={createResearchTaskAction} businesses={research.businesses} />
                    <form action={signOutAction} className="mt-3">
                      <button type="submit" className="text-xs text-slate-500 hover:text-slate-300">
                        Sign out
                      </button>
                    </form>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    <Link href="/login" className="text-sky-300 hover:text-sky-200">
                      Sign in
                    </Link>{" "}
                    to create research tasks.
                  </p>
                )}
              </div>
            </section>
          )}
          <nav aria-label="Filter by state" className="mb-4 flex flex-wrap gap-1.5">
            <FilterLink href="/tasks" active={!filter} label={`All ${all.length}`} />
            {TASK_STATES.map((s) => (
              <FilterLink key={s} href={`/tasks?state=${s}`} active={filter === s} label={`${TASK_STATE_LABELS[s]} ${counts.get(s) ?? 0}`} />
            ))}
          </nav>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-900 text-xs tracking-wide text-slate-400 uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Task</th>
                  <th className="px-4 py-2.5 font-semibold">State</th>
                  <th className="px-4 py-2.5 font-semibold">Scope</th>
                  <th className="px-4 py-2.5 font-semibold">Assignee</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Attempts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                {shown.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-900/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/tasks/${t.id}`} className="font-medium text-slate-100 hover:text-sky-300">
                        {t.title}
                      </Link>
                      {t.projectTitle && <span className="block text-xs text-slate-500">{t.projectTitle}</span>}
                      {t.state === "failed" && t.lastError && <span className="mt-0.5 block max-w-xl truncate text-xs text-red-300">{t.lastError}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <TaskStateBadge state={t.state} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{t.businessName ?? "Headquarters"}</td>
                    <td className="px-4 py-2.5 text-slate-300">{t.assigneeName ?? <span className="text-slate-500">Unassigned</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">
                      {t.attempt}/{t.maxAttempts}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      No tasks in this state.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-xs ring-1 ${active ? "bg-sky-500/15 text-sky-200 ring-sky-400/40" : "text-slate-400 ring-slate-800 hover:text-slate-200"}`}
    >
      {label}
    </Link>
  );
}

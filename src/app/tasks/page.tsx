import type { Metadata } from "next";
import Link from "next/link";
import { ownerRequestContext } from "@/backend/auth/context";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { loadTaskSummaries } from "@/backend/tasks/views";
import { TASK_STATES, type TaskState } from "@/domain/task-lifecycle";
import { TASK_STATE_LABELS } from "@/domain/task-view";
import { DatabaseSetupNotice, TaskStateBadge, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";

export const metadata: Metadata = { title: "Tasks · AI Empire HQ" };
export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const filter = TASK_STATES.includes(state as TaskState) ? (state as TaskState) : undefined;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  const all = db && org ? await loadTaskSummaries(db, ownerRequestContext(org.id), 500) : null;
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

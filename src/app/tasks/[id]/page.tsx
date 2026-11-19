import type { Metadata } from "next";
import Link from "next/link";
import { ownerRequestContext } from "@/backend/auth/context";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import { TaskService, type TaskDetail } from "@/backend/tasks/service";
import { DatabaseSetupNotice, TaskStateBadge, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { formatUsd } from "@/domain/money";
import { noteHref } from "@/frontend/knowledge/Markdown";
import { AutoRefresh } from "@/frontend/tasks/AutoRefresh";
import { PlanView, type PlanData } from "@/frontend/tasks/PlanView";

export const metadata: Metadata = { title: "Task · AI Empire HQ" };
export const dynamic = "force-dynamic";

const fmt = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  let detail: TaskDetail | null = null;
  let error = "";
  if (db && org) {
    try {
      detail = await new TaskService(db).getTask(ownerRequestContext(org.id), id);
    } catch (e) {
      error = e instanceof ServiceError ? e.message : "The task could not be loaded.";
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/tasks" className="text-sm text-sky-300 hover:text-sky-200">
        ← Tasks
      </Link>
      {!db || !org ? (
        <div className="mt-6">
          <DatabaseSetupNotice />
        </div>
      ) : !detail ? (
        <p className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-slate-300">{error}</p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <AutoRefresh active={["queued", "assigned", "running"].includes(detail.task.state)} />
          <div className="min-w-0 space-y-6">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <TaskStateBadge state={detail.task.state} />
                {org.isTestData && <TestDataBadge />}
                {detail.task.requiresApproval && (
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300 ring-1 ring-slate-700">Approval required</span>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-semibold text-white">{detail.task.title}</h1>
              {detail.task.description && <p className="mt-2 text-slate-400">{detail.task.description}</p>}
              {detail.task.lastError && (
                <p role="alert" className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/25">
                  {detail.task.state === "failed" ? "Failed" : "Last error"}: {detail.task.lastError}
                </p>
              )}
              {detail.documents.map((d) => (
                <Link
                  key={d.vaultPath}
                  href={noteHref(d.vaultPath)}
                  className="mt-4 flex items-center justify-between rounded-lg bg-sky-500/10 px-4 py-3 text-sm ring-1 ring-sky-400/25 hover:bg-sky-500/15"
                >
                  <span>
                    <span className="block text-xs font-semibold tracking-wider text-sky-300 uppercase">Report in the knowledge vault</span>
                    <span className="font-medium text-slate-100">{d.title}</span>
                  </span>
                  <span aria-hidden className="text-sky-300">→</span>
                </Link>
              ))}
              {detail.task.waitingReason && (
                <p className="mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-100 ring-1 ring-amber-500/25">Waiting: {detail.task.waitingReason}</p>
              )}
              {detail.task.resultSummary && (
                <p className="mt-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 ring-1 ring-emerald-500/25">Result: {detail.task.resultSummary}</p>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">History</h2>
              <ol className="mt-3 space-y-2">
                {detail.history.map((h, i) => {
                  const m = (h.metadata ?? {}) as Record<string, unknown>;
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                      <span className="w-40 shrink-0 font-mono text-xs text-slate-500">{fmt(h.occurredAt)}</span>
                      <span className="font-medium text-slate-200">{h.action.replace("task.", "")}</span>
                      {typeof m.from === "string" && (
                        <span className="text-slate-400">
                          {String(m.from)} → {String(m.to)}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">by {h.actorKind}</span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-slate-500">From the append-only audit log.</p>
            </section>

            {(() => {
              const done = [...detail.events].reverse().find((e) => e.type === "run.completed");
              const plan = (done?.payload as { plan?: PlanData } | undefined)?.plan;
              return plan ? (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                  <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-100 uppercase">Proposed execution plan</h2>
                  <PlanView plan={plan} />
                </section>
              ) : null;
            })()}

            {detail.events.length > 0 && (
              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">Execution events</h2>
                <ol className="mt-3 space-y-1.5">
                  {detail.events.map((e) => {
                    const p = (e.payload ?? {}) as Record<string, unknown>;
                    const text = String(p.summary ?? p.inputSummary ?? p.outputSummary ?? p.message ?? (p.model ? `model ${String(p.model)}` : ""));
                    return (
                      <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                        <span className="w-40 shrink-0 font-mono text-xs text-slate-500">{fmt(e.occurredAt)}</span>
                        <code className={`text-xs ${e.type === "run.failed" ? "text-red-300" : e.type === "run.completed" ? "text-emerald-300" : "text-slate-300"}`}>{e.type}</code>
                        {typeof p.tool === "string" && <span className="text-xs text-slate-400">{p.tool}</span>}
                        <span className="min-w-0 flex-1 break-words text-slate-400">{text}</span>
                        <span className="text-[10px] text-slate-600 uppercase">{e.origin}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">Execution runs</h2>
              {detail.runs.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No runs yet.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="text-xs text-slate-500 uppercase">
                      <tr>
                        <th className="py-1.5 pr-3 font-semibold">Attempt</th>
                        <th className="py-1.5 pr-3 font-semibold">Status</th>
                        <th className="py-1.5 pr-3 font-semibold">Started</th>
                        <th className="py-1.5 font-semibold">Deadline</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {detail.runs.map((r) => (
                        <tr key={r.id}>
                          <td className="py-1.5 pr-3 tabular-nums">{r.attempt}</td>
                          <td className="py-1.5 pr-3">{r.status}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs">{fmt(r.startedAt)}</td>
                          <td className="py-1.5 font-mono text-xs">{fmt(r.deadlineAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-100 uppercase">Details</h2>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-slate-500">Assignee</dt>
                <dd className="text-slate-200">{detail.assignee?.displayName ?? "Unassigned"}</dd>
                <dt className="text-slate-500">Priority</dt>
                <dd className="text-slate-200">P{detail.task.priority}</dd>
                <dt className="text-slate-500">Attempts</dt>
                <dd className="tabular-nums text-slate-200">
                  {detail.task.attempt} of {detail.task.maxAttempts}
                </dd>
                <dt className="text-slate-500">Timeout</dt>
                <dd className="text-slate-200">{Math.round(detail.task.timeoutSeconds / 60)} min per run</dd>
                <dt className="text-slate-500">Kind</dt>
                <dd className="text-slate-200">{detail.task.kind}</dd>
                <dt className="text-slate-500">Model cost</dt>
                <dd className="tabular-nums text-slate-200">{formatUsd(detail.costMicros)}</dd>
                <dt className="text-slate-500">Version</dt>
                <dd className="tabular-nums text-slate-200">{detail.task.version}</dd>
                <dt className="text-slate-500">Updated</dt>
                <dd className="text-slate-200">{fmt(detail.task.updatedAt)}</dd>
              </dl>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-100 uppercase">Dependencies</h2>
              {detail.dependencies.length === 0 ? (
                <p className="text-sm text-slate-500">None</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.dependencies.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/tasks/${d.id}`} className="text-slate-200 hover:text-sky-300">
                        {d.title}
                      </Link>
                      <TaskStateBadge state={d.state} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-100 uppercase">Approvals</h2>
              {detail.approvals.length === 0 ? (
                <p className="text-sm text-slate-500">None</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {detail.approvals.map((a) => (
                    <li key={a.id}>
                      <span className="font-medium text-slate-200">{a.action}</span> <span className="text-slate-400">· {a.status}</span>
                      <span className="block text-xs text-slate-500">{a.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-100 uppercase">Allowed next actions</h2>
              <p className="flex flex-wrap gap-1.5">
                {detail.availableActions.length === 0 ? (
                  <span className="text-sm text-slate-500">None (final state)</span>
                ) : (
                  detail.availableActions.map((a) => (
                    <code key={a} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
                      {a}
                    </code>
                  ))
                )}
              </p>
              <p className="mt-2 text-xs text-slate-500">Performed through the authenticated API.</p>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

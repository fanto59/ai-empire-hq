import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/backend/auth/session";
import { getControls } from "@/backend/control/common";
import { listOpenProposals } from "@/backend/control/proposals";
import { agentsOverview, budgetsOverview, errorReport, pendingTaskApprovals, projectsOverview, runHistory } from "@/backend/control/reports";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { listSectorSummaries } from "@/backend/org/sector-report";
import { listAssignableAgents } from "@/backend/tasks/assignments";
import { ownerRequestContext } from "@/backend/auth/context";
import { ACTION_KIND_LABELS, EXTERNAL_ACTION_KINDS } from "@/domain/control";
import { formatUsd } from "@/domain/money";
import { ControlForm, ControlLogProvider, ProposalActions } from "@/frontend/control/ControlForm";
import { DatabaseSetupNotice, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { controlAction } from "./actions";

export const metadata: Metadata = { title: "Control center · AI Empire HQ" };
export const dynamic = "force-dynamic";

const card = "min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-5";
const h2 = "text-sm font-semibold tracking-wide text-slate-100 uppercase";
const input = "rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none";
const STATUS: Record<string, string> = {
  running: "text-blue-300",
  succeeded: "text-emerald-300",
  failed: "text-red-300",
  timed_out: "text-red-300",
  canceled: "text-slate-500",
  queued: "text-slate-300",
  suspended: "text-amber-300",
  pending: "text-amber-300",
  approved: "text-sky-300",
  executed: "text-emerald-300",
  rejected: "text-slate-500",
  expired: "text-slate-500",
};

export default async function ControlCenterPage() {
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  if (!db || !org) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <DatabaseSetupNotice />
      </main>
    );
  }
  const [controls, taskApprovals, proposals, agentRows, projectRows, budgetRows, runs, errors, assignable, sectorRows, session] = await Promise.all([
    getControls(db, org.id),
    pendingTaskApprovals(db, org.id),
    listOpenProposals(db, org.id),
    agentsOverview(db, org.id),
    projectsOverview(db, org.id),
    budgetsOverview(db, org.id),
    runHistory(db, org.id, { limit: 30 }),
    errorReport(db, org.id),
    listAssignableAgents(db, org.id),
    listSectorSummaries(db, ownerRequestContext(org.id)),
    getSessionContext(db),
  ]);
  const can = (scope: Parameters<NonNullable<typeof session>["scopes"]["has"]>[0]) => Boolean(session?.scopes.has(scope) && session.businesses === "*" && session.hq);
  const businesses = assignable.flatMap((a) => (a.businessId && a.businessName ? [{ id: a.businessId, name: a.businessName }] : [])).filter((b, i, l) => l.findIndex((x) => x.id === b.id) === i);

  return (
    <ControlLogProvider>
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Executive</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">Control center</h1>
          {org.isTestData && <TestDataBadge />}
        </div>
        <p className="mt-2 max-w-3xl text-slate-400">
          Every control is checked on the server, written to the audit log, and shows the server&apos;s answer: accepted (with
          the audit entry) or rejected (with the reason). Money, contracts, external messages, publishing and deployments
          can only be proposed and approved here; no integration exists that could carry them out.
        </p>
        {!session && (
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-100 ring-1 ring-amber-500/25">
            Read-only: <Link href="/login" className="text-sky-300 underline">sign in</Link> with an administrator token to use the controls.
          </p>
        )}
      </header>

      {/* ---- emergency ---- */}
      <section aria-labelledby="em-title" className={`${card} mb-6 ${controls.newWorkSuspended ? "border-red-500/50 bg-red-950/30" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="em-title" className={h2}>
              Emergency suspension of new work
            </h2>
            <p className="mt-1 text-sm" data-testid="suspension-status">
              {controls.newWorkSuspended ? (
                <span className="font-semibold text-red-200">
                  SUSPENDED since {controls.changedAt?.slice(0, 16).replace("T", " ")} UTC · {controls.reason}
                </span>
              ) : (
                <span className="text-emerald-300">Normal: new work may start.</span>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Suspending stops every new run immediately (work already running continues unless you cancel it). Lifting the
              suspension needs an approved proposal.
            </p>
          </div>
          {can("emergency:operate") &&
            (controls.newWorkSuspended ? (
              <ControlForm action={controlAction} op="request-resume" label="Request resume (needs approval)" />
            ) : (
              <ControlForm action={controlAction} op="suspend" label="Suspend all new work" tone="danger" confirm="Suspend all new work across the organization?">
                <input name="reason" placeholder="Reason" maxLength={300} className={`${input} w-56`} />
              </ControlForm>
            ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ---- approvals ---- */}
        <section aria-labelledby="ap-title" className={card}>
          <h2 id="ap-title" className={h2}>
            Human approvals
          </h2>
          <h3 className="mt-3 text-xs font-semibold text-slate-400">Tasks waiting for approval</h3>
          {taskApprovals.length === 0 ? (
            <p className="text-sm text-slate-500">None.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-800">
              {taskApprovals.map((a) => (
                <li key={a.id} className="py-2">
                  <p className="text-sm text-slate-100">
                    {a.action} <span className="text-xs text-slate-500">· {a.business}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    <Link href={`/tasks/${a.taskId}`} className="hover:text-sky-300">
                      {a.taskTitle}
                    </Link>{" "}
                    · {a.reason}
                  </p>
                  {can("approvals:decide") && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      <ControlForm action={controlAction} op="task-approval" fields={{ approvalId: a.id, decision: "approved" }} label="Approve" tone="primary" />
                      <ControlForm action={controlAction} op="task-approval" fields={{ approvalId: a.id, decision: "rejected" }} label="Reject" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-xs font-semibold text-slate-400">Proposed actions (approval token per exact action)</h3>
          {proposals.length === 0 ? (
            <p className="text-sm text-slate-500">None.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-800">
              {proposals.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-100">{p.summary}</span>
                    <span className="text-xs text-slate-500">{ACTION_KIND_LABELS[p.kind] ?? p.kind}</span>
                    <span className={`text-xs font-semibold ${STATUS[p.status] ?? "text-slate-400"}`} data-testid={`proposal-status-${p.id}`}>
                      {p.status}
                    </span>
                  </div>
                  <pre className="mt-1 max-h-28 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-300">{JSON.stringify(p.payload, null, 1)}</pre>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    exact-action hash {p.payloadHash.slice(0, 16)}… · by {p.proposedBy}
                    {!p.executable && " · no integration connected: cannot be carried out"}
                    {p.result && ` · ${p.result}`}
                  </p>
                  {can("approvals:decide") && (p.status === "pending" || p.status === "approved") && (
                    <div className="mt-2">
                      <ProposalActions action={controlAction} proposalId={p.id} status={p.status} payloadJson={JSON.stringify(p.payload)} executable={p.executable} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {session && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-slate-300 hover:text-white">Propose a sensitive action</summary>
              <ControlForm action={controlAction} op="propose" label="Propose (no effect until approved)" className="mt-2">
                <select name="kind" className={input} defaultValue="external_message">
                  {EXTERNAL_ACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ACTION_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input name="summary" required minLength={5} maxLength={300} placeholder="What exactly should happen?" className={`${input} w-64`} />
                <textarea name="payload" rows={2} defaultValue={'{"to": "", "details": ""}'} className={`${input} w-full font-mono`} aria-label="Exact action details (JSON)" />
              </ControlForm>
            </details>
          )}
        </section>

        {/* ---- agents ---- */}
        <section aria-labelledby="ag-title" className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ag-title" className={h2}>
              Agents
            </h2>
            <Link href="/models" className="text-xs text-sky-300 hover:text-sky-200">
              Model selection →
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-slate-800">
            {agentRows.map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="text-slate-100">{a.name}</span>
                  <span className={`text-xs font-semibold ${a.status === "active" ? "text-emerald-300" : "text-amber-300"}`} data-testid={`agent-status-${a.id}`}>
                    {a.status === "disabled" ? "paused" : a.status}
                  </span>
                  <span className="text-xs text-slate-500">
                    {a.scope} · {a.provider}/{a.model} · {a.running} running · {a.open} open
                  </span>
                </div>
                {can("agents:operate") && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {a.status === "active" ? (
                      <ControlForm action={controlAction} op="pause-agent" fields={{ agentId: a.id }} label="Pause" />
                    ) : a.status === "disabled" ? (
                      <ControlForm action={controlAction} op="resume-agent" fields={{ agentId: a.id }} label="Resume" />
                    ) : null}
                    {a.open > 0 && (
                      <ControlForm action={controlAction} op="cancel-agent-work" fields={{ agentId: a.id }} label={`Cancel ${a.open} open task${a.open === 1 ? "" : "s"}`} tone="danger" confirm={`Cancel all open work of ${a.name}?`} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* ---- assignment ---- */}
        <section aria-labelledby="as-title" className={card}>
          <h2 id="as-title" className={h2}>
            Task assignment
          </h2>
          {can("tasks:write") ? (
            <ControlForm action={controlAction} op="assign" label="Assign" tone="primary" className="mt-2">
              <select name="agentId" className={input} aria-label="Agent">
                {assignable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName} · {a.businessName ?? (a.sectorName ? `${a.sectorName} sector` : "HQ")}
                  </option>
                ))}
              </select>
              <select name="businessId" className={input} aria-label="Business (sector agents only)" defaultValue="">
                <option value="">Business (sector agents only)</option>
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                {assignable
                  .flatMap((a) => a.sectorBusinesses)
                  .filter((b, i, l) => l.findIndex((x) => x.id === b.id) === i && !businesses.some((x) => x.id === b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
              <textarea name="instructions" required minLength={10} maxLength={4000} rows={2} placeholder="Instructions" className={`${input} w-full`} />
            </ControlForm>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Sign in with tasks:write to assign work.</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Assignment rules apply (business agents: own business; sector agents: their sector; Central PM: any). Paid work runs only within budgets and only while new work is not suspended.
          </p>
        </section>

        {/* ---- projects ---- */}
        <section aria-labelledby="pr-title" className={card}>
          <h2 id="pr-title" className={h2}>
            Projects
          </h2>
          {projectRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No projects. Create them on a <Link href="/sectors" className="text-sky-300">sector page</Link>.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-800">
              {projectRows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 text-slate-100">
                    {p.title} <span className="text-xs text-slate-500">· {p.scope} · {p.status}{p.owner ? ` · lead ${p.owner}` : ""}</span>
                  </span>
                  {can("tasks:write") && (
                    <ControlForm action={controlAction} op="project-status" fields={{ projectId: p.id }} label="Set status">
                      <select name="status" defaultValue={p.status} className={input} aria-label={`Status of ${p.title}`}>
                        {["proposed", "active", "on-hold", "done", "canceled"].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </ControlForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- budgets ---- */}
        <section aria-labelledby="bu-title" className={card}>
          <h2 id="bu-title" className={h2}>
            Budgets this month (organization, sector, business, agent, provider)
          </h2>
          <ul className="mt-2 divide-y divide-slate-800">
            {budgetRows.length === 0 && <li className="py-2 text-sm text-slate-500">No budgets: agents cannot spend.</li>}
            {budgetRows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-slate-100">
                  {b.scope.label}{" "}
                  <span className={`text-xs tabular-nums ${b.exhausted ? "text-red-300" : "text-slate-400"}`}>
                    {formatUsd(b.spentMicros)} of {formatUsd(b.limitMicros)}
                    {b.exhausted ? " · exhausted: calls stop" : ""}
                  </span>
                </span>
                {can("budgets:admin") && (
                  <ControlForm action={controlAction} op="set-budget" fields={{ scopeKind: b.scope.kind, scopeId: b.scope.id ?? "" }} label="Set limit">
                    <input name="usd" type="number" min={0} max={1000} step="0.01" defaultValue={(b.limitMicros / 1e6).toFixed(2)} className={`${input} w-24`} aria-label={`Limit for ${b.scope.label} in dollars`} />
                  </ControlForm>
                )}
              </li>
            ))}
          </ul>
          {can("budgets:admin") && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-300 hover:text-white">Add a budget (agent, provider, sector, business)</summary>
              <ControlForm action={controlAction} op="set-budget" label="Set" className="mt-2">
                <select name="scopeKind" className={input} aria-label="Scope kind">
                  {["agent", "provider", "sector", "business", "organization"].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <select name="scopeId" className={input} aria-label="Scope">
                  <option value="">(organization)</option>
                  <optgroup label="Agents">
                    {agentRows.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Providers">
                    {["anthropic", "openai", "xai"].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Sectors">
                    {sectorRows.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Businesses">
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <input name="usd" type="number" min={0} max={1000} step="0.01" defaultValue="0" className={`${input} w-24`} aria-label="Limit in dollars" />
              </ControlForm>
              <p className="mt-1 text-xs text-slate-500">Lowering applies now; raising creates a proposal that needs an approval token.</p>
            </details>
          )}
        </section>
      </div>

      {/* ---- history & errors ---- */}
      <section aria-labelledby="hi-title" className={`${card} mt-6`}>
        <h2 id="hi-title" className={h2}>
          Execution history
        </h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No runs yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs tabular-nums">
              <thead className="text-slate-500 uppercase">
                <tr>
                  <th className="py-1.5 pr-3 font-semibold">Started (UTC)</th>
                  <th className="py-1.5 pr-3 font-semibold">Task</th>
                  <th className="py-1.5 pr-3 font-semibold">Agent</th>
                  <th className="py-1.5 pr-3 font-semibold">Run</th>
                  <th className="py-1.5 pr-3 font-semibold">Model</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Cost</th>
                  <th className="py-1.5 font-semibold">Error / control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {runs.map((r) => (
                  <tr key={r.runId}>
                    <td className="py-1.5 pr-3 font-mono">{r.startedAt ? r.startedAt.slice(0, 16).replace("T", " ") : "not started"}</td>
                    <td className="py-1.5 pr-3">
                      <Link href={`/tasks/${r.taskId}`} className="hover:text-sky-300">
                        {r.taskTitle}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">{r.agentName ?? "-"}</td>
                    <td className={`py-1.5 pr-3 ${STATUS[r.status] ?? ""}`}>
                      {r.status.replace("_", " ")} · #{r.attempt}
                      {r.durationSeconds !== null ? ` · ${r.durationSeconds}s` : ""}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{r.model ?? "-"}</td>
                    <td className="py-1.5 pr-3 text-right">{formatUsd(r.costMicros)}</td>
                    <td className="py-1.5">
                      {r.error && <span className="text-red-300">{r.error.slice(0, 120)}</span>}
                      {(r.status === "running" || r.status === "queued") && can("tasks:transition") && (
                        <ControlForm action={controlAction} op="cancel-task" fields={{ taskId: r.taskId }} label="Cancel task" tone="danger" confirm="Cancel this task? A running call stops at the next heartbeat." />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="er-title" className={`${card} mt-6`}>
        <h2 id="er-title" className={h2}>
          Error report · last 30 days
        </h2>
        {errors.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No failed runs.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-800 text-sm">
            {errors.map((e) => (
              <li key={e.code} className="py-2">
                <span className="font-mono text-red-300">{e.code}</span> <span className="text-slate-400">× {e.count}</span>
                <span className="block text-xs text-slate-400">
                  Last {e.lastAt.slice(0, 16).replace("T", " ")} UTC on{" "}
                  <Link href={`/tasks/${e.lastTaskId}`} className="hover:text-sky-300">
                    {e.lastTaskTitle}
                  </Link>
                  : {e.lastMessage} {e.agents.length > 0 && `· agents: ${e.agents.join(", ")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
    </ControlLogProvider>
  );
}

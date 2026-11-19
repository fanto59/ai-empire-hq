"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { formatUsd } from "@/agents/research/pricing";
import { TASK_STATE_LABELS } from "@/domain/task-view";
import { PlanView } from "../tasks/PlanView";
import type { ChiefPanelData, SubmitGoalAction } from "./chief-types";
import { TASK_CHIP } from "./state-style";

const ACTIVE = new Set(["queued", "assigned", "running"]);

/**
 * The Chief AI Manager panel in the office inspector: submit an objective,
 * then watch the REAL agent's execution events, cost and final plan. All data
 * comes from the database (refreshed by the page).
 */
export function ChiefPanel({ data, submitGoal }: { data: ChiefPanelData; submitGoal: SubmitGoalAction }) {
  const [state, action, pending] = useActionState(submitGoal, { ok: false, message: null, taskId: null });
  const [key] = useState(() => `goal-${crypto.randomUUID()}`);
  const latest = data.objectives[0];
  const readyIssues = [
    !data.agentReady && "No active Chief AI Manager agent with read access (run npm run db:setup).",
    !data.providerReady && data.providerReason,
    !data.workerInProcess && "The agent worker is not running in this server (AGENT_WORKER=in-process or npm run worker).",
    data.orgBudget && data.orgBudget.limitMicros <= data.orgBudget.spentMicros && "The organization's API budget is used up or not set (npm run budget:set).",
  ].filter(Boolean) as string[];

  return (
    <section aria-labelledby="chief-goal-title" className="space-y-4">
      <div className="rounded-lg bg-sky-500/5 p-3 ring-1 ring-sky-400/20">
        <h3 id="chief-goal-title" className="text-xs font-semibold tracking-wider text-sky-300 uppercase">
          Chief AI Manager · real agent
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Objectives you send here are handled by the Chief AI Manager agent (Claude). It reads your organization&apos;s records and
          proposes a plan. It can&apos;t approve spending, sign contracts, change permissions or skip your approvals.
        </p>
        {data.orgBudget && (
          <p className="mt-2 text-[11px] text-slate-500">
            Organization budget this month: {formatUsd(data.orgBudget.spentMicros)} / {formatUsd(data.orgBudget.limitMicros)}
          </p>
        )}
      </div>

      {readyIssues.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-100 ring-1 ring-amber-500/25">
          {readyIssues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {data.signedIn ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="idempotencyKey" value={`${key}-${state.taskId ?? "0"}`} />
          <label htmlFor="goal" className="block text-xs font-medium text-slate-300">
            Your objective
          </label>
          <textarea
            id="goal"
            name="goal"
            required
            minLength={10}
            maxLength={4000}
            rows={3}
            placeholder="e.g. Review our projects and propose what Test Business A should focus on next quarter."
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-sky-500/20 px-3 py-1.5 text-xs font-medium text-sky-100 ring-1 ring-sky-400/40 hover:bg-sky-500/30 disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send to Chief AI Manager"}
          </button>
          {state.message && (
            <p role="status" className={`text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
              {state.message}
            </p>
          )}
        </form>
      ) : (
        <p className="text-xs text-slate-400">
          <Link href="/login" className="text-sky-300 hover:text-sky-200">
            Sign in
          </Link>{" "}
          to send objectives to the Chief AI Manager.
        </p>
      )}

      {latest ? (
        <div className="space-y-3 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Latest objective</h4>
            <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${TASK_CHIP[latest.state]}`}>{TASK_STATE_LABELS[latest.state]}</span>
            {ACTIVE.has(latest.state) && <span className="text-[11px] text-sky-300">working…</span>}
            <span className="ml-auto text-[11px] text-slate-500 tabular-nums">cost {formatUsd(latest.costMicros)}</span>
          </div>
          <p className="text-xs text-slate-300">{latest.goal}</p>
          {latest.lastError && latest.state !== "completed" && (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/25">
              {latest.lastError}
            </p>
          )}

          <div>
            <h5 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Activity (live events)</h5>
            {latest.events.length === 0 ? (
              <p className="text-xs text-slate-500">Waiting for the worker to pick it up.</p>
            ) : (
              <ol className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {latest.events.map((e) => (
                  <li key={e.id} className="flex gap-2 text-[11px]">
                    <span className="shrink-0 font-mono text-slate-600">{e.at}</span>
                    <code className={e.type === "run.failed" ? "text-red-300" : e.type === "run.completed" ? "text-emerald-300" : "text-slate-400"}>{e.type}</code>
                    <span className="min-w-0 flex-1 truncate text-slate-400" title={e.text}>
                      {e.tool ? `${e.tool} · ` : ""}
                      {e.text}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {latest.plan && <PlanView plan={latest.plan} compact />}
          {latest.requestedWork.length > 0 && (
            <div>
              <h5 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Work requested from the Project Manager</h5>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-400">
                {latest.requestedWork.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <Link href={`/tasks/${latest.taskId}`} className="text-sky-300 hover:text-sky-200">
              Full task →
            </Link>
            {latest.briefingPath && (
              <Link href={`/knowledge/note?path=${encodeURIComponent(latest.briefingPath)}`} className="text-sky-300 hover:text-sky-200">
                Executive briefing →
              </Link>
            )}
          </div>
        </div>
      ) : (
        <p className="border-t border-slate-800 pt-3 text-xs text-slate-500">No objectives yet.</p>
      )}

      {data.objectives.length > 1 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Earlier objectives</h4>
          <ul className="space-y-1">
            {data.objectives.slice(1).map((o) => (
              <li key={o.taskId} className="flex items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-px text-[10px] ring-1 ${TASK_CHIP[o.state]}`}>{TASK_STATE_LABELS[o.state]}</span>
                <Link href={`/tasks/${o.taskId}`} className="min-w-0 flex-1 truncate text-slate-300 hover:text-white">
                  {o.goal}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

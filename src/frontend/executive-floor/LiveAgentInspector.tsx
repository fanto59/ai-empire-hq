"use client";

import Link from "next/link";
import type { LiveEvent } from "@/domain/live-office";
import { formatUsd } from "@/domain/money";
import { TASK_STATE_LABELS } from "@/domain/task-view";
import type { TaskState } from "@/domain/task-lifecycle";
import { noteHref } from "../knowledge/Markdown";
import type { ConnectionStatus, LiveCharacterView } from "../office/live/director";
import { PHASE_LABELS } from "../office/live/machine";
import { CHARACTER_STATE_LABELS } from "../office/sim/types";
import { STATE_DOT, TASK_CHIP, hex } from "./state-style";

/**
 * Inspector for a LIVE agent: everything shown is read from stored events,
 * task records, run health and model_usage - nothing simulated.
 */
export function LiveAgentInspector({
  view,
  connection,
  testData,
  chief,
  onClose,
  onFollow,
}: {
  view: LiveCharacterView;
  connection: ConnectionStatus;
  testData: boolean;
  chief?: React.ReactNode;
  onClose: () => void;
  onFollow: () => void;
}) {
  const { agent, character, live, task, run } = view;
  const a = character.appearance;
  const model = live.model ? { provider: live.provider ?? agent.provider, model: live.model, note: "used by this run" } : { provider: agent.provider, model: agent.model, note: "assigned (no run yet)" };
  const taskState = task?.state as TaskState | undefined;

  return (
    <section aria-labelledby="live-inspector-title" className="flex h-full flex-col">
      <header className="border-b border-slate-800 p-4">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white ring-1 ring-white/10"
            style={{ background: `linear-gradient(145deg, ${hex(a.jacket)}, ${hex(a.accent)})` }}
          >
            {agent.name.replace(/^Test /, "").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="live-inspector-title" className="text-base font-semibold text-white">
                {agent.name}
              </h2>
              <LiveBadge connection={connection} />
              {testData && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">TEST DATA</span>}
            </div>
            <p className="text-sm text-slate-400">{agent.role.replace(/-/g, " ")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close inspector" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        {connection !== "live" && (
          <p role="status" className="mt-3 rounded-md bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90 ring-1 ring-amber-400/20">
            {connection === "unauthorized" ? "Sign in to receive live events." : "Live connection interrupted - showing the last state received. It will catch up automatically."}
          </p>
        )}
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        {chief}
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2.5">
          <Field label="Status">
            <span className="flex items-center gap-2" data-testid="live-phase" data-phase={live.phase}>
              <span aria-hidden className={`h-2 w-2 rounded-full ${STATE_DOT[view.state]}`} />
              <span className="font-medium text-white">{PHASE_LABELS[live.phase]}</span>
              <span className="text-xs text-slate-500">({CHARACTER_STATE_LABELS[view.state]})</span>
            </span>
            {live.tool && live.phase === "using-tool" && <span className="mt-0.5 block text-xs text-slate-400">Tool: <code className="text-slate-300">{live.tool}</code></span>}
            <span className="mt-0.5 block text-xs text-slate-500">{view.location}</span>
            {live.stalled && (
              <span className="mt-1 block rounded bg-red-500/10 px-2 py-1 text-xs text-red-200 ring-1 ring-red-500/30">
                The worker stopped reporting (lease or deadline passed). The run will be marked failed when it is reaped; nothing is assumed until then.
              </span>
            )}
          </Field>
          <Field label="Task">
            {task ? (
              <>
                <Link href={`/tasks/${task.id}`} className="text-slate-100 underline decoration-slate-600 underline-offset-2 hover:decoration-slate-300">
                  {task.title}
                </Link>
                {taskState && <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ring-1 ${TASK_CHIP[taskState]}`}>{TASK_STATE_LABELS[taskState] ?? task.state}</span>}
                {run && <span className="mt-0.5 block text-xs text-slate-500">Attempt {run.attempt} · run {run.status.replace("_", " ")}</span>}
              </>
            ) : (
              <span className="text-slate-500">No run recorded yet</span>
            )}
          </Field>
          {live.approval && (
            <Field label="Approval">
              <span className="font-medium text-amber-200">{live.approval.action}</span>
              {live.approval.reason && <span className="block text-xs text-slate-400">{live.approval.reason}</span>}
              {task && (
                <Link href={`/tasks/${task.id}`} className="mt-1 inline-block text-xs text-sky-300 hover:text-sky-200">
                  Decide on the task page →
                </Link>
              )}
            </Field>
          )}
          <Field label="Model">
            <span className="font-mono text-xs text-slate-200">
              {model.provider} · {model.model}
            </span>
            <span className="block text-xs text-slate-500">{model.note}</span>
          </Field>
          <Field label="Cost">
            <span className="font-mono text-slate-200">{run ? formatUsd(run.costMicros) : "$0.00"}</span>{" "}
            <span className="text-xs text-slate-500">{run ? "recorded API cost of this run" : "no run"}</span>
          </Field>
          {(live.error || task?.lastError) && (
            <Field label="Error">
              {live.error && <code className="mr-1 text-xs text-red-300">{live.error.code}</code>}
              <span className="text-red-200">{live.error?.message ?? task?.lastError}</span>
            </Field>
          )}
          {(live.notePath || task?.notePath || live.summary || task?.resultSummary) && (
            <Field label="Output">
              {(live.notePath ?? task?.notePath) && (
                <Link href={noteHref(live.notePath ?? task!.notePath!)} className="block text-sky-300 hover:text-sky-200">
                  Open the report / briefing →
                </Link>
              )}
              {(live.summary ?? task?.resultSummary) && <span className="block text-xs text-slate-300">{live.summary ?? task?.resultSummary}</span>}
            </Field>
          )}
        </dl>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Execution events</h3>
            <span className="text-xs text-slate-500">{live.events.length} stored events</span>
          </div>
          {live.events.length === 0 ? (
            <p className="text-xs text-slate-500">No events yet. They appear here as the worker reports them.</p>
          ) : (
            <ol className="space-y-1.5" aria-label="Execution events">
              {[...live.events].reverse().slice(0, 30).map((e) => (
                <li key={e.id} className="flex gap-2 rounded-md bg-slate-900/60 px-2.5 py-1.5 ring-1 ring-slate-800/80">
                  <time dateTime={e.occurredAt} className="shrink-0 font-mono text-[11px] text-slate-500">
                    {e.occurredAt.slice(11, 19)}
                  </time>
                  <span className="min-w-0 flex-1 text-xs text-slate-300">
                    <code className="mr-1.5 text-[11px] text-sky-300">{e.type}</code>
                    {describe(e)}
                    {e.origin === "replay" && <span className="ml-1.5 text-[10px] text-slate-500">(replayed)</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-slate-800 p-3">
        <button type="button" onClick={onFollow} className="rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-500/25">
          Center camera
        </button>
        <span className="text-[11px] text-slate-500">Times are UTC, from the server.</span>
      </footer>
    </section>
  );
}

function describe(e: LiveEvent): string {
  const p = e.payload;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  switch (e.type) {
    case "run.started":
      return `${s("provider")} · ${s("model")}`;
    case "run.step":
      return s("summary");
    case "tool.called":
      return `${s("tool")}: ${s("inputSummary")}`;
    case "tool.result":
      return `${s("tool")} ${p.ok === false ? "failed" : "ok"}: ${s("outputSummary")}`;
    case "approval.requested":
      return `${s("action")} - ${s("reason")}`;
    case "approval.resolved":
      return s("decision");
    case "run.completed":
      return s("summary");
    case "run.failed":
      return `${s("errorCode")}: ${s("message")}`;
    case "run.canceled":
      return s("reason");
  }
}

export function LiveBadge({ connection }: { connection: ConnectionStatus }) {
  const map: Record<ConnectionStatus, [string, string]> = {
    live: ["LIVE", "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"],
    connecting: ["CONNECTING", "bg-slate-800 text-slate-300 ring-slate-700"],
    reconnecting: ["RECONNECTING", "bg-amber-500/15 text-amber-300 ring-amber-500/30"],
    offline: ["OFFLINE", "bg-red-500/15 text-red-300 ring-red-500/30"],
    unauthorized: ["SIGN IN", "bg-slate-800 text-slate-300 ring-slate-700"],
  };
  const [text, cls] = map[connection];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ring-1 ${cls}`}>{text}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-px text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-200">{children}</dd>
    </>
  );
}

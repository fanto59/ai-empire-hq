"use client";

import Link from "next/link";
import type { LiveAgentInfo } from "@/domain/live-office";
import type { ConnectionStatus, LiveCharacterView } from "../office/live/director";
import { PHASE_LABELS } from "../office/live/machine";
import { LiveBadge } from "./LiveAgentInspector";
import { STATE_DOT } from "./state-style";

/** Overview of the live floor: who is doing what, from real events only. */
export function LiveOverviewPanel({
  views,
  offFloor,
  connection,
  onSelect,
  title = "Executive Floor · live",
}: {
  title?: string;
  views: LiveCharacterView[];
  offFloor: readonly LiveAgentInfo[];
  connection: ConnectionStatus;
  onSelect: (agentId: string) => void;
}) {
  return (
    <section aria-labelledby="live-overview-title" className="flex h-full flex-col">
      <header className="border-b border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <h2 id="live-overview-title" className="text-base font-semibold text-white">
            {title}
          </h2>
          <LiveBadge connection={connection} />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Characters move only when their agent&apos;s worker records an execution event. With no events, they wait at their
          resting spot.
        </p>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {connection === "unauthorized" ? (
          <p className="rounded-md bg-slate-900 p-3 text-slate-300 ring-1 ring-slate-800">
            <Link href="/login" className="text-sky-300 hover:text-sky-200">
              Sign in
            </Link>{" "}
            to see your agents&apos; real activity. The live stream needs an authenticated session.
          </p>
        ) : views.length === 0 ? (
          <p className="text-slate-500">{connection === "live" ? "No agents on this floor." : "Connecting to the live event stream…"}</p>
        ) : (
          <ul className="space-y-2">
            {views.map((v) => (
              <li key={v.agent.id}>
                <button
                  type="button"
                  onClick={() => onSelect(v.agent.id)}
                  className="flex w-full items-start gap-3 rounded-lg bg-slate-900/60 p-3 text-left ring-1 ring-slate-800 transition hover:ring-sky-400/40"
                >
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATE_DOT[v.state]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-100">{v.agent.name}</span>
                    <span className="block text-xs text-slate-400" data-testid={`overview-phase-${v.agent.slug}`}>
                      {PHASE_LABELS[v.live.phase]}
                      {v.live.stalled ? " · worker not responding" : ""}
                      {v.task ? ` · ${v.task.title}` : ""}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {v.live.model ?? v.agent.model} · {v.location}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {offFloor.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">Not on this floor</h3>
            <p className="text-xs text-slate-400">{offFloor.map((a) => a.name).join(", ")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

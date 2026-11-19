import { deriveActivity } from "@/agents/events/derive";
import type { SimulationDirector } from "../office/sim/director";
import { CHARACTER_STATE_LABELS, type CharacterSnapshot, type PrototypeCharacter } from "../office/sim/types";
import { SimBadge } from "./SimBadge";
import { STATE_DOT, TASK_CHIP, TASK_LABEL, formatSimTime, hex } from "./state-style";

export interface CharacterInspectorProps {
  character: PrototypeCharacter;
  snapshot: CharacterSnapshot;
  director: SimulationDirector;
  onClose: () => void;
  onFollow: () => void;
}

export function CharacterInspector({ character, snapshot, director, onClose, onFollow }: CharacterInspectorProps) {
  const a = character.appearance;
  const derived = deriveActivity(snapshot.lastEvent ?? undefined);

  return (
    <section aria-labelledby="inspector-title" className="flex h-full flex-col">
      <header className="border-b border-slate-800 p-4">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white ring-1 ring-white/10"
            style={{ background: `linear-gradient(145deg, ${hex(a.jacket)}, ${hex(a.accent)})` }}
          >
            {character.codename.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="inspector-title" className="text-base font-semibold tracking-wide text-white">
                {character.codename}
              </h2>
              <SimBadge>Prototype</SimBadge>
            </div>
            <p className="text-sm text-slate-400">{character.role}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <p className="mt-3 rounded-md bg-amber-400/5 px-3 py-2 text-xs leading-relaxed text-amber-200/90 ring-1 ring-amber-400/20">
          Not a real AI agent. This character is animated by a scripted simulation; no model, account, or tool is
          connected.
        </p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2.5">
          <Field label="Name">
            {character.codename} <span className="text-slate-500">(prototype codename)</span>
          </Field>
          <Field label="Role">{character.role}</Field>
          <Field label="Assigned business">{character.business}</Field>
          <Field label="Assigned project">{character.project}</Field>
          <Field label="Current task">
            {snapshot.currentTask ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>{snapshot.currentTask.title}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${TASK_CHIP[snapshot.currentTask.status]}`}>
                  {TASK_LABEL[snapshot.currentTask.status]}
                </span>
              </span>
            ) : (
              <span className="text-slate-500">None yet</span>
            )}
          </Field>
          <Field label="Execution state">
            <span className="flex items-center gap-2">
              <span aria-hidden className={`h-2 w-2 rounded-full ${STATE_DOT[snapshot.state]}`} />
              <span className="font-medium text-white">{CHARACTER_STATE_LABELS[snapshot.state]}</span>
              <SimBadge />
            </span>
            <span className="mt-1 block text-xs text-slate-400">
              {snapshot.stepNote} · {snapshot.location}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Derived activity: <code className="text-slate-400">{derived}</code> (from simulated events)
            </span>
          </Field>
          <Field label="Model">
            <span className="text-slate-300">Not connected</span>
            <span className="block text-xs text-slate-500">Planned provider: {character.plannedModel}</span>
          </Field>
          <Field label="Cost">
            <span className="font-mono text-slate-300">$0.00</span>{" "}
            <span className="text-xs text-slate-500">placeholder · no provider, no tokens used</span>
          </Field>
        </dl>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Activity history</h3>
            <span className="text-xs text-slate-500">{snapshot.eventCount} simulated events</span>
          </div>
          <ol className="space-y-1.5" aria-label="Activity history (simulated)">
            {snapshot.history.slice(0, 14).map((h) => (
              <li key={h.id} className="flex gap-2 rounded-md bg-slate-900/60 px-2.5 py-1.5 ring-1 ring-slate-800/80">
                <span className="shrink-0 font-mono text-[11px] text-slate-500">{formatSimTime(director.simTimeAt(h.at))}</span>
                <span className="min-w-0 flex-1 text-xs text-slate-300">
                  {h.kind === "event" && (
                    <span className="mr-1.5 rounded bg-amber-400/10 px-1 py-px text-[10px] font-semibold text-amber-300">
                      SIM EVENT
                    </span>
                  )}
                  {h.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-slate-800 p-3">
        <button
          type="button"
          onClick={onFollow}
          className="rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-500/25"
        >
          Center camera
        </button>
        <span className="text-[11px] text-slate-500">Times are simulation clock (T+mm:ss).</span>
      </footer>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-px text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-200">{children}</dd>
    </>
  );
}

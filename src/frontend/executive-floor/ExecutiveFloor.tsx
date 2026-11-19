"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { EXECUTIVE_FLOOR } from "../office/floor/executive-floor";
import type { FloorHotspot, RoomId } from "../office/floor/types";
import type { ExecutiveFloorHandle } from "../office/pixi/executive-floor-renderer";
import { PROTOTYPE_CAST } from "../office/sim/cast";
import { SimulationDirector } from "../office/sim/director";
import { SIM_SCRIPTS } from "../office/sim/scripts";
import type { TaskSummaryView } from "@/domain/task-view";
import { CHARACTER_STATES, CHARACTER_STATE_LABELS } from "../office/sim/types";
import { CharacterInspector } from "./CharacterInspector";
import { FloorCanvas } from "./FloorCanvas";
import { FloorOverviewPanel } from "./FloorOverviewPanel";
import { ProjectBoardPanel } from "./ProjectBoardPanel";
import { STATE_DOT } from "./state-style";

type Panel = { kind: "overview" } | { kind: "character"; id: string } | { kind: "board" };

const SPEEDS = [1, 2, 4] as const;

/**
 * Executive Floor page shell. Owns the simulation director (client-only, so
 * no simulated timestamps are rendered on the server) and wires the PixiJS
 * canvas to the side panels.
 */
export interface ExecutiveFloorProps {
  /** Real task records from the database; null when the database is not set up. */
  tasks: TaskSummaryView[] | null;
  testData: boolean;
}

/** How often the server-rendered task list is refreshed while visible. */
const TASK_REFRESH_MS = 15_000;

export function ExecutiveFloor({ tasks, testData }: ExecutiveFloorProps) {
  const router = useRouter();
  // Deterministic and pure, so it is safe to construct during SSR too; the
  // UI only shows simulation-relative times (T+mm:ss), never wall-clock.
  const [director] = useState(
    () => new SimulationDirector({ plan: EXECUTIVE_FLOOR, cast: PROTOTYPE_CAST, scripts: SIM_SCRIPTS }),
  );
  const [handle, setHandle] = useState<ExecutiveFloorHandle | null>(null);
  const [panel, setPanel] = useState<Panel>({ kind: "overview" });
  const [batterySaver, setBatterySaver] = useState(false);

  // Re-render on discrete simulation changes (not every frame).
  useSyncExternalStore(director.subscribe, director.getVersion, director.getVersion);

  const selectedId = panel.kind === "character" ? panel.id : null;
  useEffect(() => {
    handle?.setSelected(selectedId);
  }, [handle, selectedId]);

  useEffect(() => {
    handle?.setBatterySaver(batterySaver);
  }, [handle, batterySaver]);

  useEffect(() => {
    if (tasks) handle?.setTasks(tasks);
  }, [handle, tasks]);

  // Re-render the server component to pick up task changes (no client-side
  // database access, no API token in the browser).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, TASK_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel({ kind: "overview" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectCharacter = useCallback((id: string | null) => {
    setPanel(id ? { kind: "character", id } : { kind: "overview" });
  }, []);

  const onHotspot = useCallback(
    (hotspot: FloorHotspot) => {
      if (hotspot === "sector-elevator") router.push("/sectors");
      else setPanel({ kind: "board" });
    },
    [router],
  );

  const focusRoom = useCallback((id: RoomId) => handle?.focusRoom(id), [handle]);

  const paused = director.isPaused();
  const speed = director.getSpeed();
  const character = selectedId ? PROTOTYPE_CAST.find((c) => c.id === selectedId) : undefined;
  const snapshot = selectedId ? director.getSnapshot(selectedId) : undefined;

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <div
        role="note"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-2 text-xs text-amber-100/90"
      >
        <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-slate-950 uppercase">
          Simulation mode
        </span>
        <span>
          Prototype characters driven by scripted, clearly labelled simulation events. No AI agents, model providers,
          or business accounts are connected. The project board shows real task records from the database
          {testData ? " (test data)" : ""}.
        </span>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="relative h-[62vh] min-h-[380px] flex-1 overflow-hidden bg-[#0b1220] lg:h-auto">
          <FloorCanvas
            plan={EXECUTIVE_FLOOR}
            cast={PROTOTYPE_CAST}
            director={director}
            onReady={setHandle}
            onSelectCharacter={selectCharacter}
            onHotspot={onHotspot}
          />

          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg bg-slate-950/85 p-1 ring-1 ring-slate-800 backdrop-blur">
              <ToolbarButton
                label={paused ? "Resume simulation" : "Pause simulation"}
                onClick={() => director.setPaused(!paused)}
                pressed={paused}
              >
                {paused ? "▶ Resume" : "❚❚ Pause"}
              </ToolbarButton>
              <span aria-hidden className="mx-1 h-5 w-px bg-slate-800" />
              {SPEEDS.map((s) => (
                <ToolbarButton key={s} label={`Simulation speed ${s}x`} pressed={speed === s} onClick={() => director.setSpeed(s)}>
                  {s}×
                </ToolbarButton>
              ))}
              <span aria-hidden className="mx-1 h-5 w-px bg-slate-800" />
              <ToolbarButton label="Zoom out" onClick={() => handle?.zoomOut()}>
                −
              </ToolbarButton>
              <ToolbarButton label="Zoom in" onClick={() => handle?.zoomIn()}>
                +
              </ToolbarButton>
              <ToolbarButton label="Fit floor to view" onClick={() => handle?.fit()}>
                Fit
              </ToolbarButton>
              <span aria-hidden className="mx-1 h-5 w-px bg-slate-800" />
              <ToolbarButton
                label="Battery saver: cap rendering at 30 frames per second"
                pressed={batterySaver}
                onClick={() => setBatterySaver((v) => !v)}
              >
                Battery saver
              </ToolbarButton>
            </div>
            <div className="pointer-events-auto rounded-lg bg-slate-950/85 px-3 py-1.5 text-[11px] text-slate-400 ring-1 ring-slate-800">
              Executive Floor · <span className="text-amber-300">simulated</span>
              {handle ? <span className="text-slate-500"> · {handle.backend}</span> : null}
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-lg bg-slate-950/85 p-2.5 ring-1 ring-slate-800 sm:block">
            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Character states</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              {CHARACTER_STATES.map((s) => (
                <li key={s} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${STATE_DOT[s]}`} />
                  {CHARACTER_STATE_LABELS[s]}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="w-full border-t border-slate-800 bg-slate-950 lg:w-[380px] lg:border-t-0 lg:border-l">
          <div className="lg:sticky lg:top-0 lg:h-[calc(100dvh-5.5rem)]">
            {panel.kind === "character" && character && snapshot ? (
              <CharacterInspector
                character={character}
                snapshot={snapshot}
                director={director}
                tasks={tasks}
                testData={testData}
                onClose={() => setPanel({ kind: "overview" })}
                onFollow={() => handle?.focusCharacter(character.id)}
              />
            ) : panel.kind === "board" ? (
              <ProjectBoardPanel tasks={tasks} cast={PROTOTYPE_CAST} testData={testData} onClose={() => setPanel({ kind: "overview" })} />
            ) : (
              <FloorOverviewPanel
                plan={EXECUTIVE_FLOOR}
                cast={PROTOTYPE_CAST}
                director={director}
                onSelectCharacter={(id) => setPanel({ kind: "character", id })}
                onFocusRoom={focusRoom}
                onOpenBoard={() => {
                  handle?.focusRoom("board-lounge");
                  setPanel({ kind: "board" });
                }}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-w-8 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        pressed ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40" : "text-slate-300 hover:bg-slate-800 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

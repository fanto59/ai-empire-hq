import Link from "next/link";
import type { FloorPlan, RoomId } from "../office/floor/types";
import type { SimulationDirector } from "../office/sim/director";
import { CHARACTER_STATE_LABELS, type PrototypeCharacter } from "../office/sim/types";
import { SimBadge } from "./SimBadge";
import { STATE_DOT, hex } from "./state-style";

export function FloorOverviewPanel({
  plan,
  cast,
  director,
  onSelectCharacter,
  onFocusRoom,
  onOpenBoard,
}: {
  plan: FloorPlan;
  cast: readonly PrototypeCharacter[];
  director: SimulationDirector;
  onSelectCharacter: (id: string) => void;
  onFocusRoom: (id: RoomId) => void;
  onOpenBoard: () => void;
}) {
  return (
    <section aria-labelledby="overview-title" className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-slate-800 p-4">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-sky-400 uppercase">Floor 01</p>
        <h2 id="overview-title" className="text-lg font-semibold text-white">
          {plan.name}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Select a character on the floor or below to inspect it. Drag to pan, scroll or use the controls to zoom.
        </p>
      </header>

      <div className="space-y-6 p-4">
        <div>
          <h3 className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Prototype characters <SimBadge />
          </h3>
          <ul className="space-y-1.5">
            {cast.map((c) => {
              const snap = director.getSnapshot(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelectCharacter(c.id)}
                    className="flex w-full items-center gap-3 rounded-lg bg-slate-900/70 px-3 py-2 text-left ring-1 ring-slate-800 transition hover:bg-slate-800/80 hover:ring-slate-700"
                  >
                    <span
                      aria-hidden
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white"
                      style={{ background: `linear-gradient(145deg, ${hex(c.appearance.jacket)}, ${hex(c.appearance.accent)})` }}
                    >
                      {c.codename.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-100">{c.codename}</span>
                      <span className="block truncate text-xs text-slate-400">{c.role}</span>
                    </span>
                    {snap && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-300">
                        <span aria-hidden className={`h-2 w-2 rounded-full ${STATE_DOT[snap.state]}`} />
                        {CHARACTER_STATE_LABELS[snap.state]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">Rooms</h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {plan.rooms
              .filter((r) => r.id !== "corridor")
              .map((room) => (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => (room.id === "board-lounge" ? onOpenBoard() : onFocusRoom(room.id))}
                    className="w-full rounded-md px-2.5 py-2 text-left text-xs text-slate-300 ring-1 ring-slate-800 hover:bg-slate-900 hover:text-white"
                  >
                    {room.label}
                  </button>
                </li>
              ))}
          </ul>
        </div>

        <div className="rounded-lg bg-gradient-to-br from-slate-900 to-slate-900/40 p-4 ring-1 ring-slate-800">
          <h3 className="text-sm font-semibold text-white">Sector overview</h3>
          <p className="mt-1 text-xs text-slate-400">
            Independent business sectors will live on their own floors. Take the sector elevator, or:
          </p>
          <Link
            href="/sectors"
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-500/25"
          >
            Open sector overview →
          </Link>
        </div>
      </div>
    </section>
  );
}

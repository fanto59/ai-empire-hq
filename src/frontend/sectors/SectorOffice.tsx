"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FloorCanvas } from "../executive-floor/FloorCanvas";
import { LiveAgentInspector, LiveBadge } from "../executive-floor/LiveAgentInspector";
import { LiveOverviewPanel } from "../executive-floor/LiveOverviewPanel";
import { buildSectorFloor, type SectorFloorInput } from "../office/floor/sector-floor";
import { LiveDirector, type SlotAssignment } from "../office/live/director";
import { characterFor } from "../office/live/looks";
import { connectLiveStream } from "../office/live/stream-client";
import type { ExecutiveFloorHandle } from "../office/pixi/executive-floor-renderer";

/**
 * A sector's office. Rooms come from the sector's real businesses and the
 * employees are the sector's real agents; they move only on their execution
 * events (same authenticated stream and state machine as the Executive Floor).
 */
export function SectorOffice({ input, testData }: { input: SectorFloorInput; testData: boolean }) {
  const router = useRouter();
  const floor = useMemo(() => buildSectorFloor(input), [input]);
  const [director] = useState(
    () =>
      new LiveDirector({
        plan: floor.plan,
        looks: [],
        assignSlots: (agents) => {
          const out: SlotAssignment = new Map();
          for (const a of agents) {
            const seat = floor.seats.get(a.id);
            if (seat) out.set(a.id, { character: characterFor(a, seat.rest), rest: seat.rest, desk: seat.desk });
            else if (floor.overflow.includes(a.id)) out.set(a.id, "overflow");
          }
          return out;
        },
      }),
  );
  const [handle, setHandle] = useState<ExecutiveFloorHandle | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useSyncExternalStore(director.subscribe, director.getVersion, director.getVersion);

  useEffect(() => connectLiveStream(director), [director]);
  useEffect(() => handle?.setSelected(selected), [handle, selected]);

  const key = director.characters().map((c) => c.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the seated agents change
  const cast = useMemo(() => director.characters(), [key, director]);
  const connection = director.getConnection();
  const view = selected ? director.getView(selected) : undefined;
  const onHotspot = useCallback(() => router.push("/office"), [router]);

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-2 text-xs text-emerald-100/90">
        <LiveBadge connection={connection} />
        <span>
          {input.sector.name} office: one room per business, real agents only. Characters move only on their execution events
          {testData ? ". Organization: test data" : ""}.
        </span>
        <Link href={`/sectors/${input.sector.slug}`} className="ml-auto rounded px-2 py-0.5 text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-500/10">
          Sector report
        </Link>
      </div>
      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="relative h-[62vh] min-h-[380px] flex-1 overflow-hidden bg-[#0b1220] lg:h-auto">
          <FloorCanvas
            plan={floor.plan}
            cast={cast}
            director={director}
            mode="live"
            label={`Isometric view of the ${input.sector.name} office: ${floor.rooms.length - 1} business rooms and ${cast.length} real agents. Use the panel to select an agent.`}
            onReady={setHandle}
            onSelectCharacter={setSelected}
            onHotspot={onHotspot}
          />
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
            <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-slate-950/85 p-1 ring-1 ring-slate-800">
              {[
                ["Zoom out", "−", () => handle?.zoomOut()],
                ["Zoom in", "+", () => handle?.zoomIn()],
                ["Fit floor to view", "Fit", () => handle?.fit()],
              ].map(([label, text, fn]) => (
                <button
                  key={label as string}
                  type="button"
                  aria-label={label as string}
                  title={label as string}
                  onClick={fn as () => void}
                  className="min-w-8 rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  {text as string}
                </button>
              ))}
            </div>
            <div className="pointer-events-auto rounded-lg bg-slate-950/85 px-3 py-1.5 text-[11px] text-slate-400 ring-1 ring-slate-800">
              {input.sector.name} · <span className="text-emerald-300">live</span> · elevator → headquarters
            </div>
          </div>
          <div className="pointer-events-auto absolute bottom-3 left-3 hidden max-w-xs rounded-lg bg-slate-950/85 p-2.5 ring-1 ring-slate-800 sm:block">
            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Rooms</p>
            <ul className="space-y-0.5 text-[11px] text-slate-300">
              {floor.rooms.map((r) => (
                <li key={r.roomId}>
                  <button type="button" className="hover:text-white" onClick={() => handle?.focusRoom(r.roomId)}>
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <aside className="w-full border-t border-slate-800 bg-slate-950 lg:w-[380px] lg:border-t-0 lg:border-l">
          <div className="lg:sticky lg:top-0 lg:h-[calc(100dvh-5.5rem)]">
            {view ? (
              <LiveAgentInspector view={view} connection={connection} testData={testData} onClose={() => setSelected(null)} onFollow={() => handle?.focusCharacter(view.agent.id)} />
            ) : (
              <LiveOverviewPanel title={`${input.sector.name} · live`} views={director.views()} offFloor={director.agentsOffFloor()} connection={connection} onSelect={setSelected} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

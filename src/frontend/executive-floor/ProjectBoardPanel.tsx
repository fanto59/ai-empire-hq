import { PROJECT_BOARD_COLUMNS } from "../office/floor/executive-floor";
import type { PrototypeCharacter, SimTask } from "../office/sim/types";
import { SimBadge } from "./SimBadge";
import { hex } from "./state-style";

export function ProjectBoardPanel({
  tasks,
  cast,
  onClose,
}: {
  tasks: readonly SimTask[];
  cast: readonly PrototypeCharacter[];
  onClose: () => void;
}) {
  const owner = (id: string) => cast.find((c) => c.id === id);
  return (
    <section aria-labelledby="board-title" className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="board-title" className="text-base font-semibold text-white">
              Executive project board
            </h2>
            <SimBadge />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Demo tasks moved by the simulation script. Real projects will appear here once persistence and agents are
            connected.
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">
          Close
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {PROJECT_BOARD_COLUMNS.map((column) => {
          const items = tasks.filter((t) => t.status === column.status);
          return (
            <div key={column.status}>
              <h3 className="mb-1.5 flex items-center justify-between text-xs font-semibold tracking-wider text-slate-400 uppercase">
                {column.label}
                <span className="font-normal text-slate-500">{items.length}</span>
              </h3>
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-800 px-3 py-2 text-xs text-slate-600">Empty</p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((t) => {
                    const o = owner(t.ownerId);
                    return (
                      <li key={t.id} className="flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm ring-1 ring-slate-800">
                        <span aria-hidden className="h-6 w-1 rounded-full" style={{ background: o ? hex(o.appearance.accent) : "#64748b" }} />
                        <span className="flex-1 text-slate-200">{t.title}</span>
                        <span className="text-xs text-slate-500">{o?.codename}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

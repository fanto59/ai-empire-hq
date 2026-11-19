import Link from "next/link";
import { BOARD_COLUMNS, TASK_STATE_LABELS, type TaskSummaryView } from "@/domain/task-view";
import type { PrototypeCharacter } from "../office/sim/types";
import { TASK_CHIP, hex } from "./state-style";

export function ProjectBoardPanel({
  tasks,
  cast,
  testData,
  onClose,
}: {
  tasks: readonly TaskSummaryView[] | null;
  cast: readonly PrototypeCharacter[];
  testData: boolean;
  onClose: () => void;
}) {
  const accent = (slug: string | null) => cast.find((c) => c.agentSlug === slug)?.appearance.accent;
  return (
    <section aria-labelledby="board-title" className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="board-title" className="text-base font-semibold text-white">
              Executive project board
            </h2>
            <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-300 uppercase ring-1 ring-emerald-400/30">
              Database
            </span>
            {testData && (
              <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase ring-1 ring-amber-400/30">
                Test data
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Real task records from the operational database, refreshed automatically. Canceled tasks are hidden.
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">
          Close
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {tasks === null ? (
          <p className="rounded-md border border-dashed border-slate-700 p-4 text-sm text-slate-400">
            The database is not set up. Run <code>npm run db:setup</code>, then restart the app.
          </p>
        ) : (
          BOARD_COLUMNS.map((column) => {
            const items = tasks.filter((t) => column.states.includes(t.state));
            return (
              <div key={column.key}>
                <h3 className="mb-1.5 flex items-center justify-between text-xs font-semibold tracking-wider text-slate-400 uppercase">
                  {column.label}
                  <span className="font-normal text-slate-500">{items.length}</span>
                </h3>
                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-800 px-3 py-2 text-xs text-slate-600">Empty</p>
                ) : (
                  <ul className="space-y-1.5">
                    {items.map((t) => {
                      const color = accent(t.assigneeSlug);
                      return (
                        <li key={t.id}>
                          <Link href={`/tasks/${t.id}`} className="flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm ring-1 ring-slate-800 hover:ring-slate-700">
                            <span aria-hidden className="h-6 w-1 shrink-0 rounded-full" style={{ background: color ? hex(color) : "#64748b" }} />
                            <span className="min-w-0 flex-1 text-slate-200">{t.title}</span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ring-1 ${TASK_CHIP[t.state]}`}>{TASK_STATE_LABELS[t.state]}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

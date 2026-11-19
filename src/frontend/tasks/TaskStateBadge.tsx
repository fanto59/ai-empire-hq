import type { TaskState } from "@/domain/task-lifecycle";
import { TASK_STATE_LABELS } from "@/domain/task-view";
import { TASK_CHIP } from "../executive-floor/state-style";

export function TaskStateBadge({ state }: { state: TaskState }) {
  return <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${TASK_CHIP[state]}`}>{TASK_STATE_LABELS[state]}</span>;
}

export function TestDataBadge() {
  return (
    <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-amber-300 uppercase ring-1 ring-amber-400/30">
      Test data
    </span>
  );
}

export function DatabaseSetupNotice() {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-6 text-sm text-slate-400">
      <p className="font-medium text-slate-200">The operational database is not set up</p>
      <p className="mt-1">
        Run <code className="text-slate-300">npm run db:setup</code> to create the embedded database with test data, then
        restart <code className="text-slate-300">npm run dev</code>.
      </p>
    </div>
  );
}

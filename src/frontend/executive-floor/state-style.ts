import type { TaskState } from "@/domain/task-lifecycle";
import type { CharacterState } from "../office/sim/types";

/** Tailwind classes for state chips, shared by legend, lists, inspector. */
export const STATE_DOT: Record<CharacterState, string> = {
  idle: "bg-slate-400",
  walking: "bg-slate-300",
  sitting: "bg-slate-500",
  working: "bg-blue-500",
  collaborating: "bg-violet-400",
  "waiting-approval": "bg-amber-400",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

export const TASK_CHIP: Record<TaskState, string> = {
  queued: "bg-slate-800 text-slate-300 ring-slate-700",
  assigned: "bg-sky-950 text-sky-300 ring-sky-800",
  running: "bg-blue-950 text-blue-300 ring-blue-800",
  waiting: "bg-amber-950 text-amber-300 ring-amber-800",
  paused: "bg-slate-800 text-slate-400 ring-slate-700",
  completed: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  failed: "bg-red-950 text-red-300 ring-red-800",
  canceled: "bg-slate-900 text-slate-500 ring-slate-800",
};

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function formatSimTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

import type { CharacterState, SimTaskStatus } from "../office/sim/types";

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

export const TASK_CHIP: Record<SimTaskStatus, string> = {
  todo: "bg-slate-800 text-slate-300 ring-slate-700",
  "in-progress": "bg-blue-950 text-blue-300 ring-blue-800",
  "awaiting-approval": "bg-amber-950 text-amber-300 ring-amber-800",
  done: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  blocked: "bg-red-950 text-red-300 ring-red-800",
};

export const TASK_LABEL: Record<SimTaskStatus, string> = {
  todo: "Backlog",
  "in-progress": "In progress",
  "awaiting-approval": "Awaiting approval",
  done: "Done",
  blocked: "Blocked",
};

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function formatSimTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

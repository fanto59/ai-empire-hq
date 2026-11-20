"use client";

import { useActionState } from "react";

/**
 * Sector administration forms (shown only to signed-in administrators; the
 * server re-checks every action). Values are record ids and names only.
 */
export interface AdminFormState {
  ok: boolean;
  message: string | null;
}
type Action = (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
const INITIAL: AdminFormState = { ok: false, message: null };
const input = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none";
const button =
  "rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500";

function Status({ state }: { state: AdminFormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
      {state.message}
    </p>
  );
}

export function AddBusinessForm({ sectorId, sectorName, action }: { sectorId: string; sectorName: string; action: Action }) {
  void sectorName;
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="sectorId" value={sectorId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <label className="block text-xs text-slate-400">
          Business name
          <input name="name" required minLength={2} maxLength={80} className={input} placeholder="New business name" />
        </label>
        <label className="block text-xs text-slate-400">
          Description <span className="text-slate-600">(optional)</span>
          <input name="description" maxLength={500} className={input} />
        </label>
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Adding…" : "Add business"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function BusinessStatusButtons({ businessId, name, status, action }: { businessId: string; name: string; status: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const ops: [string, string][] =
    status === "archived" ? [["restore", "Restore"]] : [...(["planning", "active", "paused"] as const).filter((s) => s !== status).map((s): [string, string] => [s, `Mark ${s}`]), ["archive", "Archive"]];
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="businessId" value={businessId} />
      <div className="flex flex-wrap gap-1.5">
        {ops.map(([op, label]) => (
          <button
            key={op}
            type="submit"
            name="op"
            value={op}
            disabled={pending}
            aria-label={`${label}: ${name}`}
            onClick={(e) => {
              if (op === "archive" && !window.confirm(`Archive ${name}? It will take no new work until restored.`)) e.preventDefault();
            }}
            className={`rounded px-2 py-1 text-xs ring-1 transition disabled:opacity-50 ${
              op === "archive" ? "text-red-200 ring-red-500/40 hover:bg-red-500/10" : "text-slate-200 ring-slate-700 hover:bg-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Status state={state} />
    </form>
  );
}

export function AddAgentForm({ scopes, action }: { scopes: { value: string; label: string }[]; action: Action }) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1.2fr_auto] sm:items-end">
        <label className="block text-xs text-slate-400">
          Agent name
          <input name="name" required minLength={2} maxLength={80} className={input} />
        </label>
        <label className="block text-xs text-slate-400">
          Role
          <select name="role" className={input} defaultValue="specialist">
            <option value="sector-manager">Sector manager</option>
            <option value="business-lead">Business lead</option>
            <option value="specialist">Specialist</option>
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Works for
          <select name="scope" className={input}>
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Creating…" : "Create agent"}
        </button>
      </div>
      <p className="text-xs text-slate-500">New agents get no tasks and no paid capabilities. Nothing runs until you assign work.</p>
      <Status state={state} />
    </form>
  );
}

export function AddProjectForm({ scopes, owners, action }: { scopes: { value: string; label: string }[]; owners: { id: string; name: string }[]; action: Action }) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1.2fr_1fr_auto] sm:items-end">
        <label className="block text-xs text-slate-400">
          Project title
          <input name="title" required minLength={3} maxLength={120} className={input} />
        </label>
        <label className="block text-xs text-slate-400">
          Scope
          <select name="scope" className={input}>
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Lead agent <span className="text-slate-600">(optional)</span>
          <select name="ownerAgentId" className={input} defaultValue="">
            <option value="">None</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Creating…" : "Create project"}
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import type { AdminFormState } from "../sectors/AdminForms";

type Action = (prev: AdminFormState, form: FormData) => Promise<AdminFormState>;
const INITIAL: AdminFormState = { ok: false, message: null };

function Status({ state }: { state: AdminFormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
      {state.ok ? "✓ " : "✕ "}
      {state.message}
    </p>
  );
}

/** One button: create the starter team, projects and blank profile (server re-checks businesses:admin). */
export function StarterButton({ businessId, name, action }: { businessId: string; name: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="space-y-1.5">
      <input type="hidden" name="businessId" value={businessId} />
      <button type="submit" disabled={pending} className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500">
        {pending ? "Setting up…" : `Set up the ${name} starter team`}
      </button>
      <Status state={state} />
    </form>
  );
}

/** The owner's profile editor. Plain Markdown; secrets are refused by the server. */
export function ProfileEditor({ businessId, initial, action }: { businessId: string; initial: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [body, setBody] = useState(initial);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="businessId" value={businessId} />
      <label htmlFor="profile" className="block text-xs text-slate-400">
        Replace each &quot;Not filled in yet&quot; with real details. Agents use only what is written here. Never paste passwords or API keys.
      </label>
      <textarea
        id="profile"
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={18}
        minLength={10}
        maxLength={50000}
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 focus:border-sky-500 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500">
          {pending ? "Saving…" : "Save profile"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

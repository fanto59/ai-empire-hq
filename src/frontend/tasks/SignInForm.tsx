"use client";

import { useActionState } from "react";

export function SignInForm({ action }: { action: (prev: { error: string | null }, form: FormData) => Promise<{ error: string | null }> }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="space-y-3">
      <label htmlFor="token" className="block text-sm font-medium text-slate-200">
        API token
      </label>
      <input
        id="token"
        name="token"
        type="password"
        autoComplete="off"
        required
        placeholder="aehq_…"
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
      />
      {state.error && (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/25">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 ring-1 ring-sky-400/40 hover:bg-sky-500/30 disabled:opacity-60"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

interface State {
  ok: boolean;
  message: string | null;
  taskId: string | null;
}

export function ResearchForm({
  action,
  businesses,
}: {
  action: (prev: State, form: FormData) => Promise<State>;
  businesses: { id: string; name: string; agentName: string | null }[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: null, taskId: null });
  const [key] = useState(() => `research-${crypto.randomUUID()}`);
  // Same key while retrying a failed submission; a new key after each success.
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={`${key}-${state.taskId ?? "0"}`} />
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <label htmlFor="question" className="block text-sm font-medium text-slate-200">
            Research question
          </label>
          <textarea
            id="question"
            name="question"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            placeholder="e.g. When was the Hubble Space Telescope launched, and what are its main instruments?"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="businessId" className="block text-sm font-medium text-slate-200">
            Business
          </label>
          <select
            id="businessId"
            name="businessId"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.agentName ? "" : " (no research agent)"}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 ring-1 ring-sky-400/40 hover:bg-sky-500/30 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create research task"}
        </button>
        {state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
            {state.message}{" "}
            {state.taskId && (
              <Link href={`/tasks/${state.taskId}`} className="underline">
                View task
              </Link>
            )}
          </p>
        )}
      </div>
    </form>
  );
}

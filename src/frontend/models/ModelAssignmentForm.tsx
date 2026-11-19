"use client";

import { useActionState, useState } from "react";

export interface ModelFormState {
  ok: boolean;
  message: string | null;
}

export interface ModelOption {
  id: string;
  label: string;
  providerLabel: string;
  /** e.g. "$2 / $10 per M tokens" */
  priceLabel: string;
  availability: "available" | "unavailable" | "unverified";
  /** Disabled for this agent (e.g. no web search for a research agent). */
  disabledReason: string | null;
}

const AVAIL: Record<ModelOption["availability"], string> = {
  available: "available",
  unavailable: "not offered",
  unverified: "unverified",
};

/** One agent's provider/model picker. No secrets: only model IDs and labels reach the browser. */
export function ModelAssignmentForm({
  agentId,
  agentName,
  current,
  options,
  action,
}: {
  agentId: string;
  agentName: string;
  current: string;
  options: ModelOption[];
  action: (prev: ModelFormState, form: FormData) => Promise<ModelFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: null });
  const [model, setModel] = useState(current);
  const groups = [...new Set(options.map((o) => o.providerLabel))];
  const selected = options.find((o) => o.id === model);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="agentId" value={agentId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`model-${agentId}`} className="sr-only">
          Model for {agentName}
        </label>
        <select
          id={`model-${agentId}`}
          name="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
        >
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.providerLabel === g)
                .map((o) => (
                  <option key={o.id} value={o.id} disabled={o.availability === "unavailable" || o.disabledReason !== null}>
                    {o.label} · {o.priceLabel}
                    {o.availability !== "available" ? ` · ${AVAIL[o.availability]}` : ""}
                    {o.disabledReason ? ` · ${o.disabledReason}` : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending || model === current}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {selected && selected.availability === "unverified" && model !== current && (
        <p className="text-xs text-amber-200">
          This model can&apos;t be confirmed with the provider right now (not connected or unreachable). You can still save it; if the provider turns out not to offer it, the agent&apos;s tasks fail with a clear error.
        </p>
      )}
      {state.message && (
        <p role="status" className={`text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

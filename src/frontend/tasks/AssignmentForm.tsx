"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

export interface AssignmentFormState {
  ok: boolean;
  message: string | null;
  taskId: string | null;
}

export interface AgentOption {
  id: string;
  label: string;
  capability: "plans-objectives" | "runs-research" | "runs-work" | "tracked-only";
  /** Sector agents: pick which business of the sector the work is for. */
  businesses?: { id: string; name: string }[];
}

const HINT: Record<AgentOption["capability"], string> = {
  "plans-objectives": "Runs automatically: the Chief AI Manager reviews your records and proposes a plan.",
  "runs-research": "Runs automatically: the Research Agent searches approved sites and writes a report.",
  "runs-work": "Runs on its assigned model: reads the business profile, notes and tasks, then writes a draft deliverable. Nothing is sent, paid or published; spending stays within the business budget.",
  "tracked-only": "Tracked only: this agent isn't connected to a model yet, so the task waits on its list.",
};

/** A ready-made assignment the person can load into the form (nothing is created until they submit). */
export interface AssignmentPreset {
  agentId: string;
  title: string;
  instructions: string;
}

export function AssignmentForm({
  agents,
  action,
  defaultAgentId,
  presets = [],
}: {
  agents: AgentOption[];
  action: (prev: AssignmentFormState, form: FormData) => Promise<AssignmentFormState>;
  defaultAgentId?: string;
  presets?: AssignmentPreset[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: null, taskId: null });
  const [key] = useState(() => `assign-${crypto.randomUUID()}`);
  const [agentId, setAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const selected = agents.find((a) => a.id === agentId);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={`${key}-${state.taskId ?? "0"}`} />
      {presets.length > 0 && (
        <div>
          <p className="text-xs text-slate-400">Starting points (loads the form; you can edit before assigning):</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={`${p.agentId}-${p.title}`}
                type="button"
                onClick={() => {
                  setAgentId(p.agentId);
                  setTitle(p.title);
                  setInstructions(p.instructions);
                }}
                className="rounded px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-800"
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="agentId" className="block text-sm font-medium text-slate-200">
            Agent
          </label>
          <select
            id="agentId"
            name="agentId"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-slate-200">
            Title <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input
            id="title"
            name="title"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label htmlFor="instructions" className="block text-sm font-medium text-slate-200">
          Assignment
        </label>
        <textarea
          id="instructions"
          name="instructions"
          required
          minLength={10}
          maxLength={4000}
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="What should this agent do, and what does done look like?"
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
        />
        {selected && <p className="mt-1 text-xs text-slate-400">{HINT[selected.capability]}</p>}
      </div>
      {selected?.businesses && (
        <div>
          <label htmlFor="businessId" className="block text-sm font-medium text-slate-200">
            For which business
          </label>
          <select
            key={selected.id}
            id="businessId"
            name="businessId"
            required
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none sm:w-1/2"
          >
            {selected.businesses.length === 0 && <option value="">No businesses in this sector yet</option>}
            {selected.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Sector agents work across their sector, one business per assignment.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !agentId}
          className="rounded-md bg-sky-500/20 px-4 py-2 text-sm font-medium text-sky-100 ring-1 ring-sky-400/40 hover:bg-sky-500/30 disabled:opacity-60"
        >
          {pending ? "Assigning…" : "Give assignment"}
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

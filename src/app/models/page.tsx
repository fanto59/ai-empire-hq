import type { Metadata } from "next";
import Link from "next/link";
import { CATALOG_CHECKED_ON, MODELS, PROVIDER_LABELS, WORK_TYPES, type ModelInfo } from "@/agents/providers/catalog";
import { getProvider, modelAvailability, PROVIDER_IDS } from "@/agents/providers/registry";
import { getSessionContext } from "@/backend/auth/session";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { listAgentModels } from "@/backend/models/assignment";
import { getModelEvaluation } from "@/backend/models/evaluation";
import { formatUsd } from "@/domain/money";
import { ModelAssignmentForm, type ModelOption } from "@/frontend/models/ModelAssignmentForm";
import { DatabaseSetupNotice, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { setAgentModelAction } from "./actions";

export const metadata: Metadata = { title: "Models · AI Empire HQ" };
export const dynamic = "force-dynamic";

const money = (usdPerM: number) => `$${usdPerM < 1 ? usdPerM.toFixed(2) : usdPerM % 1 === 0 ? usdPerM.toFixed(0) : usdPerM.toFixed(2)}`;
const priceLabel = (m: ModelInfo) => `${money(m.price.inputPerMTok)}/${money(m.price.outputPerMTok)} per M`;

const AVAIL_CHIP = {
  available: { text: "Available", className: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
  unavailable: { text: "Not offered", className: "bg-red-500/10 text-red-300 ring-red-500/30" },
  unverified: { text: "Unverified", className: "bg-slate-800 text-slate-300 ring-slate-700" },
} as const;

export default async function ModelsPage() {
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  if (!db || !org) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <DatabaseSetupNotice />
      </main>
    );
  }
  const [agents, evaluation, availability, session] = await Promise.all([
    listAgentModels(db, org.id),
    getModelEvaluation(db, org.id),
    modelAvailability(getProvider),
    getSessionContext(db),
  ]);
  const isAdmin = Boolean(session && session.scopes.has("models:admin") && session.businesses === "*" && session.hq);
  const providers = PROVIDER_IDS.map((id) => {
    const sample = availability.get(MODELS.find((m) => m.provider === id)!.id);
    return {
      id,
      label: PROVIDER_LABELS[id],
      status: getProvider(id).status(),
      restrictions: getProvider(id).restrictions,
      modelCheck: sample?.checkedAt ? `checked ${sample.checkedAt.slice(11, 16)} UTC` : `not checked (${sample?.detail ?? "unknown"})`,
    };
  });
  const assignable = MODELS.filter((m) => m.assignable);
  const optionsFor = (workType: string): ModelOption[] =>
    assignable.map((m) => ({
      id: m.id,
      label: m.label,
      providerLabel: PROVIDER_LABELS[m.provider],
      priceLabel: priceLabel(m),
      availability: availability.get(m.id)?.state ?? "unverified",
      disabledReason: workType === "research" && !m.webSearch ? "no web search" : null,
    }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Operations</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">Models</h1>
          {org.isTestData && <TestDataBadge />}
        </div>
        <p className="mt-2 max-w-2xl text-slate-400">
          Choose which provider and model powers each agent. Every task runs on exactly one model: the one assigned to the
          agent doing it. Tasks are never sent to all three providers.
        </p>
      </header>

      <div className="space-y-6">
        {/* ---- providers ---- */}
        <section aria-labelledby="providers-title">
          <h2 id="providers-title" className="mb-3 text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Providers
          </h2>
          <div className="grid gap-3 md:grid-cols-3">
            {providers.map((p) => (
              <div key={p.id} className="flex min-w-0 flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-white">{p.label}</h3>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${p.status.ready ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" : "bg-slate-800 text-slate-300 ring-slate-700"}`}
                  >
                    {p.status.ready ? "Ready" : "Not connected"}
                  </span>
                </div>
                <dl className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-400">App API key</dt>
                    <dd className="text-slate-200">{p.status.keyConfigured ? "Set (hidden)" : "Not set"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-400">Provider switch</dt>
                    <dd className="text-slate-200">{p.status.enabled ? "On" : "Off"}</dd>
                  </div>
                </dl>
                {!p.status.ready && <p className="mt-2 text-xs text-slate-400">{p.status.reason}</p>}
                {p.status.ready && <p className="mt-2 text-xs text-slate-400">Model list: {p.modelCheck}</p>}
                <details className="mt-3 text-xs text-slate-400">
                  <summary className="cursor-pointer select-none hover:text-slate-200">Safety restrictions</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {p.restrictions.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Keys are read only on the server and never sent to the browser. Set them in your environment settings, not in this page.
          </p>
        </section>

        {/* ---- assignments ---- */}
        <section aria-labelledby="assign-title" className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="assign-title" className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
              Agent models
            </h2>
            {!isAdmin && (
              <p className="text-xs text-slate-400">
                {session ? "Your token can't change models (needs the models:admin scope)." : (
                  <>
                    <Link href="/login" className="text-sky-300 hover:text-sky-200">
                      Sign in
                    </Link>{" "}
                    with an administrator token to change models.
                  </>
                )}
              </p>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Initial roles: {Object.values(WORK_TYPES).map((w) => `${PROVIDER_LABELS[w.provider].split(" ")[0]} for ${w.label.toLowerCase()}`).join(" · ")}. Change any agent below.
          </p>
          <ul className="mt-4 divide-y divide-slate-800">
            {agents.map((a) => (
              <li key={a.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
                <div className="min-w-0">
                  <p className="font-medium text-slate-100">{a.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {WORK_TYPES[a.workType].label} · {a.runsAutomatically ? "runs automatically" : "tracked only (no worker yet)"}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {PROVIDER_LABELS[a.provider]} · {a.modelLabel}
                    {a.isDefault && <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">initial default</span>}
                  </p>
                </div>
                {isAdmin ? (
                  <ModelAssignmentForm agentId={a.id} agentName={a.name} current={a.model} options={optionsFor(a.workType)} action={setAgentModelAction} />
                ) : (
                  <p className="text-xs text-slate-500">Read-only</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* ---- evaluation ---- */}
        <section aria-labelledby="eval-title" className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 id="eval-title" className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            How each model did on real tasks · last 90 days
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            From actual task attempts and their recorded API costs. Use this to decide whether an assignment is working.
          </p>
          {evaluation.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No runs yet. Results appear here once agents finish real tasks.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm tabular-nums">
                <thead className="text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="py-1.5 pr-3 font-semibold">Model</th>
                    <th className="py-1.5 pr-3 font-semibold">Task type</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Attempts</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Succeeded</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Cost per success</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Avg time</th>
                    <th className="py-1.5 text-right font-semibold">Total cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {evaluation.map((r) => (
                    <tr key={`${r.provider}-${r.model}-${r.taskKind}`}>
                      <td className="py-1.5 pr-3 font-mono text-xs">{r.model}</td>
                      <td className="py-1.5 pr-3">{r.taskKind}</td>
                      <td className="py-1.5 pr-3 text-right">{r.runs}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {r.succeeded} ({Math.round((r.succeeded / r.runs) * 100)}%)
                      </td>
                      <td className="py-1.5 pr-3 text-right">{r.avgCostPerSuccessMicros === null ? "–" : formatUsd(r.avgCostPerSuccessMicros)}</td>
                      <td className="py-1.5 pr-3 text-right">{r.avgDurationSeconds === null ? "–" : `${r.avgDurationSeconds}s`}</td>
                      <td className="py-1.5 text-right text-slate-100">{formatUsd(r.totalCostMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---- catalog ---- */}
        <section aria-labelledby="catalog-title" className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 id="catalog-title" className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
            Model catalog
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            IDs and prices checked against provider documentation on {CATALOG_CHECKED_ON}. Availability is confirmed live with each
            provider&apos;s model list using the app&apos;s key (refreshed every 10 minutes).
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm tabular-nums">
              <thead className="text-xs text-slate-500 uppercase">
                <tr>
                  <th className="py-1.5 pr-3 font-semibold">Model</th>
                  <th className="py-1.5 pr-3 font-semibold">Provider</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Input / output per M</th>
                  <th className="py-1.5 pr-3 font-semibold">Web search</th>
                  <th className="py-1.5 font-semibold">Availability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {assignable.map((m) => {
                  const a = availability.get(m.id);
                  const chip = AVAIL_CHIP[a?.state ?? "unverified"];
                  return (
                    <tr key={m.id}>
                      <td className="py-1.5 pr-3">
                        <span className="text-slate-100">{m.label}</span>
                        <span className="ml-2 font-mono text-xs text-slate-500">{m.id}</span>
                      </td>
                      <td className="py-1.5 pr-3">{PROVIDER_LABELS[m.provider]}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {money(m.price.inputPerMTok)} / {money(m.price.outputPerMTok)}
                        {m.priceStatus === "conservative" && (
                          <span className="ml-1 text-amber-300" title={m.note ?? "Sources disagreed or a discount is unknown; the higher price is used for limits."}>
                            *
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{m.webSearch ? "Yes" : "No"}</td>
                      <td className="py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${chip.className}`} title={a?.detail}>
                          {chip.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            <span className="text-amber-300">*</span> Conservative price: the provider&apos;s pages disagreed or a cache discount is
            unpublished, so the higher figure is used for spending limits.
          </p>
        </section>
      </div>
    </main>
  );
}

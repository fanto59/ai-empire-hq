import type { Metadata } from "next";
import Link from "next/link";
import { businessAgentContext, getKnowledgeService, getKnowledgeSync, KnowledgeError, ownerContext } from "@/backend/knowledge";
import type { KnowledgeNoteSummary } from "@/domain/knowledge";
import { noteHref } from "@/frontend/knowledge/Markdown";
import { KindBadge, SampleBadge, scopeLabel } from "@/frontend/knowledge/NoteBadges";

export const metadata: Metadata = { title: "Knowledge · AI Empire HQ" };
export const dynamic = "force-dynamic";

const DEMO_BUSINESS = "sample-business";
const OTHER_BUSINESS_NOTE = "businesses/sample-business-b/business.md";

export default async function KnowledgePage() {
  const service = getKnowledgeService();
  // No authentication yet: the dashboard reads as the owner.
  const owner = ownerContext();
  const agent = businessAgentContext("research-agent", DEMO_BUSINESS);

  const [{ notes, skipped }, agentView, sync] = await Promise.all([
    service.listNotes(owner),
    service.listNotes(agent),
    getKnowledgeSync().status(),
  ]);
  let denial = "";
  try {
    await service.readNote(agent, OTHER_BUSINESS_NOTE);
    denial = "Unexpected: the read was allowed.";
  } catch (e) {
    denial = e instanceof KnowledgeError ? e.message : "Denied.";
  }

  const groups = new Map<string, KnowledgeNoteSummary[]>();
  for (const n of notes) {
    const key = scopeLabel(n.meta.business);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Knowledge</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Knowledge vault</h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          Markdown notes in an Obsidian-compatible vault on this server, organized by business, project, report and
          agent. The notes below are <span className="text-amber-300">sample content</span>.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-6 lg:col-span-2" aria-label="Notes">
          {[...groups.entries()]
            .sort(([a], [b]) => (a === "Headquarters" ? -1 : b === "Headquarters" ? 1 : a.localeCompare(b)))
            .map(([scope, items]) => (
            <div key={scope} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-100 uppercase">
                {scope === "Headquarters" ? "Headquarters" : `Business · ${scope}`}
              </h2>
              <ul className="divide-y divide-slate-800">
                {items.map((n) => (
                  <li key={n.path}>
                    <Link href={noteHref(n.path)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:text-white">
                      <KindBadge kind={n.meta.kind} />
                      <span className="min-w-0 flex-1 font-medium text-slate-200">{n.meta.title}</span>
                      {n.meta.origin === "sample" && <SampleBadge />}
                      <code className="w-full truncate text-xs text-slate-500">{n.path}</code>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {notes.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-slate-400">
              The vault is empty. Run <code>npm run knowledge:seed</code> to create the sample notes.
            </p>
          )}
          {skipped > 0 && <p className="text-xs text-amber-300">{skipped} file(s) skipped because they failed validation.</p>}
        </section>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">Access isolation</h2>
            <p className="mt-2 text-sm text-slate-400">
              Live check against the vault: a Research Agent scoped to <code className="text-slate-300">{DEMO_BUSINESS}</code>.
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Owner can see</dt>
                <dd className="font-medium text-slate-200">{notes.length} notes</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Agent can see</dt>
                <dd className="font-medium text-slate-200">{agentView.notes.length} notes</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/25">
              Agent reading another business&apos;s note: {denial}
            </p>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="text-sm font-semibold tracking-wide text-slate-100 uppercase">Obsidian sync</h2>
            <p className="mt-2 flex items-center gap-2 text-sm">
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">{sync.state}</span>
            </p>
            <p className="mt-2 text-sm text-slate-400">{sync.detail}</p>
            <p className="mt-2 text-xs text-slate-500">
              To browse these notes in Obsidian, open the repository&apos;s <code>knowledge/sample-vault</code> folder as a vault.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

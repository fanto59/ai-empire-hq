import type { Metadata } from "next";
import Link from "next/link";
import { getKnowledgeService, KnowledgeError, ownerContext } from "@/backend/knowledge";
import type { KnowledgeNote } from "@/domain/knowledge";
import { Markdown, noteHref } from "@/frontend/knowledge/Markdown";
import { KindBadge, SampleBadge, scopeLabel } from "@/frontend/knowledge/NoteBadges";

export const metadata: Metadata = { title: "Note · AI Empire HQ" };
export const dynamic = "force-dynamic";

export default async function NotePage({ searchParams }: { searchParams: Promise<{ path?: string | string[] }> }) {
  const { path } = await searchParams;
  let note: KnowledgeNote | null = null;
  let error = "";
  try {
    note = await getKnowledgeService().readNote(ownerContext(), typeof path === "string" ? path : "");
  } catch (e) {
    error = e instanceof KnowledgeError ? e.message : "The note could not be loaded.";
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/knowledge" className="text-sm text-sky-300 hover:text-sky-200">
        ← Knowledge vault
      </Link>

      {!note ? (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h1 className="text-lg font-semibold text-white">Note unavailable</h1>
          <p className="mt-1 text-slate-400">{error}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <KindBadge kind={note.meta.kind} />
              {note.meta.origin === "sample" && <SampleBadge />}
              <code className="text-xs text-slate-500">{note.path}</code>
            </div>
            <Markdown source={note.body} />
          </article>

          <aside className="space-y-6">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-100 uppercase">Properties</h2>
              <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
                <Prop label="Title">{note.meta.title}</Prop>
                <Prop label="Business">{scopeLabel(note.meta.business)}</Prop>
                <Prop label="Project">{note.meta.project ?? "—"}</Prop>
                <Prop label="Agent">{note.meta.agent ?? "—"}</Prop>
                <Prop label="Status">{note.meta.status}</Prop>
                <Prop label="Access">{note.meta.confidentiality}</Prop>
                <Prop label="Author">
                  {note.meta.authorKind}: {note.meta.authorId}
                </Prop>
                <Prop label="Origin">{note.meta.origin}</Prop>
                <Prop label="Updated">{note.meta.updated.slice(0, 16).replace("T", " ")} UTC</Prop>
                <Prop label="Tags">
                  <span className="flex flex-wrap gap-1">
                    {note.meta.tags.map((t) => (
                      <code key={t} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
                        #{t}
                      </code>
                    ))}
                  </span>
                </Prop>
              </dl>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-100 uppercase">Linked tasks</h2>
              {note.meta.tasks.length === 0 ? (
                <p className="text-sm text-slate-500">None</p>
              ) : (
                <ul className="space-y-1.5">
                  {note.meta.tasks.map((t) => (
                    <li key={t} className="text-sm">
                      <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">{t}</code>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-slate-500">Task storage isn&apos;t connected yet, so task ids are shown as references.</p>
            </section>

            {note.meta.project && note.meta.business && (
              <Link
                href={noteHref(`businesses/${note.meta.business}/projects/${note.meta.project}`)}
                className="block rounded-lg px-4 py-2.5 text-sm text-sky-300 ring-1 ring-slate-800 hover:bg-slate-900"
              >
                Open project note →
              </Link>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-200">{children}</dd>
    </>
  );
}

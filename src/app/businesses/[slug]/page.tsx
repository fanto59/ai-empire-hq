import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ownerRequestContext } from "@/backend/auth/context";
import { getSessionContext } from "@/backend/auth/session";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { getKnowledgeService } from "@/backend/knowledge";
import { getBusinessOverview } from "@/backend/org/business-overview";
import { listAssignableAgents } from "@/backend/tasks/assignments";
import { starterKitFor } from "@/domain/business-starter";
import { formatUsd } from "@/domain/money";
import { BUSINESS_STATUS_LABELS, type BusinessStatus } from "@/domain/sectors";
import type { TaskState } from "@/domain/task-lifecycle";
import { ProfileEditor, StarterButton } from "@/frontend/businesses/BusinessForms";
import { Markdown, noteHref } from "@/frontend/knowledge/Markdown";
import { AssignmentForm } from "@/frontend/tasks/AssignmentForm";
import { DatabaseSetupNotice, TaskStateBadge, TestDataBadge } from "@/frontend/tasks/TaskStateBadge";
import { assignWorkAction } from "../../agents/actions";
import { saveProfileAction, starterAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return { title: `${(await params).slug.replace(/-/g, " ")} · Businesses · AI Empire HQ` };
}

const card = "rounded-xl border border-slate-800 bg-slate-900/60 p-5";
const h2 = "text-sm font-semibold tracking-wide text-slate-100 uppercase";
const role = (r: string) => r.replace(/-/g, " ");

export default async function BusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  if (!db || !org) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <DatabaseSetupNotice />
      </main>
    );
  }
  const knowledge = getKnowledgeService();
  const [o, session] = await Promise.all([getBusinessOverview(db, knowledge, ownerRequestContext(org.id), slug), getSessionContext(db)]);
  if (!o) notFound();
  const isAdmin = Boolean(session && session.scopes.has("businesses:admin") && session.businesses === "*" && session.hq);
  const canAssign = Boolean(session?.scopes.has("tasks:write"));
  const kit = starterKitFor(o.sector?.slug ?? null);
  const hasTeam = o.team.length > 0;
  const assignable = canAssign ? (await listAssignableAgents(db, org.id)).filter((a) => a.businessId === o.business.id || (a.sectorId && a.sectorBusinesses.some((b) => b.id === o.business.id))) : [];
  const presets = kit.suggestedAssignments.flatMap((s) => {
    const agent = o.team.find((a) => (s.role === "lead" ? a.role === "business-lead" : a.departmentSlug === s.role) && a.status === "active");
    return agent ? [{ agentId: agent.id, title: s.title, instructions: s.instructions }] : [];
  });
  const budgetEmpty = !o.budget || o.budget.limitMicros === 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <nav className="mb-3 text-sm">
        {o.sector ? (
          <Link href={`/sectors/${o.sector.slug}`} className="text-sky-300 hover:text-sky-200">
            ← {o.sector.name}
          </Link>
        ) : (
          <Link href="/sectors" className="text-sky-300 hover:text-sky-200">
            ← Sectors
          </Link>
        )}
      </nav>
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Business</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-white">{o.business.name}</h1>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{BUSINESS_STATUS_LABELS[o.business.status as BusinessStatus] ?? o.business.status}</span>
          {o.isTestData && <TestDataBadge />}
        </div>
        {o.business.description && <p className="mt-2 max-w-2xl text-slate-400">{o.business.description}</p>}
      </header>

      <section aria-label="Business totals" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Profile", o.profile ? `${o.profile.filled} of ${o.profile.total}` : "None", o.profile ? "sections filled in" : "not created yet"],
          ["Team", String(o.team.length), `${o.departments.length} departments`],
          ["API spend this month", formatUsd(o.spendMonthMicros), "recorded model calls only"],
          ["Budget this month", o.budget ? formatUsd(o.budget.limitMicros) : "$0 (none set)", budgetEmpty ? "agents cannot spend until you set one" : `${formatUsd(o.budget!.spentMicros)} used`],
        ].map(([label, value, detail]) => (
          <div key={label} className={card.replace("p-5", "p-4")}>
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-xl font-semibold text-white tabular-nums">{value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
          </div>
        ))}
      </section>

      {(!hasTeam || isAdmin) && (
        <section className={`${card} mb-6 ${hasTeam ? "" : "border-sky-900"}`} aria-labelledby="starter-title">
          <h2 id="starter-title" className={h2}>
            {hasTeam ? "Starter kit" : `Get ${o.business.name} started`}
          </h2>
          {hasTeam && <p className="mt-1 text-sm text-slate-400">The team is set up. Running the starter again only adds what is missing; it never changes your profile.</p>}
          <p className={`mt-1 max-w-3xl text-sm text-slate-400 ${hasTeam ? "hidden" : ""}`}>
            Creates {kit.departments.length} departments ({kit.departments.map((d) => d.name).join(", ")}), a Business Lead and {kit.specialists.length} specialists, {kit.projects.length} proposed projects, and a profile
            template with every section left blank for you. It invents no facts and starts no work: agents only act when you assign something, and only within this business&apos;s budget.
          </p>
          <div className="mt-3">
            {isAdmin ? (
              <StarterButton businessId={o.business.id} name={o.business.name} action={starterAction} />
            ) : (
              <p className="text-xs text-slate-500">{session ? "Your token can't change the organization (needs businesses:admin)." : <><Link href="/login" className="text-sky-300">Sign in</Link> as an administrator to set it up.</>}</p>
            )}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`} aria-labelledby="profile-title">
          <h2 id="profile-title" className={h2}>
            Business profile
          </h2>
          <p className="mt-1 text-xs text-slate-400">The facts the agents work from. Only you write this; agents never edit it.</p>
          <div className="mt-3">
            {isAdmin ? (
              <ProfileEditor
                businessId={o.business.id}
                initial={o.profile?.body ?? `# ${o.business.name}\n\n## What the business does\n_Not filled in yet._\n`}
                action={saveProfileAction}
              />
            ) : o.profile ? (
              <div className="prose-sm text-sm text-slate-300">
                <Markdown source={o.profile.body} />
              </div>
            ) : (
              <p className="text-sm text-slate-500">No profile yet.</p>
            )}
          </div>
        </section>

        <section className={card} aria-labelledby="team-title">
          <h2 id="team-title" className={h2}>
            Team
          </h2>
          {o.team.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No agents for this business yet.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {o.team.map((a) => (
                <li key={a.id}>
                  <Link href={`/agents?agent=${a.slug}`} className="text-slate-100 hover:text-white">
                    {a.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {role(a.role)}
                    {a.department ? ` · ${a.department}` : ""} · {a.model}
                    {a.status !== "active" ? ` · ${a.status}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {o.sectorTeam.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold text-slate-400">Sector team (also works here)</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {o.sectorTeam.map((a) => (
                  <li key={a.id} className="text-slate-300">
                    {a.name} <span className="text-xs text-slate-500">· {a.model}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Models are chosen on{" "}
            <Link href="/models" className="text-sky-300">
              Models
            </Link>
            .
          </p>
        </section>
      </div>

      <section className={`${card} mt-6`} aria-labelledby="assign-title">
        <h2 id="assign-title" className={h2}>
          Give the team work
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          The agent reads the profile, notes and tasks of {o.business.name}, then writes a draft deliverable for you. It cannot send messages, pay, sign, publish or post; anything like that becomes a
          proposal for you on{" "}
          <Link href="/control" className="text-sky-300">
            Control
          </Link>
          .
        </p>
        {budgetEmpty && (
          <p className="mt-2 rounded-md bg-amber-950/50 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-800">
            {o.business.name} has no API budget this month, so assigned work will stop before any model call. Set one with{" "}
            <code>npm run budget:set -- --usd 5 --business {o.business.slug}</code> or on Control.
          </p>
        )}
        <div className="mt-3">
          {!session ? (
            <p className="text-sm text-slate-400">
              <Link href="/login" className="text-sky-300">
                Sign in
              </Link>{" "}
              to give assignments.
            </p>
          ) : assignable.length === 0 ? (
            <p className="text-sm text-slate-500">No active agents can take work for this business yet.</p>
          ) : (
            <AssignmentForm
              action={assignWorkAction}
              presets={presets}
              agents={assignable.map((a) => ({
                id: a.id,
                label: `${a.displayName}${a.sectorId ? " (sector)" : ""}`,
                capability: a.capability,
                businesses: a.sectorId ? a.sectorBusinesses.filter((b) => b.id === o.business.id) : undefined,
              }))}
            />
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className={card} aria-labelledby="deliverables-title">
          <h2 id="deliverables-title" className={h2}>
            Deliverables from agents
          </h2>
          {o.deliverables.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nothing yet. Deliverables appear here after an agent finishes an assignment.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-800 text-sm">
              {o.deliverables.map((d) => (
                <li key={d.path} className="py-2">
                  <Link href={noteHref(d.path)} className="text-slate-100 hover:text-white">
                    {d.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {d.isDraft ? "extra draft" : "deliverable"} · {d.status} · {d.agent ?? "agent"} · {d.updated.slice(0, 16).replace("T", " ")} UTC
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-labelledby="tasks-title">
          <h2 id="tasks-title" className={h2}>
            Recent tasks
          </h2>
          {o.tasks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No tasks yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-800 text-sm">
              {o.tasks.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <TaskStateBadge state={t.state as TaskState} />
                    <Link href={`/tasks/${t.id}`} className="min-w-0 truncate text-slate-100 hover:text-white">
                      {t.title}
                    </Link>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t.assignee ?? "unassigned"}
                    {t.error ? ` · ${t.error.slice(0, 140)}` : t.result ? ` · ${t.result.slice(0, 140)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={`${card} mt-6`} aria-labelledby="projects-title">
        <h2 id="projects-title" className={h2}>
          Projects
        </h2>
        {o.projects.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No projects yet.</p>
        ) : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {o.projects.map((p) => (
              <li key={p.id} className="rounded-md border border-slate-800 px-3 py-2 text-sm">
                <span className="text-slate-100">{p.title}</span>
                <p className="text-xs text-slate-500">
                  {p.status}
                  {p.owner ? ` · led by ${p.owner}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Renders an executive plan (from the Chief AI Manager's run.completed
 * event). Plain data in, escaped React out.
 */
export interface PlanData {
  objective: string;
  summary: string;
  priorities: { rank: number; title: string; rationale: string; business: string | null }[];
  opportunities: string[];
  risks: { risk: string; severity: string; mitigation: string }[];
  execution_plan: { step: number; owner: string; action: string; needs_owner_approval: boolean }[];
  decisions_for_owner: string[];
  recommendation: string;
}

const OWNER_LABEL: Record<string, string> = {
  owner: "You",
  "chief-ai-manager": "Chief AI Manager",
  "central-project-manager": "Project Manager",
  "business-lead": "Business lead",
  "research-agent": "Research Agent",
};

export function PlanView({ plan, compact = false }: { plan: PlanData; compact?: boolean }) {
  return (
    <div className={`space-y-4 ${compact ? "text-xs" : "text-sm"}`}>
      <div className="rounded-lg bg-emerald-500/10 p-3 ring-1 ring-emerald-500/25">
        <p className="text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">Recommendation</p>
        <p className="mt-1 text-slate-100">{plan.recommendation}</p>
      </div>
      <p className="text-slate-300">{plan.summary}</p>

      {plan.priorities.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Priorities</h4>
          <ol className="space-y-1">
            {plan.priorities.map((p) => (
              <li key={p.rank} className="text-slate-300">
                <span className="font-medium text-slate-100">
                  {p.rank}. {p.title}
                </span>
                {p.business ? <span className="text-slate-500"> · {p.business}</span> : null}
                {!compact && <span className="block text-slate-400">{p.rationale}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Proposed execution plan</h4>
        <ol className="space-y-1.5">
          {plan.execution_plan.map((s) => (
            <li key={s.step} className="flex gap-2">
              <span className="w-5 shrink-0 text-right text-slate-500 tabular-nums">{s.step}.</span>
              <span className="min-w-0 flex-1 text-slate-300">
                {s.action}
                <span className="mt-0.5 flex flex-wrap gap-1.5">
                  <span className="rounded bg-slate-800 px-1.5 py-px text-[10px] text-slate-300">{OWNER_LABEL[s.owner] ?? s.owner}</span>
                  {s.needs_owner_approval && (
                    <span className="rounded bg-amber-400/10 px-1.5 py-px text-[10px] font-semibold text-amber-300 ring-1 ring-amber-400/30">Needs your approval</span>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {plan.risks.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Risks</h4>
          <ul className="space-y-1">
            {plan.risks.map((r, i) => (
              <li key={i} className="text-slate-300">
                <span className={r.severity === "high" ? "text-red-300" : r.severity === "medium" ? "text-amber-300" : "text-slate-400"}>{r.severity}</span> · {r.risk}
                {!compact && <span className="block text-slate-500">Mitigation: {r.mitigation}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && plan.opportunities.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Opportunities</h4>
          <ul className="list-disc space-y-1 pl-5 text-slate-300">
            {plan.opportunities.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.decisions_for_owner.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-amber-300 uppercase">Decisions for you</h4>
          <ul className="list-disc space-y-1 pl-5 text-slate-300">
            {plan.decisions_for_owner.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

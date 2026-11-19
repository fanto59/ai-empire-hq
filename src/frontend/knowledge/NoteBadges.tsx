import type { KnowledgeNoteMeta } from "@/domain/knowledge";

const KIND_LABEL: Record<KnowledgeNoteMeta["kind"], string> = {
  business: "Business",
  project: "Project",
  report: "Report",
  agent: "Agent",
};

export function KindBadge({ kind }: { kind: KnowledgeNoteMeta["kind"] }) {
  return (
    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-slate-300 uppercase ring-1 ring-slate-700">
      {KIND_LABEL[kind]}
    </span>
  );
}

export function SampleBadge() {
  return (
    <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-amber-300 uppercase ring-1 ring-amber-400/30">
      Sample
    </span>
  );
}

export function scopeLabel(business: string | null): string {
  return business === null ? "Headquarters" : business;
}

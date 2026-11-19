import { StatusBadge } from "./StatusBadge";

export function RoleCard({
  title,
  responsibilities,
  assigned,
}: {
  title: string;
  responsibilities: string[];
  assigned: boolean;
}) {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium text-slate-100">{title}</h3>
        <StatusBadge tone="off">{assigned ? "assigned" : "not configured"}</StatusBadge>
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-400">
        {responsibilities.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </article>
  );
}

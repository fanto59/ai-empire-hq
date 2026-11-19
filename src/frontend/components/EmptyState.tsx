export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center">
      <p className="font-medium text-slate-200">{title}</p>
      <div className="mt-2 text-sm text-slate-400">{children}</div>
    </div>
  );
}

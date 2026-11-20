const TONES = {
  off: "border-slate-700 bg-slate-800 text-slate-300",
  on: "border-emerald-700 bg-emerald-950 text-emerald-300",
  warn: "border-amber-700 bg-amber-950 text-amber-300",
} as const;

export function StatusBadge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

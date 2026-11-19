export function SimBadge({ children = "Simulated" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase ring-1 ring-amber-400/30">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {children}
    </span>
  );
}

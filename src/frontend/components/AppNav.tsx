"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Headquarters" },
  { href: "/office", label: "Executive Floor" },
  { href: "/tasks", label: "Tasks" },
  { href: "/agents", label: "Agents" },
  { href: "/models", label: "Models" },
  { href: "/usage", label: "Usage" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/sectors", label: "Sectors" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-3 px-4 sm:gap-6">
        <Link href="/" aria-label="AI Empire HQ home" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-100">
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-sky-500/15 text-[11px] font-bold text-sky-300 ring-1 ring-sky-400/30">
            AE
          </span>
          <span className="hidden sm:inline">AI Empire HQ</span>
        </Link>
        <nav aria-label="Primary" className="-mr-4 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-4 text-xs whitespace-nowrap sm:text-sm">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2 py-1.5 transition-colors sm:px-3 ${
                  active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

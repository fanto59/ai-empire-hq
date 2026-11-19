import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sectors · AI Empire HQ",
};

export default function SectorsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-xs font-semibold tracking-[0.2em] text-sky-400 uppercase">Sector overview</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Business sectors</h1>
      <p className="mt-3 text-slate-400">
        Each independent business will get its own floor, agents, projects, and knowledge. No sectors exist yet, and
        none will be invented: this page fills in once real businesses are configured.
      </p>
      <div className="mt-8 rounded-xl border border-dashed border-slate-700 p-8 text-center">
        <p className="font-medium text-slate-200">No business sectors configured</p>
        <p className="mt-1 text-sm text-slate-500">Coming in a future phase.</p>
      </div>
      <Link href="/office" className="mt-8 inline-block text-sm text-sky-300 hover:text-sky-200">
        ← Back to the Executive Floor
      </Link>
    </main>
  );
}

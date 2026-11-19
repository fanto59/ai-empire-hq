import Link from "next/link";
import { Fragment } from "react";
import { parseMarkdown, safeHref, type Block, type Inline } from "./markdown";

/** Renders a note body. All text goes through React, so it is escaped. */
export function Markdown({ source }: { source: string }) {
  return <div className="space-y-4 text-[15px] leading-7 text-slate-300">{renderBlocks(parseMarkdown(source))}</div>;
}

export function noteHref(target: string): string {
  const path = target.endsWith(".md") ? target : `${target}.md`;
  return `/knowledge/note?path=${encodeURIComponent(path)}`;
}

function renderBlocks(blocks: Block[]) {
  return blocks.map((b, i) => <Fragment key={i}>{renderBlock(b)}</Fragment>);
}

const CALLOUT_STYLE: Record<string, string> = {
  warning: "border-amber-500/40 bg-amber-500/[0.07] text-amber-100",
  question: "border-sky-500/40 bg-sky-500/[0.07] text-sky-100",
  note: "border-slate-600 bg-slate-800/40 text-slate-200",
};

function renderBlock(b: Block) {
  switch (b.t) {
    case "heading": {
      const cls = ["", "text-2xl font-semibold text-white", "mt-6 text-lg font-semibold text-white", "text-base font-semibold text-slate-100", "font-semibold text-slate-200"][b.level];
      const Tag = (`h${Math.min(b.level + 1, 6)}`) as "h2";
      return <Tag className={cls}>{renderInline(b.c)}</Tag>;
    }
    case "paragraph":
      return <p>{renderInline(b.c)}</p>;
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag className={`space-y-1 pl-6 ${b.ordered ? "list-decimal" : "list-disc"}`}>
          {b.items.map((it, i) => (
            <li key={i} className={it.checked === null ? "" : "list-none -ml-6 flex gap-2"}>
              {it.checked !== null && (
                <span aria-label={it.checked ? "done" : "not done"} className={`mt-1.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] ${it.checked ? "border-emerald-500 bg-emerald-500/20 text-emerald-300" : "border-slate-600"}`}>
                  {it.checked ? "✓" : ""}
                </span>
              )}
              <span>{renderInline(it.c)}</span>
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-sm text-slate-200 ring-1 ring-slate-800">
          <code>{b.v}</code>
        </pre>
      );
    case "callout":
      return (
        <aside className={`rounded-lg border-l-4 px-4 py-3 ${CALLOUT_STYLE[b.kind] ?? CALLOUT_STYLE.note}`}>
          <p className="font-semibold">{renderInline(b.title)}</p>
          {b.blocks.length > 0 && <div className="mt-1 space-y-2 text-sm opacity-90">{renderBlocks(b.blocks)}</div>}
        </aside>
      );
    case "quote":
      return <blockquote className="border-l-2 border-slate-600 pl-4 text-slate-400">{renderBlocks(b.blocks)}</blockquote>;
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-300">
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className="px-3 py-2 font-semibold">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2 align-top">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="border-slate-800" />;
  }
}

function renderInline(parts: Inline[]) {
  return parts.map((p, i) => {
    switch (p.t) {
      case "text":
        return <Fragment key={i}>{p.v}</Fragment>;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-slate-100">
            {renderInline(p.c)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInline(p.c)}</em>;
      case "code":
        return (
          <code key={i} className="rounded bg-slate-800 px-1.5 py-0.5 text-[0.85em] text-slate-200">
            {p.v}
          </code>
        );
      case "wikilink":
        return (
          <Link key={i} href={noteHref(p.target)} className="text-sky-300 underline decoration-sky-300/30 underline-offset-2 hover:decoration-sky-300">
            {p.label}
          </Link>
        );
      case "link": {
        const href = safeHref(p.href);
        return href ? (
          <a key={i} href={href} rel="noopener noreferrer" target="_blank" className="text-sky-300 underline underline-offset-2">
            {p.label}
          </a>
        ) : (
          <Fragment key={i}>{p.label}</Fragment>
        );
      }
    }
  });
}

/**
 * Minimal Markdown parser for knowledge notes (the subset our notes use plus
 * Obsidian wikilinks and callouts). It produces plain data; the React
 * renderer turns that into elements, so raw HTML in a note is always shown
 * as text and can never execute. No dependency, no dangerouslySetInnerHTML.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "wikilink"; target: string; label: string }
  | { t: "link"; href: string; label: string };

export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: "paragraph"; c: Inline[] }
  | { t: "list"; ordered: boolean; items: { checked: boolean | null; c: Inline[] }[] }
  | { t: "code"; lang: string; v: string }
  | { t: "callout"; kind: string; title: Inline[]; blocks: Block[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push({ t: "code", lang: fence[1] ?? "", v: body.join("\n") });
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: "heading", level: h[1]!.length as 1 | 2 | 3 | 4, c: parseInline(h[2]!.trim()) });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) inner.push(lines[i++]!.replace(/^>\s?/, ""));
      const callout = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(inner[0] ?? "");
      if (callout) {
        blocks.push({
          t: "callout",
          kind: callout[1]!.toLowerCase(),
          title: parseInline(callout[2] || callout[1]!),
          blocks: parseMarkdown(inner.slice(1).join("\n")),
        });
      } else {
        blocks.push({ t: "quote", blocks: parseMarkdown(inner.join("\n")) });
      }
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]!)) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => parseInline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push({ t: "table", head, rows });
      continue;
    }

    const listItem = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;
    const first = listItem.exec(line);
    if (first) {
      const ordered = Boolean(first[2]);
      const items: { checked: boolean | null; c: Inline[] }[] = [];
      while (i < lines.length) {
        const m = listItem.exec(lines[i]!);
        if (!m || Boolean(m[2]) !== ordered) break;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]!);
        items.push(task ? { checked: task[1] !== " ", c: parseInline(task[2]!) } : { checked: null, c: parseInline(m[3]!) });
        i++;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,4}\s|```|>|\s*(?:[-*+]|\d+[.)])\s)/.test(lines[i]!)
    ) {
      para.push(lines[i++]!.trim());
    }
    if (para.length === 0) {
      // Defensive: unrecognized line, render as text.
      para.push(lines[i++]!);
    }
    blocks.push({ t: "paragraph", c: parseInline(para.join(" ")) });
  }
  return blocks;
}

const INLINE = /(`[^`]+`)|(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ t: "text", v: rest });
      break;
    }
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    const tok = m[0];
    if (m[1]) out.push({ t: "code", v: tok.slice(1, -1) });
    else if (m[2]) {
      const [target, label] = tok.slice(2, -2).split("|");
      out.push({ t: "wikilink", target: target!.trim(), label: (label ?? target!).trim() });
    } else if (m[3]) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      out.push({ t: "link", label: mm[1]!, href: mm[2]! });
    } else if (m[4]) out.push({ t: "strong", c: parseInline(tok.slice(2, -2)) });
    else out.push({ t: "em", c: parseInline(tok.slice(1, -1)) });
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

/** Only http(s) links are clickable; everything else renders as text. */
export function safeHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

test("parses headings, paragraphs, lists, tables and callouts", () => {
  const blocks = parseMarkdown(`> [!warning] Sample content
> Not real.

# Title

Some **bold** and \`code\`.

- one
- [x] done

| A | B |
| --- | --- |
| 1 | 2 |
`);
  assert.deepEqual(
    blocks.map((b) => b.t),
    ["callout", "heading", "paragraph", "list", "table"],
  );
  const callout = blocks[0]!;
  assert.ok(callout.t === "callout" && callout.kind === "warning");
  const list = blocks[3]!;
  assert.ok(list.t === "list" && list.items[1]!.checked === true);
  const table = blocks[4]!;
  assert.ok(table.t === "table" && table.rows.length === 1 && table.head.length === 2);
});

test("parses wikilinks with aliases", () => {
  assert.deepEqual(parseInline("see [[businesses/x/projects/y|Project Y]]"), [
    { t: "text", v: "see " },
    { t: "wikilink", target: "businesses/x/projects/y", label: "Project Y" },
  ]);
});

test("raw HTML stays text", () => {
  const blocks = parseMarkdown('<script>alert("x")</script>');
  assert.deepEqual(blocks, [{ t: "paragraph", c: [{ t: "text", v: '<script>alert("x")</script>' }] }]);
});

test("only http(s) links are clickable", () => {
  assert.equal(safeHref("https://obsidian.md"), "https://obsidian.md");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("file:///etc/passwd"), null);
});

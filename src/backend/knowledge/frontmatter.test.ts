import assert from "node:assert/strict";
import { test } from "node:test";
import type { KnowledgeNoteMeta } from "@/domain/knowledge";
import { KnowledgeError } from "./errors";
import { parseNote, serializeNote } from "./frontmatter";
import { slugify } from "./paths";

const meta: KnowledgeNoteMeta = {
  schema: 1,
  id: "rpt-acme-x",
  kind: "report",
  title: 'Quotes "and" colons: ok',
  business: "acme",
  project: null,
  agent: null,
  tasks: ["t-1"],
  authorKind: "user",
  authorId: "owner",
  status: "draft",
  confidentiality: "internal",
  origin: "sample",
  created: "2026-11-19T00:00:00.000Z",
  updated: "2026-11-19T00:00:00.000Z",
  tags: ["aehq/report"],
};

test("frontmatter round-trips, including awkward characters", () => {
  const text = serializeNote(meta, "Body with --- inside\n---\nstill body");
  const parsed = parseNote(text);
  assert.deepEqual(parsed.meta, meta);
  assert.equal(parsed.body, "Body with --- inside\n---\nstill body\n");
});

test("rejects unknown, missing or malformed properties", () => {
  const good = serializeNote(meta, "x");
  for (const bad of [
    good.replace("id: ", "evil: "),
    good.replace('kind: "report"', 'kind: "spell"'),
    good.replace(/tasks: .*/, "tasks: not-json"),
    "no frontmatter",
    "---\nid: \"x\"\n",
  ]) {
    assert.throws(() => parseNote(bad), (e: unknown) => e instanceof KnowledgeError && e.code === "corrupt-note");
  }
});

test("slugify produces safe slugs", () => {
  assert.equal(slugify("Market Scan: Sector Candidates!"), "market-scan-sector-candidates");
  assert.equal(slugify("Café déjà vu"), "cafe-deja-vu");
  assert.equal(slugify("../../etc"), "etc");
  assert.equal(slugify("!!!"), "note");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { KnowledgeNoteMeta, KnowledgeNoteSummary } from "@/domain/knowledge";
import { DEFAULT_SYNC_POLICY, DisabledKnowledgeSync, ObsidianHeadlessSyncAdapter, selectNotesForSync } from "./sync";

function note(path: string, over: Partial<KnowledgeNoteMeta>): KnowledgeNoteSummary {
  return {
    path,
    meta: {
      schema: 1,
      id: path,
      kind: "report",
      title: "t",
      business: "acme",
      project: null,
      agent: null,
      tasks: [],
      authorKind: "user",
      authorId: "owner",
      status: "final",
      confidentiality: "internal",
      origin: "app",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      tags: [],
      ...over,
    },
  };
}

const notes = [
  note("a", {}),
  note("b", { business: "globex" }),
  note("c", { confidentiality: "restricted" }),
  note("d", { business: null }),
  note("e", { origin: "sample" }),
];

test("the shipped policy syncs nothing", () => {
  const s = selectNotesForSync(notes, DEFAULT_SYNC_POLICY);
  assert.equal(s.include.length, 0);
  assert.ok(s.exclude.every((e) => e.reason === "sync-disabled"));
  assert.ok(Object.isFrozen(DEFAULT_SYNC_POLICY));
});

test("an enabled policy is still default-deny per business, HQ, samples and confidentiality", () => {
  const s = selectNotesForSync(notes, { enabled: true, allowedBusinesses: ["acme"], includeHq: false, includeSamples: false });
  assert.deepEqual(s.include.map((n) => n.path), ["a"]);
  const reasons = Object.fromEntries(s.exclude.map((e) => [e.path, e.reason]));
  assert.deepEqual(reasons, { b: "business-not-allowed", c: "restricted", d: "hq-not-allowed", e: "sample-content" });
});

test("restricted notes never sync, even with everything else allowed", () => {
  const s = selectNotesForSync(notes, { enabled: true, allowedBusinesses: ["acme", "globex"], includeHq: true, includeSamples: true });
  assert.ok(!s.include.some((n) => n.meta.confidentiality === "restricted"));
});

test("adapters refuse to sync in this version", async () => {
  const disabled = new DisabledKnowledgeSync();
  assert.equal((await disabled.status()).state, "disabled");
  await assert.rejects(disabled.syncOnce());
  const obsidian = new ObsidianHeadlessSyncAdapter({
    mirrorDir: "/tmp/mirror",
    remoteVault: "acme",
    credentialRef: "secret://obsidian/acme",
    policy: DEFAULT_SYNC_POLICY,
  });
  assert.equal((await obsidian.status()).state, "not-implemented");
  await assert.rejects(obsidian.syncOnce());
  assert.throws(() => new ObsidianHeadlessSyncAdapter({ mirrorDir: "", remoteVault: "x", credentialRef: "y", policy: DEFAULT_SYNC_POLICY }));
});

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { businessAgentContext, ownerContext, type KnowledgeAccessContext } from "./access";
import { KnowledgeError } from "./errors";
import { parseNote } from "./frontmatter";
import { KnowledgeService } from "./service";

let root: string;
let service: KnowledgeService;
const owner = ownerContext();
const acmeAgent = businessAgentContext("research-agent", "acme");
const fixedNow = () => new Date("2026-11-19T10:00:00.000Z");

beforeEach(async () => {
  // Every test gets its own isolated, throwaway vault.
  root = await fs.mkdtemp(path.join(os.tmpdir(), "aehq-vault-"));
  service = new KnowledgeService({ root, now: fixedNow });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function rejects(p: Promise<unknown>, code: KnowledgeError["code"]) {
  await assert.rejects(p, (e: unknown) => e instanceof KnowledgeError && e.code === code);
}

const report = {
  kind: "report" as const,
  business: "acme",
  title: "Market scan: sector candidates",
  body: "# Findings\n\nThree candidates.\n",
  project: "sector-discovery",
  agent: "research-agent",
  tasks: ["task-123"],
};

test("creates a report at the expected path with full frontmatter", async () => {
  const note = await service.createNote(acmeAgent, report);
  assert.equal(note.path, "businesses/acme/reports/2026/2026-11-19-market-scan-sector-candidates.md");
  const text = await fs.readFile(path.join(root, note.path), "utf8");
  assert.ok(text.startsWith("---\naehq_schema: 1\n"));
  const { meta, body } = parseNote(text);
  assert.equal(meta.id, "rpt-acme-20261119-market-scan-sector-candidates");
  assert.equal(meta.kind, "report");
  assert.equal(meta.business, "acme");
  assert.equal(meta.project, "sector-discovery");
  assert.deepEqual(meta.tasks, ["task-123"]);
  assert.equal(meta.authorKind, "agent");
  assert.equal(meta.authorId, "research-agent");
  assert.equal(meta.created, "2026-11-19T10:00:00.000Z");
  assert.ok(meta.tags.includes("aehq/report") && meta.tags.includes("aehq/scope/acme"));
  assert.equal(body, "# Findings\n\nThree candidates.\n");
});

test("organizes notes by business, project, report and agent", async () => {
  await service.createNote(owner, { kind: "business", business: "acme", title: "Acme", body: "Overview" });
  await service.createNote(owner, { kind: "project", business: "acme", title: "Sector discovery", body: "Plan" });
  await service.createNote(owner, { kind: "agent", business: "acme", title: "Research Agent", body: "Profile" });
  await service.createNote(owner, { ...report });
  await service.createNote(owner, { kind: "project", business: null, title: "Knowledge service", body: "HQ" });
  const paths = (await service.listNotes(owner)).notes.map((n) => n.path).sort();
  assert.deepEqual(paths, [
    "businesses/acme/agents/research-agent.md",
    "businesses/acme/business.md",
    "businesses/acme/projects/sector-discovery.md",
    "businesses/acme/reports/2026/2026-11-19-market-scan-sector-candidates.md",
    "hq/projects/knowledge-service.md",
  ]);
});

test("reads back exactly what was written", async () => {
  const created = await service.createNote(acmeAgent, report);
  const read = await service.readNote(acmeAgent, created.path);
  assert.deepEqual(read, created);
});

test("refuses to overwrite an existing note on create", async () => {
  await service.createNote(acmeAgent, report);
  await rejects(service.createNote(acmeAgent, report), "already-exists");
});

test("updates body/status and bumps the updated timestamp", async () => {
  const created = await service.createNote(acmeAgent, report);
  let t = new Date("2026-11-20T08:00:00.000Z");
  service = new KnowledgeService({ root, now: () => t });
  const updated = await service.updateNote(acmeAgent, created.path, { body: "Revised.", status: "final" });
  assert.equal(updated.meta.status, "final");
  assert.equal(updated.meta.updated, "2026-11-20T08:00:00.000Z");
  assert.equal(updated.meta.created, created.meta.created);
  assert.equal((await service.readNote(acmeAgent, created.path)).body, "Revised.\n");
  t = new Date("2026-11-21T08:00:00.000Z");
});

test("links reports to application tasks and finds them by task", async () => {
  const created = await service.createNote(acmeAgent, { ...report, tasks: [] });
  await service.linkToTask(acmeAgent, created.path, "task-9");
  await service.linkToTask(acmeAgent, created.path, "task-9"); // idempotent
  const linked = await service.readNote(acmeAgent, created.path);
  assert.deepEqual(linked.meta.tasks, ["task-9"]);
  const found = await service.findNotesForTask(owner, "task-9");
  assert.deepEqual(found.map((n) => n.path), [created.path]);
  await rejects(service.linkToTask(acmeAgent, created.path, "../etc"), "invalid-input");
});

test("business agents cannot read or write other businesses' notes", async () => {
  const other = await service.createNote(owner, { ...report, business: "globex" });
  await rejects(service.readNote(acmeAgent, other.path), "access-denied");
  await rejects(service.createNote(acmeAgent, { ...report, business: "globex", slug: "x" }), "access-denied");
  await rejects(service.linkToTask(acmeAgent, other.path, "t1"), "access-denied");
  const visible = (await service.listNotes(acmeAgent)).notes;
  assert.equal(visible.length, 0);
  assert.equal((await service.listNotes(owner)).notes.length, 1);
});

test("headquarters notes require HQ access", async () => {
  const hq = await service.createNote(owner, { kind: "report", business: null, title: "Board memo", body: "x" });
  await rejects(service.readNote(acmeAgent, hq.path), "access-denied");
  await rejects(service.createNote(acmeAgent, { kind: "report", business: null, title: "Sneaky", body: "x" }), "access-denied");
});

test("read-only contexts cannot write", async () => {
  const readOnly: KnowledgeAccessContext = businessAgentContext("viewer", "acme", false);
  await rejects(service.createNote(readOnly, report), "access-denied");
});

test("restricted notes are hidden from agents", async () => {
  const note = await service.createNote(owner, { ...report, confidentiality: "restricted" });
  await rejects(service.readNote(acmeAgent, note.path), "access-denied");
  assert.equal((await service.listNotes(acmeAgent)).notes.length, 0);
  assert.equal((await service.readNote(owner, note.path)).meta.confidentiality, "restricted");
});

test("refuses notes that contain secrets, without echoing them", async () => {
  const secrets = [
    "key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "token ghp_0123456789abcdefghijABCDEFGHIJ0123456789",
    "AKIAIOSFODNN7EXAMPLE",
    "-----BEGIN RSA PRIVATE KEY-----",
    "password = hunter2hunter2",
    "postgres://admin:s3cretpw@db.internal/app",
  ];
  for (const s of secrets) {
    await assert.rejects(
      service.createNote(acmeAgent, { ...report, slug: "s", body: `Notes\n${s}\n` }),
      (e: unknown) => e instanceof KnowledgeError && e.code === "secret-detected" && !e.message.includes(s),
    );
  }
  await rejects(service.createNote(acmeAgent, { ...report, slug: "t", title: "xai-ABCDEFGHIJKLMNOPQRSTUV" }), "secret-detected");
  assert.equal((await service.listNotes(owner)).notes.length, 0);
});

test("rejects path traversal and malformed paths", async () => {
  for (const bad of [
    "../outside.md",
    "businesses/../hq/projects/x.md",
    "businesses/acme/../../etc/passwd",
    "/etc/passwd",
    "businesses/acme/reports/2026/../../business.md",
    "businesses/ACME/business.md",
    "businesses/acme/projects/x.txt",
    "businesses/acme/reports/2025/2026-11-19-x.md",
    "hq/business.md",
    "businesses\\acme\\business.md",
    "businesses/acme/projects/%2e%2e.md",
  ]) {
    await rejects(service.readNote(owner, bad), "invalid-path");
  }
});

test("rejects invalid slugs and business ids", async () => {
  await rejects(service.createNote(owner, { ...report, business: "../acme" }), "invalid-input");
  await rejects(service.createNote(owner, { ...report, slug: "Bad Slug" }), "invalid-input");
  await rejects(service.createNote(owner, { ...report, project: "a/b" }), "invalid-input");
  await rejects(service.createNote(owner, { ...report, title: "two\nlines" }), "invalid-input");
  await rejects(service.createNote(owner, { ...report, tags: ["Has Space"] }), "invalid-input");
});

test("refuses to follow symbolic links inside the vault", async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aehq-outside-"));
  try {
    await fs.mkdir(path.join(root, "businesses"), { recursive: true });
    await fs.symlink(outside, path.join(root, "businesses", "acme"));
    await rejects(service.createNote(acmeAgent, report), "invalid-path");
    assert.deepEqual(await fs.readdir(outside), []);
    assert.equal((await service.listNotes(owner)).notes.length, 0);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("ignores notes whose frontmatter disagrees with their folder", async () => {
  const note = await service.createNote(owner, { ...report, business: "globex" });
  // Copy globex's note into acme's folder: it must not become readable as acme's.
  const smuggled = note.path.replace("businesses/globex", "businesses/acme");
  await fs.mkdir(path.dirname(path.join(root, smuggled)), { recursive: true });
  await fs.copyFile(path.join(root, note.path), path.join(root, smuggled));
  await rejects(service.readNote(acmeAgent, smuggled), "corrupt-note");
  const listed = await service.listNotes(acmeAgent);
  assert.equal(listed.notes.length, 0);
  assert.equal(listed.skipped, 1);
});

test("no temporary files are left behind", async () => {
  await service.createNote(acmeAgent, report);
  await rejects(service.createNote(acmeAgent, report), "already-exists");
  const dir = path.join(root, "businesses/acme/reports/2026");
  assert.deepEqual((await fs.readdir(dir)).filter((f) => f.endsWith(".tmp")), []);
});

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  KNOWLEDGE_NOTE_SCHEMA_VERSION,
  type KnowledgeConfidentiality,
  type KnowledgeNote,
  type KnowledgeNoteKind,
  type KnowledgeNoteMeta,
  type KnowledgeNoteOrigin,
  type KnowledgeNoteStatus,
  type KnowledgeNoteSummary,
} from "@/domain/knowledge";
import {
  assertCanRead,
  assertCanWrite,
  canAccessScope,
  canReadConfidentiality,
  type KnowledgeAccessContext,
} from "./access";
import { KnowledgeError } from "./errors";
import { parseNote, serializeNote } from "./frontmatter";
import { NOTE_PATH, assertSlug, buildNotePath, parseNotePath, resolveInside, slugify } from "./paths";
import { findSecrets } from "./secrets";

/**
 * KNOWLEDGE SERVICE - reads and writes Obsidian-compatible Markdown notes.
 *
 * Server-only. Every method takes a KnowledgeAccessContext, validates all
 * input, refuses secrets, and only touches paths inside the vault root that
 * match the fixed layout in paths.ts. Writes are atomic (temp file + link or
 * rename), so Obsidian or a sync client never sees a half-written note.
 */
export interface CreateNoteInput {
  kind: KnowledgeNoteKind;
  /** Business slug, or null for headquarters. */
  business: string | null;
  title: string;
  body: string;
  /** Defaults to slugify(title). Ignored for kind "business". */
  slug?: string;
  /** yyyy-mm-dd; reports only (defaults to today, UTC). */
  date?: string;
  project?: string | null;
  agent?: string | null;
  tasks?: string[];
  tags?: string[];
  status?: KnowledgeNoteStatus;
  confidentiality?: KnowledgeConfidentiality;
  origin?: KnowledgeNoteOrigin;
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  status?: KnowledgeNoteStatus;
  tags?: string[];
}

export interface ListNotesFilter {
  /** Only this business (string) or only headquarters (null). */
  business?: string | null;
  kind?: KnowledgeNoteKind;
  project?: string;
  task?: string;
}

export interface ListNotesResult {
  notes: KnowledgeNoteSummary[];
  /** Files that matched the layout but failed validation (not shown). */
  skipped: number;
}

export interface KnowledgeServiceOptions {
  root: string;
  now?: () => Date;
}

const MAX_TITLE = 200;
const MAX_BODY = 200_000;
const MAX_FILE_BYTES = 1_000_000;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TAG = /^[a-z0-9][a-z0-9/_-]{0,63}$/;
const ID_PREFIX: Record<KnowledgeNoteKind, string> = { business: "biz", project: "prj", report: "rpt", agent: "agt" };

export class KnowledgeService {
  readonly root: string;
  private readonly now: () => Date;

  constructor(options: KnowledgeServiceOptions) {
    this.root = path.resolve(options.root);
    this.now = options.now ?? (() => new Date());
  }

  // ---- write ------------------------------------------------------------------

  async createNote(ctx: KnowledgeAccessContext, input: CreateNoteInput): Promise<KnowledgeNote> {
    const business = input.business === null ? null : assertSlug(input.business, "business");
    assertCanWrite(ctx, business);

    const title = validateTitle(input.title);
    const body = validateBody(input.body);
    const now = this.now().toISOString();
    const date = input.kind === "report" ? (input.date ?? now.slice(0, 10)) : undefined;
    const slug = input.kind === "business" ? "business" : assertSlug(input.slug ?? slugify(title), "slug");
    const relPath = buildNotePath({ business, kind: input.kind, slug, date });

    const meta: KnowledgeNoteMeta = {
      schema: KNOWLEDGE_NOTE_SCHEMA_VERSION,
      id: [ID_PREFIX[input.kind], business ?? "hq", date?.replaceAll("-", ""), slug].filter(Boolean).join("-"),
      kind: input.kind,
      title,
      business,
      project: input.project == null ? null : assertSlug(input.project, "project"),
      agent: input.agent == null ? null : assertSlug(input.agent, "agent"),
      tasks: validateTasks(input.tasks ?? []),
      // Authorship always comes from the access context, never from input.
      authorKind: ctx.principal.kind,
      authorId: ctx.principal.id,
      status: input.status ?? "draft",
      confidentiality: input.confidentiality ?? "internal",
      origin: input.origin ?? "app",
      created: now,
      updated: now,
      tags: mergeTags(input.kind, business, input.tags ?? []),
    };
    this.assertNoSecrets(meta, body);

    await this.writeFile(relPath, serializeNote(meta, body), "create");
    return { path: relPath, meta, body };
  }

  async updateNote(ctx: KnowledgeAccessContext, notePath: string, patch: UpdateNoteInput): Promise<KnowledgeNote> {
    const parsed = parseNotePath(notePath);
    assertCanWrite(ctx, parsed.business);
    const current = await this.readNote(ctx, notePath);
    const meta: KnowledgeNoteMeta = {
      ...current.meta,
      title: patch.title === undefined ? current.meta.title : validateTitle(patch.title),
      status: patch.status ?? current.meta.status,
      tags: patch.tags === undefined ? current.meta.tags : mergeTags(current.meta.kind, current.meta.business, patch.tags),
      updated: this.now().toISOString(),
    };
    const body = patch.body === undefined ? current.body : validateBody(patch.body);
    this.assertNoSecrets(meta, body);
    await this.writeFile(parsed.path, serializeNote(meta, body), "replace");
    return { path: parsed.path, meta, body };
  }

  /** Links a note (typically a report) to an application task. Idempotent. */
  async linkToTask(ctx: KnowledgeAccessContext, notePath: string, taskId: string): Promise<KnowledgeNote> {
    const parsed = parseNotePath(notePath);
    assertCanWrite(ctx, parsed.business);
    const [id] = validateTasks([taskId]);
    const current = await this.readNote(ctx, notePath);
    if (current.meta.tasks.includes(id!)) return current;
    const meta = { ...current.meta, tasks: [...current.meta.tasks, id!], updated: this.now().toISOString() };
    await this.writeFile(parsed.path, serializeNote(meta, current.body), "replace");
    return { path: parsed.path, meta, body: current.body };
  }

  // ---- read -------------------------------------------------------------------

  async readNote(ctx: KnowledgeAccessContext, notePath: string): Promise<KnowledgeNote> {
    const parsed = parseNotePath(notePath);
    assertCanRead(ctx, parsed.business);
    const note = await this.loadNote(parsed.path);
    if (!note) throw new KnowledgeError("not-found", "Note not found.");
    if (!canReadConfidentiality(ctx, note.meta.confidentiality)) {
      throw new KnowledgeError("access-denied", "This note is restricted to human users.");
    }
    return note;
  }

  async listNotes(ctx: KnowledgeAccessContext, filter: ListNotesFilter = {}): Promise<ListNotesResult> {
    const scopes = await this.accessibleScopes(ctx, filter.business);
    const notes: KnowledgeNoteSummary[] = [];
    let skipped = 0;
    for (const scope of scopes) {
      for (const rel of await this.walk(scope)) {
        if (!NOTE_PATH.test(rel)) continue;
        let note: KnowledgeNote | null = null;
        try {
          note = await this.loadNote(rel);
        } catch {
          skipped++;
          continue;
        }
        if (!note) continue;
        const m = note.meta;
        if (!canReadConfidentiality(ctx, m.confidentiality)) continue;
        if (filter.kind && m.kind !== filter.kind) continue;
        if (filter.project && m.project !== filter.project) continue;
        if (filter.task && !m.tasks.includes(filter.task)) continue;
        notes.push({ path: note.path, meta: m });
      }
    }
    notes.sort((a, b) => (a.meta.updated < b.meta.updated ? 1 : a.meta.updated > b.meta.updated ? -1 : a.path.localeCompare(b.path)));
    return { notes, skipped };
  }

  /** Reverse lookup: every note the caller may see that links to a task. */
  async findNotesForTask(ctx: KnowledgeAccessContext, taskId: string): Promise<KnowledgeNoteSummary[]> {
    const [id] = validateTasks([taskId]);
    return (await this.listNotes(ctx, { task: id })).notes;
  }

  // ---- internals ------------------------------------------------------------

  private assertNoSecrets(meta: KnowledgeNoteMeta, body: string) {
    const kinds = findSecrets(body, meta.title, ...meta.tags, ...meta.tasks);
    if (kinds.length > 0) {
      throw new KnowledgeError(
        "secret-detected",
        `Refusing to store a note that appears to contain a secret (${kinds.join(", ")}). Remove it and reference the secret store instead.`,
      );
    }
  }

  private async accessibleScopes(ctx: KnowledgeAccessContext, only?: string | null): Promise<string[]> {
    if (only !== undefined) {
      if (only !== null) assertSlug(only, "business");
      return canAccessScope(ctx, only) ? [only === null ? "hq" : `businesses/${only}`] : [];
    }
    const scopes: string[] = [];
    if (ctx.hq) scopes.push("hq");
    if (ctx.businesses === "*") {
      for (const name of await this.safeReaddir("businesses")) {
        if (name.isDirectory() && !name.isSymbolicLink() && /^[a-z0-9-]+$/.test(name.name)) scopes.push(`businesses/${name.name}`);
      }
    } else {
      for (const b of ctx.businesses) scopes.push(`businesses/${assertSlug(b, "business")}`);
    }
    return scopes;
  }

  private async safeReaddir(rel: string) {
    const abs = resolveInside(this.root, rel);
    if (!(await this.isRealPath(rel))) return [];
    try {
      return await fs.readdir(abs, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  /** Recursively lists vault-relative file paths; skips symlinks and dotfiles. */
  private async walk(rel: string, depth = 0): Promise<string[]> {
    if (depth > 4) return [];
    const out: string[] = [];
    for (const entry of await this.safeReaddir(rel)) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) out.push(...(await this.walk(child, depth + 1)));
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(child);
    }
    return out;
  }

  /** True if no component below the root is a symlink (missing parts are fine). */
  private async isRealPath(rel: string): Promise<boolean> {
    let current = this.root;
    for (const part of rel.split("/")) {
      current = path.join(current, part);
      try {
        const st = await fs.lstat(current);
        if (st.isSymbolicLink()) return false;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
        throw e;
      }
    }
    return true;
  }

  private async loadNote(rel: string): Promise<KnowledgeNote | null> {
    const parsed = parseNotePath(rel);
    const abs = resolveInside(this.root, rel);
    if (!(await this.isRealPath(rel))) throw new KnowledgeError("invalid-path", "Symbolic links are not allowed in the vault.");
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    if (!stat.isFile()) return null;
    if (stat.size > MAX_FILE_BYTES) throw new KnowledgeError("corrupt-note", "Note file is too large.");
    const { meta, body } = parseNote(await fs.readFile(abs, "utf8"));
    if (meta.business !== parsed.business || meta.kind !== parsed.kind) {
      // A note whose frontmatter disagrees with its folder could be used to
      // smuggle one business's note into another's scope. Never trust it.
      throw new KnowledgeError("corrupt-note", "Note metadata does not match its location.");
    }
    return { path: rel, meta, body };
  }

  private async writeFile(rel: string, content: string, mode: "create" | "replace"): Promise<void> {
    const abs = resolveInside(this.root, rel);
    const dir = path.dirname(abs);
    if (!(await this.isRealPath(rel))) throw new KnowledgeError("invalid-path", "Symbolic links are not allowed in the vault.");
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    if (!(await this.isRealPath(rel))) throw new KnowledgeError("invalid-path", "Symbolic links are not allowed in the vault.");

    const tmp = path.join(dir, `.${path.basename(abs)}.${randomBytes(6).toString("hex")}.tmp`);
    await fs.writeFile(tmp, content, { encoding: "utf8", flag: "wx", mode: 0o640 });
    try {
      if (mode === "create") {
        try {
          await fs.link(tmp, abs); // atomic, fails if the note exists
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") {
            throw new KnowledgeError("already-exists", "A note already exists at that location.");
          }
          throw e;
        }
      } else {
        await fs.rename(tmp, abs);
      }
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
}

function validateTitle(title: unknown): string {
  if (typeof title !== "string") throw new KnowledgeError("invalid-input", "Title is required.");
  const t = title.trim();
  if (t.length === 0 || t.length > MAX_TITLE || /[\r\n\0]/.test(t)) {
    throw new KnowledgeError("invalid-input", `Title must be a single line of 1-${MAX_TITLE} characters.`);
  }
  return t;
}

function validateBody(body: unknown): string {
  if (typeof body !== "string") throw new KnowledgeError("invalid-input", "Body must be text.");
  if (body.length > MAX_BODY) throw new KnowledgeError("invalid-input", "Body is too long.");
  if (body.includes("\0")) throw new KnowledgeError("invalid-input", "Body contains invalid characters.");
  return body.replace(/\r\n/g, "\n");
}

function validateTasks(tasks: unknown): string[] {
  if (!Array.isArray(tasks) || tasks.length > 50) throw new KnowledgeError("invalid-input", "Tasks must be a list of up to 50 ids.");
  for (const t of tasks) {
    if (typeof t !== "string" || !TASK_ID.test(t)) throw new KnowledgeError("invalid-input", "Task ids must be 1-64 letters, digits, '-' or '_'.");
  }
  return [...new Set(tasks as string[])];
}

function mergeTags(kind: KnowledgeNoteKind, business: string | null, extra: unknown): string[] {
  if (!Array.isArray(extra) || extra.length > 20) throw new KnowledgeError("invalid-input", "Tags must be a list of up to 20 tags.");
  for (const t of extra) {
    if (typeof t !== "string" || !TAG.test(t)) throw new KnowledgeError("invalid-input", "Tags may use lowercase letters, digits, '/', '-' and '_'.");
  }
  return [...new Set([`aehq/${kind}`, `aehq/scope/${business ?? "hq"}`, ...(extra as string[])])];
}

import path from "node:path";
import { KnowledgeError } from "./errors";
import type { KnowledgeNoteKind } from "@/domain/knowledge";

/**
 * SAFE PATH HANDLING
 *
 * Vault layout (every path the service touches matches NOTE_PATH):
 *
 *   hq/                                   headquarters scope (business = null)
 *     projects/<slug>.md
 *     agents/<slug>.md
 *     reports/<yyyy>/<yyyy-mm-dd>-<slug>.md
 *   businesses/<business>/                one folder per business
 *     business.md
 *     projects/<slug>.md
 *     agents/<slug>.md
 *     reports/<yyyy>/<yyyy-mm-dd>-<slug>.md
 *
 * Paths are BUILT from validated slugs, never taken from callers as-is. When
 * a caller passes a path (e.g. from a URL), it must match NOTE_PATH exactly,
 * and the resolved absolute path must stay inside the vault root.
 */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const NOTE_PATH =
  /^(hq|businesses\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?))\/(business\.md|(projects|agents)\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.md|reports\/(\d{4})\/(\d{4}-\d{2}-\d{2})-([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.md)$/;

export function assertSlug(value: unknown, field: string): string {
  if (typeof value !== "string" || !SLUG.test(value)) {
    throw new KnowledgeError(
      "invalid-input",
      `${field} must be 1-64 lowercase letters, digits or single hyphens (got ${JSON.stringify(String(value).slice(0, 40))}).`,
    );
  }
  return value;
}

/** Turns a title into a slug. Result always satisfies SLUG. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "note";
}

export function scopeDir(business: string | null): string {
  return business === null ? "hq" : `businesses/${assertSlug(business, "business")}`;
}

export interface NoteLocation {
  business: string | null;
  kind: KnowledgeNoteKind;
  slug: string;
  /** yyyy-mm-dd, reports only. */
  date?: string;
}

export function buildNotePath(loc: NoteLocation): string {
  const scope = scopeDir(loc.business);
  switch (loc.kind) {
    case "business":
      if (loc.business === null) throw new KnowledgeError("invalid-input", "Business notes need a business.");
      return `${scope}/business.md`;
    case "project":
      return `${scope}/projects/${assertSlug(loc.slug, "slug")}.md`;
    case "agent":
      return `${scope}/agents/${assertSlug(loc.slug, "slug")}.md`;
    case "report": {
      if (!loc.date || !DATE.test(loc.date)) throw new KnowledgeError("invalid-input", "Reports need a yyyy-mm-dd date.");
      return `${scope}/reports/${loc.date.slice(0, 4)}/${loc.date}-${assertSlug(loc.slug, "slug")}.md`;
    }
  }
}

export interface ParsedNotePath {
  path: string;
  business: string | null;
  kind: KnowledgeNoteKind;
}

/** Validates an untrusted vault-relative path. Throws on anything unexpected. */
export function parseNotePath(input: unknown): ParsedNotePath {
  if (typeof input !== "string" || input.length > 256) {
    throw new KnowledgeError("invalid-path", "Note path is not valid.");
  }
  const m = NOTE_PATH.exec(input);
  if (!m) throw new KnowledgeError("invalid-path", "Note path is not valid.");
  const business = m[1] === "hq" ? null : m[2]!;
  const kind: KnowledgeNoteKind =
    m[3] === "business.md" ? "business" : m[4] === "projects" ? "project" : m[4] === "agents" ? "agent" : "report";
  if (kind === "business" && business === null) {
    throw new KnowledgeError("invalid-path", "Headquarters has no business note.");
  }
  if (kind === "report" && m[6] !== m[7]!.slice(0, 4)) {
    throw new KnowledgeError("invalid-path", "Report year folder does not match its date.");
  }
  return { path: input, business, kind };
}

/**
 * Resolves a validated relative path under `root` and proves it cannot
 * escape (defense in depth on top of the NOTE_PATH whitelist).
 */
export function resolveInside(root: string, relative: string): string {
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, ...relative.split("/"));
  const rel = path.relative(absRoot, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new KnowledgeError("invalid-path", "Note path escapes the knowledge vault.");
  }
  return abs;
}

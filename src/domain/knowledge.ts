import type { BusinessId, IsoTimestamp, KnowledgeSourceId } from "./ids";

/**
 * Knowledge sources. Obsidian vaults are the first planned kind: a vault is a
 * folder of Markdown notes. HQ reads them; it never writes to them unless a
 * future, explicitly approved feature says so.
 */
export type KnowledgeSourceKind = "obsidian-vault";

export interface KnowledgeSource {
  id: KnowledgeSourceId;
  /** null = shared HQ knowledge visible to HQ-level agents only. */
  businessId: BusinessId | null;
  kind: KnowledgeSourceKind;
  name: string;
  /** Opaque location reference (resolved server-side, never sent to clients). */
  locationRef: string;
  access: "read-only";
  lastIndexedAt: IsoTimestamp | null;
}

// ---------------------------------------------------------------------------
// Knowledge notes (Markdown files in an Obsidian-compatible vault)
// ---------------------------------------------------------------------------

export const KNOWLEDGE_NOTE_SCHEMA_VERSION = 1 as const;

/** What a note is about. Each kind has its own folder in a scope. */
export type KnowledgeNoteKind = "business" | "project" | "report" | "agent";

/**
 * Where a note came from.
 * - "app":    written by the application on behalf of a real user/agent.
 * - "sample": demo content, labelled as such everywhere it is shown.
 */
export type KnowledgeNoteOrigin = "app" | "sample";

export type KnowledgeNoteStatus = "draft" | "final";

/**
 * - "internal":   normal business knowledge.
 * - "restricted": never leaves this server (excluded from any sync).
 */
export type KnowledgeConfidentiality = "internal" | "restricted";

/**
 * Frontmatter written at the top of every generated note. Flat keys so
 * Obsidian shows them as Properties. Never contains secrets.
 */
export interface KnowledgeNoteMeta {
  schema: typeof KNOWLEDGE_NOTE_SCHEMA_VERSION;
  id: string;
  kind: KnowledgeNoteKind;
  title: string;
  /** Business slug, or null for headquarters-level notes. */
  business: string | null;
  project: string | null;
  /** Agent the note is about (kind "agent") or produced by. */
  agent: string | null;
  /** Application task ids this note is linked to. */
  tasks: string[];
  authorKind: "user" | "agent" | "system";
  authorId: string;
  status: KnowledgeNoteStatus;
  confidentiality: KnowledgeConfidentiality;
  origin: KnowledgeNoteOrigin;
  created: string;
  updated: string;
  tags: string[];
}

export interface KnowledgeNote {
  /** Vault-relative POSIX path, e.g. "businesses/acme/reports/2026/2026-11-19-scan.md". */
  path: string;
  meta: KnowledgeNoteMeta;
  body: string;
}

/** Lightweight listing entry (no body). */
export interface KnowledgeNoteSummary {
  path: string;
  meta: KnowledgeNoteMeta;
}

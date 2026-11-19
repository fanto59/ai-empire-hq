import {
  KNOWLEDGE_NOTE_SCHEMA_VERSION,
  type KnowledgeNoteMeta,
} from "@/domain/knowledge";
import { KnowledgeError } from "./errors";

/**
 * Frontmatter (de)serialization for our fixed schema.
 *
 * We write a strict subset of YAML: one `key: value` per line, where every
 * value is JSON (quoted string, number, null, or a flow array of strings).
 * JSON is valid YAML, so Obsidian reads it as normal Properties, and we can
 * parse it without a YAML dependency. Unknown keys are rejected on read.
 */
const KEY_ORDER: (keyof KnowledgeNoteMeta)[] = [
  "schema",
  "id",
  "kind",
  "title",
  "business",
  "project",
  "agent",
  "tasks",
  "authorKind",
  "authorId",
  "status",
  "confidentiality",
  "origin",
  "created",
  "updated",
  "tags",
];

/** Obsidian-friendly property names on disk. */
const DISK_KEY: Record<keyof KnowledgeNoteMeta, string> = {
  schema: "aehq_schema",
  id: "id",
  kind: "kind",
  title: "title",
  business: "business",
  project: "project",
  agent: "agent",
  tasks: "tasks",
  authorKind: "author_kind",
  authorId: "author_id",
  status: "status",
  confidentiality: "confidentiality",
  origin: "origin",
  created: "created",
  updated: "updated",
  tags: "tags",
};
const FROM_DISK = new Map(Object.entries(DISK_KEY).map(([k, v]) => [v, k as keyof KnowledgeNoteMeta]));

export function serializeNote(meta: KnowledgeNoteMeta, body: string): string {
  const lines = KEY_ORDER.map((k) => `${DISK_KEY[k]}: ${JSON.stringify(meta[k])}`);
  const trimmed = body.replace(/^\s+/, "").replace(/\s+$/, "");
  return `---\n${lines.join("\n")}\n---\n\n${trimmed}\n`;
}

export function parseNote(text: string): { meta: KnowledgeNoteMeta; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw corrupt("missing frontmatter");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw corrupt("unterminated frontmatter");
  const raw: Record<string, unknown> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw corrupt("malformed property line");
    const diskKey = line.slice(0, colon).trim();
    const key = FROM_DISK.get(diskKey);
    if (!key) throw corrupt(`unknown property "${diskKey.slice(0, 32)}"`);
    if (key in raw) throw corrupt(`duplicate property "${diskKey}"`);
    try {
      raw[key] = JSON.parse(line.slice(colon + 1).trim());
    } catch {
      throw corrupt(`property "${diskKey}" is not in the expected format`);
    }
  }
  const meta = validateMeta(raw);
  return { meta, body: normalized.slice(end + 5).replace(/^\n+/, "") };
}

function corrupt(detail: string) {
  return new KnowledgeError("corrupt-note", `Note frontmatter is invalid: ${detail}.`);
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown) => v === null || isStr(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

export function validateMeta(raw: Record<string, unknown>): KnowledgeNoteMeta {
  const fail = (k: string) => corrupt(`property "${DISK_KEY[k as keyof KnowledgeNoteMeta] ?? k}" has an invalid value`);
  for (const k of KEY_ORDER) if (!(k in raw)) throw corrupt(`missing property "${DISK_KEY[k]}"`);
  if (raw.schema !== KNOWLEDGE_NOTE_SCHEMA_VERSION) throw fail("schema");
  if (!isStr(raw.id)) throw fail("id");
  if (!["business", "project", "report", "agent"].includes(raw.kind as string)) throw fail("kind");
  if (!isStr(raw.title)) throw fail("title");
  for (const k of ["business", "project", "agent"]) if (!isStrOrNull(raw[k])) throw fail(k);
  if (!isStrArray(raw.tasks)) throw fail("tasks");
  if (!["user", "agent", "system"].includes(raw.authorKind as string)) throw fail("authorKind");
  if (!isStr(raw.authorId)) throw fail("authorId");
  if (!["draft", "final"].includes(raw.status as string)) throw fail("status");
  if (!["internal", "restricted"].includes(raw.confidentiality as string)) throw fail("confidentiality");
  if (!["app", "sample"].includes(raw.origin as string)) throw fail("origin");
  if (!isStr(raw.created) || Number.isNaN(Date.parse(raw.created))) throw fail("created");
  if (!isStr(raw.updated) || Number.isNaN(Date.parse(raw.updated))) throw fail("updated");
  if (!isStrArray(raw.tags)) throw fail("tags");
  return raw as unknown as KnowledgeNoteMeta;
}

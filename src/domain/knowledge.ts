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

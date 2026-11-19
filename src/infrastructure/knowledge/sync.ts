import type { KnowledgeNoteSummary } from "@/domain/knowledge";

/**
 * KNOWLEDGE SYNC - design for a future Obsidian Headless Sync adapter.
 *
 * NOTHING HERE SYNCS. In this version every adapter reports "disabled", and
 * the app never transmits notes anywhere. See docs/KNOWLEDGE.md for the full
 * design; the essentials:
 *
 *   app vault (source of truth for app writes)
 *        │  selectNotesForSync(policy)      <- default-deny filter (below)
 *        ▼
 *   sync mirror directory (policy-filtered copy, one per remote vault)
 *        │  Obsidian's official headless Sync client, run as a separate
 *        ▼  sidecar process with credentials from the secret store
 *   remote Obsidian vault (end-to-end encrypted)
 *
 * Inbound edits from Obsidian are treated as untrusted input: they are
 * re-validated (frontmatter schema, location match, secret scan) before the
 * app vault accepts them.
 */

export interface KnowledgeSyncPolicy {
  /** Master switch. Must stay false until the owner approves sync. */
  enabled: boolean;
  /** Businesses whose notes may leave the server. Empty = none. */
  allowedBusinesses: readonly string[];
  /** Whether headquarters notes may sync. */
  includeHq: boolean;
  /** Whether sample/demo notes may sync (never needed in production). */
  includeSamples: boolean;
}

/** The only policy this version ships with: nothing syncs. */
export const DEFAULT_SYNC_POLICY: KnowledgeSyncPolicy = Object.freeze({
  enabled: false,
  allowedBusinesses: Object.freeze([]) as readonly string[],
  includeHq: false,
  includeSamples: false,
});

export type SyncExclusionReason =
  | "sync-disabled"
  | "restricted"
  | "sample-content"
  | "hq-not-allowed"
  | "business-not-allowed";

export interface SyncSelection {
  include: KnowledgeNoteSummary[];
  exclude: { path: string; reason: SyncExclusionReason }[];
}

/**
 * Pure, default-deny selection of notes that MAY be synced. A note is
 * included only if every rule allows it; restricted notes never sync.
 */
export function selectNotesForSync(notes: readonly KnowledgeNoteSummary[], policy: KnowledgeSyncPolicy): SyncSelection {
  const include: KnowledgeNoteSummary[] = [];
  const exclude: SyncSelection["exclude"] = [];
  for (const note of notes) {
    const m = note.meta;
    let reason: SyncExclusionReason | null = null;
    if (!policy.enabled) reason = "sync-disabled";
    else if (m.confidentiality === "restricted") reason = "restricted";
    else if (m.origin === "sample" && !policy.includeSamples) reason = "sample-content";
    else if (m.business === null && !policy.includeHq) reason = "hq-not-allowed";
    else if (m.business !== null && !policy.allowedBusinesses.includes(m.business)) reason = "business-not-allowed";
    if (reason) exclude.push({ path: note.path, reason });
    else include.push(note);
  }
  return { include, exclude };
}

export type SyncState = "disabled" | "not-implemented" | "idle" | "syncing" | "error";

export interface SyncStatus {
  adapter: string;
  state: SyncState;
  /** Human-readable explanation, safe to show in the UI. */
  detail: string;
}

export interface KnowledgeSyncAdapter {
  readonly name: string;
  status(): Promise<SyncStatus>;
  /** Pushes the selected notes and pulls remote edits once. */
  syncOnce(selection: SyncSelection): Promise<{ pushed: number; pulled: number }>;
}

export class SyncDisabledError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SyncDisabledError";
  }
}

/** Default adapter: does nothing, says so. */
export class DisabledKnowledgeSync implements KnowledgeSyncAdapter {
  readonly name = "disabled";

  async status(): Promise<SyncStatus> {
    return {
      adapter: this.name,
      state: "disabled",
      detail: "Automatic synchronization is off. Notes stay in the local vault on this server.",
    };
  }

  async syncOnce(): Promise<{ pushed: number; pulled: number }> {
    throw new SyncDisabledError("Knowledge sync is disabled in this version.");
  }
}

/**
 * Configuration the future Obsidian Headless Sync adapter will need. No
 * secret values live here: `credentialRef` names an entry in the server's
 * secret store, resolved only inside the sync sidecar.
 */
export interface ObsidianHeadlessSyncConfig {
  /** Dedicated mirror directory (never the app vault itself). */
  mirrorDir: string;
  /** Remote vault name; one remote vault per business is recommended. */
  remoteVault: string;
  /** Secret-store reference for the Obsidian account / vault password. */
  credentialRef: string;
  policy: KnowledgeSyncPolicy;
}

/**
 * Placeholder for the real adapter. It validates its configuration so the
 * shape is exercised by tests, but refuses to run: implementing it requires
 * the owner's approval (Obsidian Sync is a paid service) and a review of
 * the official headless client's current CLI and terms.
 */
export class ObsidianHeadlessSyncAdapter implements KnowledgeSyncAdapter {
  readonly name = "obsidian-headless-sync";
  private readonly config: ObsidianHeadlessSyncConfig;

  constructor(config: ObsidianHeadlessSyncConfig) {
    if (!config.mirrorDir || !config.remoteVault || !config.credentialRef) {
      throw new Error("Obsidian sync config needs mirrorDir, remoteVault and credentialRef.");
    }
    this.config = config;
  }

  async status(): Promise<SyncStatus> {
    return {
      adapter: this.name,
      state: "not-implemented",
      detail: `Designed but not implemented. Policy allows ${this.config.policy.enabled ? this.config.policy.allowedBusinesses.length : 0} business(es).`,
    };
  }

  async syncOnce(): Promise<{ pushed: number; pulled: number }> {
    throw new SyncDisabledError("Obsidian Headless Sync is not implemented yet.");
  }
}

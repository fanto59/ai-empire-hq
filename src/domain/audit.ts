import type { AgentId, AuditEntryId, BusinessId, IsoTimestamp, UserId } from "./ids";

export type AuditActor =
  | { kind: "user"; userId: UserId }
  | { kind: "agent"; agentId: AgentId }
  | { kind: "system" };

/** Append-only audit log. Entries are never edited or deleted by the app. */
export interface AuditEntry {
  id: AuditEntryId;
  businessId: BusinessId | null;
  actor: AuditActor;
  action: string;
  target: { type: string; id: string } | null;
  occurredAt: IsoTimestamp;
  /** Must never contain secrets or raw credentials. */
  metadata: Record<string, string | number | boolean | null>;
}

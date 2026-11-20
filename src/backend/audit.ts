import type { Executor } from "@/infrastructure/db/client";
import { auditLogs } from "@/infrastructure/db/schema";

export interface AuditInput {
  organizationId: string;
  businessId: string | null;
  actor: { kind: "user" | "agent" | "system"; id: string };
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, string | number | boolean | null>;
  at: Date;
}

/** Appends one audit entry. The table is append-only (database trigger). */
export async function writeAudit(db: Executor, e: AuditInput): Promise<number> {
  const [row] = await db.insert(auditLogs).values({
    organizationId: e.organizationId,
    businessId: e.businessId,
    actorKind: e.actor.kind,
    actorId: e.actor.id,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    metadata: e.metadata ?? {},
    occurredAt: e.at,
  }).returning({ id: auditLogs.id });
  return row!.id;
}

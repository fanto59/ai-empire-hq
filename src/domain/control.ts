/**
 * What every control-center action returns. The UI shows `accepted` exactly
 * as the server reported it - never an optimistic guess.
 */
export interface ControlResult {
  /** True only when the server applied the action. */
  accepted: boolean;
  message: string;
  /** Audit log entry written for this action (null when nothing was applied). */
  auditId: number | null;
  /** Server time of the decision. */
  at: string;
  /** True when this exact request (same idempotency key) was already handled; nothing was applied again. */
  duplicate?: boolean;
  /** Machine-readable reason when refused (e.g. "unauthorized", "expired", "budget"). */
  code?: string;
  /** Shown once: an approval token issued for an approved proposal. */
  approvalToken?: string;
  tokenExpiresAt?: string;
}

/**
 * Sensitive action kinds. External-effect kinds have NO connected integration:
 * they can be proposed and approved for the record, but executing them does
 * nothing until an integration exists (and it must go through the same gate).
 */
export const EXTERNAL_ACTION_KINDS = ["financial_transfer", "binding_commitment", "external_message", "public_publish", "production_deploy"] as const;
export const INTERNAL_ACTION_KINDS = ["budget_increase", "resume_new_work"] as const;
export type ActionKind = (typeof EXTERNAL_ACTION_KINDS)[number] | (typeof INTERNAL_ACTION_KINDS)[number];

export const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  financial_transfer: "Financial transfer",
  binding_commitment: "Binding commitment (contract)",
  external_message: "External message",
  public_publish: "Public publishing",
  production_deploy: "Production deployment",
  budget_increase: "Budget increase",
  resume_new_work: "Resume new work (lift emergency suspension)",
};

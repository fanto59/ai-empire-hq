import type { BusinessId, IntegrationId, IsoTimestamp } from "./ids";
import type { ModelProviderId } from "./agent";

/**
 * A configured connection to an outside service. Secrets are NEVER stored in
 * this record: `secretRef` names an entry in a server-side secret store.
 */
export type IntegrationKind = "model-provider" | "knowledge" | "business-account";

export type IntegrationStatus = "disabled" | "pending-review" | "enabled" | "revoked";

export interface IntegrationConnection {
  id: IntegrationId;
  /** null = HQ-wide (e.g. a model provider shared by all businesses). */
  businessId: BusinessId | null;
  kind: IntegrationKind;
  provider: ModelProviderId | string;
  status: IntegrationStatus;
  secretRef: string | null;
  /** Explicit scopes granted. Default-deny: empty means nothing allowed. */
  scopes: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

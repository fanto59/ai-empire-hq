/**
 * Service-layer errors with an HTTP status. Messages are safe to return to
 * API clients: no SQL, stack traces, secrets or other businesses' data.
 */
export type ServiceErrorCode =
  | "invalid-input"
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "invalid-transition"
  | "unavailable";

const STATUS: Record<ServiceErrorCode, number> = {
  "invalid-input": 400,
  unauthenticated: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "invalid-transition": 409,
  unavailable: 503,
};

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;
  /** Optional machine-readable detail, e.g. "approval-required". */
  readonly reason: string | undefined;

  constructor(code: ServiceErrorCode, message: string, reason?: string) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = STATUS[code];
    this.reason = reason;
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ServiceError("invalid-input", `${field} must be a UUID.`);
  return value;
}

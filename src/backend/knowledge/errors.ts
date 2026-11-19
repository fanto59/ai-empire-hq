/**
 * Knowledge-service errors. Messages are safe to show to the user: they
 * never echo secrets or absolute server paths.
 */
export type KnowledgeErrorCode =
  | "invalid-input"
  | "invalid-path"
  | "not-found"
  | "already-exists"
  | "access-denied"
  | "secret-detected"
  | "corrupt-note";

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;

  constructor(code: KnowledgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "KnowledgeError";
  }
}

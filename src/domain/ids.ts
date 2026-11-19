/**
 * Branded ID types. They are plain strings at runtime but cannot be mixed up
 * at compile time (e.g. passing an AgentId where a BusinessId is expected).
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type HeadquartersId = Brand<string, "HeadquartersId">;
export type BusinessId = Brand<string, "BusinessId">;
export type DepartmentId = Brand<string, "DepartmentId">;
export type AgentId = Brand<string, "AgentId">;
export type ProjectId = Brand<string, "ProjectId">;
export type TaskId = Brand<string, "TaskId">;
export type KnowledgeSourceId = Brand<string, "KnowledgeSourceId">;
export type IntegrationId = Brand<string, "IntegrationId">;
export type UserId = Brand<string, "UserId">;
export type AuditEntryId = Brand<string, "AuditEntryId">;

/** ISO-8601 timestamp string in UTC, e.g. "2026-11-19T08:00:00.000Z". */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

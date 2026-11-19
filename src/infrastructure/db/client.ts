import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";

/**
 * DATABASE CONNECTIONS
 *
 * DATABASE_URL accepts:
 *   postgres://user:pass@host:5432/db   real PostgreSQL (node-postgres pool)
 *   pglite:<directory>                  embedded PostgreSQL (WASM) on disk
 *   pglite:memory                       embedded PostgreSQL in memory (tests)
 *
 * PGlite is full PostgreSQL compiled to WebAssembly. It lets tests and local
 * development run without a database server (e.g. on a Chromebook). Production
 * uses a real PostgreSQL server.
 */
export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Db | Tx;

export interface DatabaseHandle {
  db: Db;
  kind: "postgres" | "pglite";
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "drizzle");

export async function openDatabase(url: string): Promise<DatabaseHandle> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const [{ Pool }, { drizzle }] = await Promise.all([import("pg"), import("drizzle-orm/node-postgres")]);
    const pool = new Pool({ connectionString: url, max: 10 });
    // An idle connection dropped by the server (restart, failover) must not
    // crash the process; the pool replaces it on the next query.
    pool.on("error", (err) => console.warn(`[db] idle connection closed: ${err.message}`));
    return { db: drizzle(pool, { schema }) as unknown as Db, kind: "postgres", close: () => pool.end() };
  }
  if (url.startsWith("pglite:")) {
    const [{ PGlite }, { drizzle }] = await Promise.all([import("@electric-sql/pglite"), import("drizzle-orm/pglite")]);
    const target = url.slice("pglite:".length);
    let client;
    if (target === "memory") {
      client = new PGlite();
    } else {
      const dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), target);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      client = new PGlite(dir);
    }
    await client.waitReady;
    return { db: drizzle(client, { schema }) as unknown as Db, kind: "pglite", close: () => client.close() };
  }
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or pglite:");
}

export async function migrateDatabase(handle: DatabaseHandle, migrationsFolder = MIGRATIONS_DIR): Promise<void> {
  if (handle.kind === "postgres") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder });
  }
}

/** Redacts credentials from a database URL for logs and UI. */
export function describeDatabaseUrl(url: string): string {
  if (url.startsWith("pglite:")) return `embedded PostgreSQL (${url.slice(7)})`;
  try {
    const u = new URL(url);
    return `PostgreSQL at ${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "PostgreSQL";
  }
}

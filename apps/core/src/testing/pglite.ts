import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DatabasePort, Queryable } from "../db.js";

const SUPABASE_DIR = fileURLToPath(
  new URL("../../../../infra/supabase/", import.meta.url),
);

export interface TestDatabase extends DatabasePort {
  readonly raw: PGlite;
  /** Runs raw SQL outside the typed query surface (RLS and constraint tests). */
  exec(sql: string): Promise<void>;
  /** Runs `fn` while `role` is active, then resets the role. */
  asRole<T>(role: string, fn: () => Promise<T>): Promise<T>;
  setJwtSubject(subject: string | null): Promise<void>;
  close(): Promise<void>;
}

/**
 * In-process PostgreSQL for integration tests.
 *
 * Applies the real migration files and the real seed, so schema drift between
 * tests and deployment shows up immediately. No network, no Docker.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const raw = new PGlite();
  await raw.waitReady;

  // Supabase always provides these roles; the migrations grant to them.
  await raw.exec("create role authenticated; create role anon;");

  const migrationsDir = join(SUPABASE_DIR, "migrations");
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const migration of migrations) {
    await raw.exec(readFileSync(join(migrationsDir, migration), "utf8"));
  }

  await raw.exec(readFileSync(join(SUPABASE_DIR, "seed.sql"), "utf8"));

  const queryable: Queryable = {
    async query<T>(text: string, values?: readonly unknown[]): Promise<T[]> {
      const result = await raw.query(text, values as unknown[]);
      return result.rows as T[];
    },
  };

  return {
    raw,
    configured: true,

    query: queryable.query.bind(queryable),

    async withTransaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      await raw.exec("begin");
      try {
        const value = await fn(queryable);
        await raw.exec("commit");
        return value;
      } catch (error) {
        await raw.exec("rollback");
        throw error;
      }
    },

    async ping(): Promise<number> {
      const startedAt = process.hrtime.bigint();
      await raw.query("select 1 as ok");
      return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    },

    async exec(sql: string): Promise<void> {
      await raw.exec(sql);
    },

    async asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
      await raw.exec(`set role ${role}`);
      try {
        return await fn();
      } finally {
        await raw.exec("reset role");
      }
    },

    async setJwtSubject(subject: string | null): Promise<void> {
      await raw.query("select set_config('request.jwt.claim.sub', $1, false)", [
        subject ?? "",
      ]);
    },

    async close(): Promise<void> {
      await raw.close();
    },
  };
}

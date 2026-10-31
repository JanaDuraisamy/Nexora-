import { Pool } from "pg";
import type { PoolClient, QueryResultRow } from "pg";

/** Minimal query surface shared by the pool and transaction-scoped clients. */
export interface Queryable {
  query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<T[]>;
}

export interface DatabaseOptions {
  connectionString: string;
  ssl: "disable" | "require";
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured");
    this.name = "DatabaseNotConfiguredError";
  }
}

class ClientQueryable implements Queryable {
  constructor(private readonly client: PoolClient) {}

  async query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<T[]> {
    const result = await this.client.query<T>(text, values as unknown[]);
    return result.rows;
  }
}

export class Database implements Queryable {
  private readonly pool: Pool | null;

  constructor(options: DatabaseOptions | null) {
    if (options === null) {
      this.pool = null;
      return;
    }

    this.pool = new Pool({
      connectionString: options.connectionString,
      ssl:
        options.ssl === "require" ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "nexora-core",
    });
  }

  get configured(): boolean {
    return this.pool !== null;
  }

  async query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<T[]> {
    if (this.pool === null) {
      throw new DatabaseNotConfiguredError();
    }

    const result = await this.pool.query<T>(text, values as unknown[]);
    return result.rows;
  }

  async withTransaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    if (this.pool === null) {
      throw new DatabaseNotConfiguredError();
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const value = await fn(new ClientQueryable(client));
      await client.query("commit");
      return value;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // The original error is more useful; a failed rollback is logged by pg.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<number> {
    const startedAt = process.hrtime.bigint();
    await this.query("select 1 as ok");
    const elapsedNs = process.hrtime.bigint() - startedAt;
    return Number(elapsedNs) / 1_000_000;
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

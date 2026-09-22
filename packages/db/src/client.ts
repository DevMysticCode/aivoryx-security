import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export interface DbHealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface CreateDbClientOptions {
  /** Max simultaneous connections in the pool. */
  maxConnections?: number;
  /** Seconds an idle pooled connection is kept open before being closed. */
  idleTimeoutSeconds?: number;
  /** Seconds to wait for a new connection before failing. */
  connectTimeoutSeconds?: number;
}

export interface DbClient {
  db: PostgresJsDatabase<typeof schema>;
  sql: Sql;
  close: () => Promise<void>;
  healthCheck: () => Promise<DbHealthCheckResult>;
}

/**
 * Creates a database client. Connecting is lazy (postgres.js only opens a socket
 * on the first query), so this never blocks or throws for an unreachable database —
 * use healthCheck() to actually verify connectivity.
 */
export function createDbClient(databaseUrl: string, options: CreateDbClientOptions = {}): DbClient {
  const sql = postgres(databaseUrl, {
    max: options.maxConnections ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    // Postgres NOTICE messages (e.g. from DDL) are noisy and not errors; suppress them.
    onnotice: () => undefined,
  });
  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
    healthCheck: async () => {
      const start = Date.now();
      try {
        await sql`select 1`;
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (error) {
        return {
          healthy: false,
          error: error instanceof Error ? error.message : 'unknown database error',
        };
      }
    },
  };
}

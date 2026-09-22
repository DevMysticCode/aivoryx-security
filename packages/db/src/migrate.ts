import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsFolder = path.join(moduleDir, '../migrations');

/**
 * Applies all pending SQL migrations in `migrationsFolder`. Safe to call with an
 * empty migrations folder (a no-op) — that's the expected state until a later batch
 * adds the first domain schema migration.
 */
export async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string = defaultMigrationsFolder,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

import { describe, expect, it } from 'vitest';
import { createDbClient } from './client.js';
import { runMigrations } from './migrate.js';

// Requires a live PostgreSQL instance. Run via:
//   pnpm infra:up
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/aivoryx \
//     pnpm --filter @aivoryx/db test:integration
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('createDbClient (integration)', () => {
  it('connects to a real PostgreSQL instance and reports healthy', async () => {
    const client = createDbClient(DATABASE_URL as string);

    const result = await client.healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    await client.close();
  });

  it('applies the (currently empty) migration set without error', async () => {
    await expect(runMigrations(DATABASE_URL as string)).resolves.toBeUndefined();
  });
});

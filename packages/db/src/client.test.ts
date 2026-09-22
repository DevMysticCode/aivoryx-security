import { describe, expect, it } from 'vitest';
import { createDbClient } from './client.js';

describe('createDbClient', () => {
  it('creates a client without connecting eagerly (connection is lazy)', async () => {
    const client = createDbClient('postgres://user:pass@localhost:65535/doesnotexist');

    expect(client.db).toBeDefined();
    expect(client.sql).toBeDefined();
    expect(typeof client.close).toBe('function');
    expect(typeof client.healthCheck).toBe('function');

    await client.close();
  });

  it('healthCheck reports unhealthy with an error message when the database is unreachable', async () => {
    const client = createDbClient('postgres://user:pass@127.0.0.1:1/doesnotexist', {
      connectTimeoutSeconds: 2,
    });

    const result = await client.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.error).toBeTruthy();

    await client.close();
  }, 10_000);
});

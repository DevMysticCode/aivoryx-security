import { describe, expect, it } from 'vitest';
import { createRedisConnection } from './connection.js';

describe('createRedisConnection', () => {
  it('configures the connection the way BullMQ requires and connects lazily in tests', async () => {
    const connection = createRedisConnection('redis://127.0.0.1:6390', { lazyConnect: true });

    expect(connection.options.maxRetriesPerRequest).toBeNull();
    expect(connection.status).toBe('wait');

    await connection.quit().catch(() => undefined);
  });
});

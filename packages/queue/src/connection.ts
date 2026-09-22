import { Redis } from 'ioredis';

export interface CreateRedisConnectionOptions {
  /** When true, the client does not connect until the first command. Mainly for tests. */
  lazyConnect?: boolean;
}

export interface RedisHealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Creates the Redis connection used by both BullMQ queues and workers.
 * `maxRetriesPerRequest: null` is required by BullMQ — see
 * https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest
 */
export function createRedisConnection(
  redisUrl: string,
  options: CreateRedisConnectionOptions = {},
): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: options.lazyConnect ?? false,
  });
}

export async function checkRedisHealth(connection: Redis): Promise<RedisHealthCheckResult> {
  const start = Date.now();
  try {
    await connection.ping();
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'unknown redis error',
    };
  }
}

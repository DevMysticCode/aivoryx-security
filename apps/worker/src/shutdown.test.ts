import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from './shutdown.js';

describe('createShutdownHandler', () => {
  it('runs cleanup once and exits with code 0 on success', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdownHandler(logger, cleanup, exit);

    await shutdown('SIGTERM');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('logs and exits with code 1 when cleanup throws', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const cleanup = vi.fn().mockRejectedValue(new Error('worker close failed'));
    const exit = vi.fn();
    const shutdown = createShutdownHandler(logger, cleanup, exit);

    await shutdown('SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('is idempotent under repeated signals', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdownHandler(logger, cleanup, exit);

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGTERM')]);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

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
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and exits with code 1 when cleanup throws', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const cleanup = vi.fn().mockRejectedValue(new Error('close failed'));
    const exit = vi.fn();
    const shutdown = createShutdownHandler(logger, cleanup, exit);

    await shutdown('SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'error during shutdown',
    );
  });

  it('ignores a second signal while shutdown is already in progress', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    let resolveCleanup!: () => void;
    const cleanup = vi
      .fn()
      .mockReturnValue(new Promise<void>((resolve) => (resolveCleanup = resolve)));
    const exit = vi.fn();
    const shutdown = createShutdownHandler(logger, cleanup, exit);

    const first = shutdown('SIGTERM');
    await shutdown('SIGTERM');

    expect(cleanup).toHaveBeenCalledTimes(1);

    resolveCleanup();
    await first;
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

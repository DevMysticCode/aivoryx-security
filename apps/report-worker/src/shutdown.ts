export interface ShutdownLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

/**
 * Returns a signal handler that runs `cleanup` exactly once (subsequent signals
 * while shutdown is already in progress are ignored) and exits the process
 * afterwards. Used for SIGTERM/SIGINT.
 */
export function createShutdownHandler(
  logger: ShutdownLogger,
  cleanup: () => Promise<void>,
  exit: (code: number) => void = process.exit.bind(process),
): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');
    try {
      await cleanup();
      logger.info({}, 'shutdown complete');
      exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      exit(1);
    }
  };
}

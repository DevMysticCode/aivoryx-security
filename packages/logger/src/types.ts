export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  /** Name of the process emitting logs, e.g. 'api', 'worker', 'report-worker'. */
  serviceName: string;
  level?: LogLevel;
  /** Extra static fields attached to every log line from this logger. */
  base?: Record<string, unknown>;
  /** Test-only: write log output here instead of stdout. */
  destination?: NodeJS.WritableStream;
}

/** Correlation metadata safe to attach to a logger via withContext(). */
export interface LogContext {
  requestId?: string;
  jobId?: string;
  assessmentId?: string;
  [key: string]: unknown;
}

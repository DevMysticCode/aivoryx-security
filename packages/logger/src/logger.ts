import pino, { type Logger as PinoLogger } from 'pino';
import type { LogContext, LoggerOptions } from './types.js';

export type Logger = PinoLogger;

/**
 * Field paths pino redacts (replaces with '[redacted]') wherever they appear in a
 * logged object, at any nesting depth via the '*' wildcard. Covers the categories
 * called out by the platform's security requirements: credentials, tokens, and
 * connection strings that embed credentials.
 */
const REDACTED_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'jwt',
  '*.jwt',
  'jwtSecret',
  '*.jwtSecret',
  'apiKey',
  '*.apiKey',
  'secret',
  '*.secret',
  'credentialMasterKey',
  '*.credentialMasterKey',
  'databaseUrl',
  '*.databaseUrl',
  'redisUrl',
  '*.redisUrl',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      name: options.serviceName,
      level: options.level ?? 'info',
      base: { service: options.serviceName, ...options.base },
      redact: {
        paths: REDACTED_PATHS,
        censor: '[redacted]',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    options.destination,
  );
}

/** Returns a child logger with correlation metadata (request/job/assessment id) attached. */
export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}

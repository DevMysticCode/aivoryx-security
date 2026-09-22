import type { z } from 'zod';
import { rawEnvSchema } from './schema.js';
import type { AppConfig, LogLevel, NodeEnv } from './types.js';

export class ConfigValidationError extends Error {
  constructor(issues: z.ZodIssue[]) {
    const details = issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    super(`Invalid application configuration:\n${details}`);
    this.name = 'ConfigValidationError';
  }
}

// Insecure on purpose: only ever used when NODE_ENV !== 'production' and the
// operator hasn't set a real value. Never used in production (enforced in schema.ts).
const DEV_JWT_SECRET_FALLBACK = 'dev-only-insecure-jwt-secret-do-not-use-in-production!!';
const DEV_CREDENTIAL_MASTER_KEY_FALLBACK = 'dev-only-insecure-credential-key-do-not-use-in-prod!!';

const DEFAULT_LOG_LEVEL_BY_NODE_ENV: Record<NodeEnv, LogLevel> = {
  development: 'debug',
  test: 'silent',
  production: 'info',
};

/**
 * Parses and validates `env` into a strongly typed AppConfig, throwing
 * ConfigValidationError with a full list of problems if anything is invalid
 * or missing. This is the only place environment variables are read/parsed;
 * everything else should consume the returned AppConfig.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = rawEnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  const raw = result.data;

  const isProduction = raw.NODE_ENV === 'production';
  const isDevelopment = raw.NODE_ENV === 'development';
  const isTest = raw.NODE_ENV === 'test';

  if (!isProduction && !raw.JWT_SECRET) {
    console.warn('[config] JWT_SECRET not set — using an insecure development-only default.');
  }
  if (!isProduction && !raw.CREDENTIAL_MASTER_KEY) {
    console.warn(
      '[config] CREDENTIAL_MASTER_KEY not set — using an insecure development-only default.',
    );
  }

  return {
    nodeEnv: raw.NODE_ENV,
    appEnv: raw.APP_ENV ?? raw.NODE_ENV,
    appName: raw.APP_NAME,
    isProduction,
    isDevelopment,
    isTest,
    logLevel: raw.LOG_LEVEL ?? DEFAULT_LOG_LEVEL_BY_NODE_ENV[raw.NODE_ENV],

    api: {
      port: raw.API_PORT,
    },

    urls: {
      publicAppUrl: raw.PUBLIC_APP_URL,
      publicApiUrl: raw.PUBLIC_API_URL,
      internalApiUrl: raw.INTERNAL_API_URL ?? raw.PUBLIC_API_URL,
    },

    database: {
      url: raw.DATABASE_URL,
    },

    redis: {
      url: raw.REDIS_URL,
    },

    auth: {
      jwtSecret: raw.JWT_SECRET ?? DEV_JWT_SECRET_FALLBACK,
      jwtExpiresIn: raw.JWT_EXPIRES_IN,
    },

    security: {
      credentialMasterKey: raw.CREDENTIAL_MASTER_KEY ?? DEV_CREDENTIAL_MASTER_KEY_FALLBACK,
      ssrfAllowPrivateRanges: raw.SSRF_ALLOW_PRIVATE_RANGES,
      allowedScanPorts: raw.SCAN_ALLOWED_PORTS,
      scanTimeoutMs: raw.SCAN_TIMEOUT_MS,
      maxResponseBytes: raw.MAX_RESPONSE_BYTES,
      workerConcurrency: raw.WORKER_CONCURRENCY,
    },

    ai: {
      enabled: raw.AI_ENABLED,
      provider: raw.AI_PROVIDER,
      model: raw.AI_MODEL,
      apiKey: raw.AI_API_KEY,
      baseUrl: raw.AI_BASE_URL,
    },
  };
}

let cachedConfig: AppConfig | undefined;

/** Returns the process-wide config, parsing `process.env` once and caching the result. */
export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig(process.env);
  return cachedConfig;
}

/** Test-only: clears the memoized config so the next getConfig() call re-parses process.env. */
export function resetConfigCache(): void {
  cachedConfig = undefined;
}

/** Redacted view of an AppConfig safe to write to logs. */
export function toSafeConfigSummary(config: AppConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    appEnv: config.appEnv,
    appName: config.appName,
    api: config.api,
    urls: config.urls,
    database: { url: '[redacted]' },
    redis: { url: '[redacted]' },
    auth: { jwtSecret: '[redacted]', jwtExpiresIn: config.auth.jwtExpiresIn },
    security: {
      credentialMasterKey: '[redacted]',
      ssrfAllowPrivateRanges: config.security.ssrfAllowPrivateRanges,
      allowedScanPorts: config.security.allowedScanPorts,
      scanTimeoutMs: config.security.scanTimeoutMs,
      maxResponseBytes: config.security.maxResponseBytes,
      workerConcurrency: config.security.workerConcurrency,
    },
    ai: {
      enabled: config.ai.enabled,
      provider: config.ai.provider,
      model: config.ai.model,
      apiKey: config.ai.apiKey ? '[redacted]' : undefined,
      baseUrl: config.ai.baseUrl,
    },
  };
}

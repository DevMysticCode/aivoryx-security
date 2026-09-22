import { z } from 'zod';
import { booleanFromEnv, csvIntListFromEnv, intFromEnv } from './env-helpers.js';

export const AI_PROVIDERS = ['groq', 'gemini', 'openai', 'ollama'] as const;

const isUrl = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Raw, flat shape of every environment variable this platform reads, before it is
 * reshaped into the nested AppConfig the rest of the codebase consumes. This is the
 * single source of truth for what env vars exist and how each one is validated.
 */
export const rawEnvSchema = z
  .object({
    // --- Application ---------------------------------------------------
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // APP_ENV allows a deployment label (e.g. "staging") that is distinct from the
    // Node runtime mode; falls back to NODE_ENV when unset.
    APP_ENV: z.enum(['development', 'staging', 'test', 'production']).optional(),
    APP_NAME: z.string().min(1).default('aivoryx-tester'),
    API_PORT: intFromEnv(z.number().int().min(1).max(65535), 4000),
    // No schema-level default: the effective default depends on NODE_ENV and is
    // computed in config.ts (quiet in test, verbose in development, moderate in prod).
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),

    // --- URLs ------------------------------------------------------------
    PUBLIC_APP_URL: z
      .string()
      .refine(isUrl, 'PUBLIC_APP_URL must be a valid URL')
      .default('http://localhost:5173'),
    PUBLIC_API_URL: z
      .string()
      .refine(isUrl, 'PUBLIC_API_URL must be a valid URL')
      .default('http://localhost:4000'),
    // Worker -> API service-to-service URL. Falls back to PUBLIC_API_URL when unset
    // (fine for local dev; production typically points this at an internal hostname).
    INTERNAL_API_URL: z.string().refine(isUrl, 'INTERNAL_API_URL must be a valid URL').optional(),

    // --- Database ----------------------------------------------------------
    // No default: a silently-defaulted connection string could point production at
    // the wrong database. Must always be set explicitly.
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
        'DATABASE_URL must be a postgres:// or postgresql:// connection string',
      ),

    // --- Redis / Queue -------------------------------------------------------
    // Same reasoning as DATABASE_URL: always required, never defaulted.
    REDIS_URL: z
      .string()
      .min(1, 'REDIS_URL is required')
      .refine(
        (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
        'REDIS_URL must be a redis:// or rediss:// connection string',
      ),

    // --- Authentication --------------------------------------------------------
    // No schema-level default: production must set this explicitly (enforced below).
    // A development-only fallback is applied later, outside the schema, so the
    // fallback value never has to be documented as a "valid" input.
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
    JWT_EXPIRES_IN: z.string().min(1).default('15m'),

    // --- Security ----------------------------------------------------------------
    CREDENTIAL_MASTER_KEY: z
      .string()
      .min(32, 'CREDENTIAL_MASTER_KEY must be at least 32 characters')
      .optional(),
    SSRF_ALLOW_PRIVATE_RANGES: booleanFromEnv(false),
    SCAN_ALLOWED_PORTS: csvIntListFromEnv([80, 443, 8080, 8443]),
    SCAN_TIMEOUT_MS: intFromEnv(z.number().int().positive(), 120_000),
    MAX_RESPONSE_BYTES: intFromEnv(z.number().int().positive(), 1_000_000),
    WORKER_CONCURRENCY: intFromEnv(z.number().int().positive(), 2),
    // --- Scanner HTTP client (Batch 4) -------------------------------------------
    SCAN_CONNECT_TIMEOUT_MS: intFromEnv(z.number().int().positive(), 5_000),
    SCAN_MAX_REDIRECTS: intFromEnv(z.number().int().min(0).max(10), 3),
    SCAN_MAX_HEADER_BYTES: intFromEnv(z.number().int().positive(), 32_768),
    // Upper bound on outbound HTTP requests a single scanner run may issue —
    // deliberately distinct from WORKER_CONCURRENCY (which bounds concurrent
    // BullMQ jobs, not outbound requests per job). See Part S.
    SCAN_MAX_REQUESTS_PER_ASSESSMENT: intFromEnv(z.number().int().positive(), 20),

    // --- AI (optional, disabled by default) --------------------------------------
    AI_ENABLED: booleanFromEnv(false),
    AI_PROVIDER: z.enum(AI_PROVIDERS).optional(),
    AI_MODEL: z.string().min(1).optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_BASE_URL: z.string().refine(isUrl, 'AI_BASE_URL must be a valid URL').optional(),
  })
  .superRefine((data, ctx) => {
    const isProduction = data.NODE_ENV === 'production';

    if (isProduction && !data.JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET is required in production and must not rely on a default value',
      });
    }

    if (isProduction && !data.CREDENTIAL_MASTER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CREDENTIAL_MASTER_KEY'],
        message:
          'CREDENTIAL_MASTER_KEY is required in production and must not rely on a default value',
      });
    }

    if (isProduction && data.SSRF_ALLOW_PRIVATE_RANGES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SSRF_ALLOW_PRIVATE_RANGES'],
        message: 'SSRF_ALLOW_PRIVATE_RANGES must not be true in production',
      });
    }

    if (data.AI_ENABLED) {
      if (!data.AI_PROVIDER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_PROVIDER'],
          message: 'AI_PROVIDER is required when AI_ENABLED=true',
        });
      } else if (data.AI_PROVIDER !== 'ollama' && !data.AI_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_API_KEY'],
          message: `AI_API_KEY is required when AI_PROVIDER=${data.AI_PROVIDER}`,
        });
      }
    }
  });

export type RawEnv = z.infer<typeof rawEnvSchema>;

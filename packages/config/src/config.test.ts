import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigValidationError, loadConfig } from './config.js';

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/aivoryx',
    REDIS_URL: 'redis://localhost:6379',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('loadConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('parses a valid development configuration', () => {
    const config = loadConfig(baseEnv());

    expect(config.nodeEnv).toBe('development');
    expect(config.isDevelopment).toBe(true);
    expect(config.database.url).toBe('postgres://user:pass@localhost:5432/aivoryx');
    expect(config.redis.url).toBe('redis://localhost:6379');
    expect(config.auth.jwtSecret).toEqual(expect.stringContaining('dev-only'));
  });

  it('throws a ConfigValidationError when required configuration is missing', () => {
    const env = baseEnv();
    delete env.DATABASE_URL;

    expect(() => loadConfig(env)).toThrow(ConfigValidationError);
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() => loadConfig(baseEnv({ NODE_ENV: 'staging' }))).toThrow(ConfigValidationError);
  });

  it('parses boolean env vars from strings instead of using string truthiness', () => {
    const disabled = loadConfig(baseEnv({ AI_ENABLED: 'false' }));
    expect(disabled.ai.enabled).toBe(false);

    const enabled = loadConfig(baseEnv({ AI_ENABLED: 'true', AI_PROVIDER: 'ollama' }));
    expect(enabled.ai.enabled).toBe(true);
  });

  it('parses numeric env vars and rejects non-numeric values', () => {
    const config = loadConfig(baseEnv({ SCAN_TIMEOUT_MS: '30000' }));
    expect(config.security.scanTimeoutMs).toBe(30_000);

    expect(() => loadConfig(baseEnv({ SCAN_TIMEOUT_MS: 'not-a-number' }))).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects an invalid URL', () => {
    expect(() => loadConfig(baseEnv({ PUBLIC_APP_URL: 'not-a-url' }))).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects an unsupported AI provider', () => {
    expect(() =>
      loadConfig(baseEnv({ AI_ENABLED: 'true', AI_PROVIDER: 'not-a-real-provider' })),
    ).toThrow(ConfigValidationError);
  });

  it('requires JWT_SECRET and CREDENTIAL_MASTER_KEY in production', () => {
    expect(() => loadConfig(baseEnv({ NODE_ENV: 'production' }))).toThrow(
      /JWT_SECRET is required in production/,
    );

    const validProductionEnv = baseEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      CREDENTIAL_MASTER_KEY: 'b'.repeat(32),
    });
    expect(() => loadConfig(validProductionEnv)).not.toThrow();
  });

  it('rejects SSRF_ALLOW_PRIVATE_RANGES=true in production', () => {
    const env = baseEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      CREDENTIAL_MASTER_KEY: 'b'.repeat(32),
      SSRF_ALLOW_PRIVATE_RANGES: 'true',
    });
    expect(() => loadConfig(env)).toThrow(/SSRF_ALLOW_PRIVATE_RANGES/);
  });

  it('applies safe defaults when optional variables are unset', () => {
    const config = loadConfig(baseEnv());

    expect(config.api.port).toBe(4000);
    expect(config.security.ssrfAllowPrivateRanges).toBe(false);
    expect(config.security.allowedScanPorts).toEqual([80, 443, 8080, 8443]);
    expect(config.security.scanTimeoutMs).toBe(120_000);
    expect(config.ai.enabled).toBe(false);
    expect(config.logLevel).toBe('debug');
  });

  it('computes a sensible default log level per NODE_ENV and allows override', () => {
    expect(loadConfig(baseEnv({ NODE_ENV: 'development' })).logLevel).toBe('debug');
    expect(loadConfig(baseEnv({ NODE_ENV: 'test' })).logLevel).toBe('silent');
    expect(
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'a'.repeat(32),
          CREDENTIAL_MASTER_KEY: 'b'.repeat(32),
        }),
      ).logLevel,
    ).toBe('info');
    expect(loadConfig(baseEnv({ LOG_LEVEL: 'warn' })).logLevel).toBe('warn');
  });
});

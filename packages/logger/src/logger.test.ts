import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, withContext } from './logger.js';

class MemoryStream extends Writable {
  private chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get lines(): Record<string, unknown>[] {
    return this.chunks
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

describe('createLogger', () => {
  it('includes the service name and provided level in every log line', () => {
    const destination = new MemoryStream();
    const logger = createLogger({ serviceName: 'test-service', level: 'debug', destination });

    logger.debug('hello');

    const [line] = destination.lines;
    expect(line).toMatchObject({ service: 'test-service', msg: 'hello' });
  });

  it('suppresses log lines below the configured level', () => {
    const destination = new MemoryStream();
    const logger = createLogger({ serviceName: 'test-service', level: 'warn', destination });

    logger.info('should be suppressed');
    logger.warn('should appear');

    expect(destination.lines).toHaveLength(1);
    expect(destination.lines[0]).toMatchObject({ msg: 'should appear' });
  });

  it('redacts known secret fields instead of logging their values', () => {
    const destination = new MemoryStream();
    const logger = createLogger({ serviceName: 'test-service', level: 'debug', destination });

    logger.info({
      password: 'hunter2',
      nested: { token: 'super-secret-token' },
      databaseUrl: 'postgres://user:pass@host/db',
      safeField: 'visible',
    });

    const [line] = destination.lines;
    expect(line).toMatchObject({
      password: '[redacted]',
      nested: { token: '[redacted]' },
      databaseUrl: '[redacted]',
      safeField: 'visible',
    });
  });

  it('withContext attaches correlation metadata to every subsequent log line', () => {
    const destination = new MemoryStream();
    const logger = createLogger({ serviceName: 'test-service', level: 'debug', destination });
    const requestLogger = withContext(logger, { requestId: 'req-123' });

    requestLogger.info('handled request');

    const [line] = destination.lines;
    expect(line).toMatchObject({ requestId: 'req-123', msg: 'handled request' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createAuditService } from './audit.js';
import type * as schema from './schema.js';

function fakeDb(captured: Record<string, unknown>[]) {
  return {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        captured.push(row);
      },
    }),
  } as unknown as PostgresJsDatabase<typeof schema>;
}

describe('createAuditService', () => {
  it('records an event with the given fields', async () => {
    const captured: Record<string, unknown>[] = [];
    const audit = createAuditService(fakeDb(captured));

    await audit.record({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'project.created',
      resourceType: 'project',
      resourceId: 'project-1',
      metadata: { name: 'Example' },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      action: 'project.created',
      resourceType: 'project',
      resourceId: 'project-1',
      metadata: { name: 'Example' },
    });
  });

  it('allows a null organizationId for platform-level events', async () => {
    const captured: Record<string, unknown>[] = [];
    const audit = createAuditService(fakeDb(captured));

    await audit.record({ action: 'platform.support_access', organizationId: null });

    expect(captured[0]?.organizationId).toBeNull();
  });

  it('redacts secret-shaped metadata keys instead of storing them', async () => {
    const captured: Record<string, unknown>[] = [];
    const audit = createAuditService(fakeDb(captured));

    await audit.record({
      action: 'api_key.created',
      metadata: {
        apiKey: 'avx_abc123.supersecret',
        password: 'hunter2',
        token: 'jwt-value',
        credential: 'value',
        Authorization: 'Bearer xyz',
        name: 'CI key',
      },
    });

    const metadata = captured[0]?.metadata as Record<string, unknown>;
    expect(metadata.apiKey).toBe('[redacted]');
    expect(metadata.password).toBe('[redacted]');
    expect(metadata.token).toBe('[redacted]');
    expect(metadata.credential).toBe('[redacted]');
    expect(metadata.Authorization).toBe('[redacted]');
    expect(metadata.name).toBe('CI key');
    expect(JSON.stringify(metadata)).not.toContain('supersecret');
    expect(JSON.stringify(metadata)).not.toContain('hunter2');
  });

  it('truncates oversized metadata instead of storing it verbatim', async () => {
    const captured: Record<string, unknown>[] = [];
    const audit = createAuditService(fakeDb(captured));

    await audit.record({ action: 'test.oversized', metadata: { blob: 'x'.repeat(20_000) } });

    const metadata = captured[0]?.metadata as Record<string, unknown>;
    expect(metadata.truncated).toBe(true);
    expect(metadata.blob).toBeUndefined();
  });

  it('calls onError and does not throw when the write fails', async () => {
    const onError = vi.fn();
    const failingDb = {
      insert: () => ({
        values: async () => {
          throw new Error('db unavailable');
        },
      }),
    } as unknown as PostgresJsDatabase<typeof schema>;
    const audit = createAuditService(failingDb, { onError });

    await expect(audit.record({ action: 'project.created' })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'project.created' }),
    );
  });
});

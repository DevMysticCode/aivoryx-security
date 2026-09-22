import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { auditEvents } from './schema.js';

// Redacts metadata fields that look secret-shaped by name. This is a defense-in-
// depth heuristic, not a guarantee — callers must still never pass raw secrets
// (API keys, tokens, passwords) into metadata in the first place.
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|credential|authorization)/i;
const MAX_METADATA_BYTES = 8_000;

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }

  const serialized = JSON.stringify(sanitized);
  if (serialized.length > MAX_METADATA_BYTES) {
    return { truncated: true, originalSizeBytes: serialized.length };
  }
  return sanitized;
}

export interface RecordAuditEventInput {
  organizationId?: string | null | undefined;
  actorUserId?: string | null | undefined;
  action: string;
  resourceType?: string | null | undefined;
  resourceId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export interface AuditService {
  record(input: RecordAuditEventInput): Promise<void>;
}

export interface CreateAuditServiceOptions {
  /**
   * Called when the write itself fails. The failure is intentionally never
   * re-thrown — an audit-log outage must not break the operation being audited —
   * but it must not be silently swallowed either, so callers should log it here.
   */
  onError?: (error: unknown, input: RecordAuditEventInput) => void;
}

export function createAuditService(
  db: PostgresJsDatabase<typeof schema>,
  options: CreateAuditServiceOptions = {},
): AuditService {
  return {
    async record(input) {
      try {
        await db.insert(auditEvents).values({
          organizationId: input.organizationId ?? null,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          metadata: sanitizeMetadata(input.metadata),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        });
      } catch (error) {
        options.onError?.(error, input);
      }
    },
  };
}

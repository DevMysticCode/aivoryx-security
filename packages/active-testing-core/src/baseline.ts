import { createHash } from 'node:crypto';
import type { SafeHttpResponse } from '@aivoryx/scanner-core';
import type { Observation } from './types.js';

/**
 * Captures the structured facts about a SafeHttpClient response that the
 * diff engine needs, plus the raw decoded body for classify()'s in-process
 * use (see Observation). `markers` are scanned for in-memory only, at
 * capture time; nothing beyond their presence/absence — and nothing from
 * `body` — is ever persisted (see executor.ts's summarizeObservation()).
 */
export function captureObservation(
  response: SafeHttpResponse,
  markers: readonly string[],
): Observation {
  const bodyHash = createHash('sha256').update(response.body).digest('hex');
  const markersFound = markers.filter((marker) => response.body.includes(marker));

  return {
    status: response.status,
    headers: response.headers,
    contentType: response.headers['content-type'] ?? null,
    bodyLength: response.body.length,
    bodyHash,
    markersFound,
    body: response.body,
  };
}

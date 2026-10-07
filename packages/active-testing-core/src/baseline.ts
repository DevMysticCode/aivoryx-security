import { createHash } from 'node:crypto';
import type { SafeHttpResponse } from '@aivoryx/scanner-core';
import type { Observation } from './types.js';

/**
 * Captures the structured facts about a SafeHttpClient response that the
 * diff engine needs — never the raw body itself (see Observation's
 * bodyHash/markersFound). `markers` are scanned for in-memory only, at
 * capture time; nothing beyond their presence/absence is ever persisted.
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
  };
}

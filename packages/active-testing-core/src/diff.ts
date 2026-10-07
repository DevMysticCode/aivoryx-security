import type { Observation, ObservationDiff } from './types.js';

/**
 * Produces structured facts comparing a baseline and mutated observation —
 * deliberately makes no vulnerability decision (that belongs to a specific
 * test definition's classify()). See Batch 8 spec Part 8.
 */
export function diffObservations(baseline: Observation, mutated: Observation): ObservationDiff {
  const headersChanged = Object.keys({ ...baseline.headers, ...mutated.headers }).filter(
    (name) => baseline.headers[name] !== mutated.headers[name],
  );

  const markersDetected = mutated.markersFound.filter(
    (marker) => !baseline.markersFound.includes(marker),
  );

  return {
    statusChanged: baseline.status !== mutated.status,
    headersChanged,
    contentTypeChanged: baseline.contentType !== mutated.contentType,
    bodyChanged: baseline.bodyHash !== mutated.bodyHash,
    bodyLengthDelta: mutated.bodyLength - baseline.bodyLength,
    markersDetected,
  };
}

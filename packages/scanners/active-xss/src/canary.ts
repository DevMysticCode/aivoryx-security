import { createHash } from 'node:crypto';

/** The characters appended after the marker — tests encoding behavior of the syntactically significant characters without ever executing anything. Deliberately NOT `<script>alert(...)</script>` or similar — see Batch 9 spec Part 4. */
export const PROBE_CHARS = '<"\'>';

export interface Canary {
  /** A stable, alnum-only substring (no special characters) — survives HTML/URL-encoding unchanged, so it's the reliable "was this reflected at all" signal even when the characters around it were neutralized. */
  marker: string;
  /** marker + PROBE_CHARS — the actual query-parameter value injected. */
  payload: string;
}

/**
 * Deterministically derives a canary for one (url, parameter) pair — same
 * inputs always produce the same canary, so a finding's fingerprint stays
 * stable across repeated scans (see packages/scanner-core's
 * computeFindingFingerprint) rather than creating a new "finding" every
 * time. Unique enough in practice to avoid false matches against real page
 * content, ASCII-safe, bounded, and contains no secrets. Never derived from
 * anything request- or time-specific (no assessment/execution id) — the
 * canary's job is purely to prove reflection for THIS parameter, not to be
 * globally unique across the universe of scans.
 */
export function generateCanary(url: string, paramName: string): Canary {
  const hash = createHash('sha256').update(`${url}\u0000${paramName}`).digest('hex').slice(0, 8);
  const marker = `aivoryxXSS${hash}`;
  return { marker, payload: `${marker}${PROBE_CHARS}` };
}

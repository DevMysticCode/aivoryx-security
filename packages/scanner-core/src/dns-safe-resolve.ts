import { isIP } from 'node:net';
import { promises as dns } from 'node:dns';
import { checkIpAgainstSsrfPolicy } from './ssrf.js';
import { SsrfViolationError } from './errors.js';

export interface SafeResolveResult {
  /** The single IP address the connection must be pinned to. */
  address: string;
  family: 4 | 6;
}

export interface SafeResolveOptions {
  allowPrivateRanges?: boolean | undefined;
}

/**
 * Resolves `hostname` and validates every returned address against SSRF
 * policy, rejecting the whole hostname if ANY resolved address is blocked
 * (a multi-A-record host that mixes one public and one private address is
 * treated as unsafe rather than "lucky" — see Part C/D).
 *
 * DNS rebinding defense (Part D): the caller must use the returned `address`
 * to open the actual connection (e.g. via a `lookup` override passed to
 * `http.request`/`https.request`) instead of letting the HTTP stack re-resolve
 * the hostname itself. That closes the classic rebinding window where a
 * validation-time lookup and a connect-time lookup return different answers —
 * here there is only ever one lookup, and its result is what's connected to.
 */
export async function resolveHostSafely(
  hostname: string,
  options: SafeResolveOptions = {},
): Promise<SafeResolveResult> {
  const allowPrivateRanges = options.allowPrivateRanges ?? false;

  // A literal IP in the URL: no DNS involved, validate it directly.
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    const check = checkIpAgainstSsrfPolicy(hostname, allowPrivateRanges);
    if (!check.allowed) {
      throw new SsrfViolationError(check.reason ?? `IP address ${hostname} is not allowed`);
    }
    return { address: hostname, family: literalFamily };
  }

  // A plain lookup failure (ENOTFOUND, etc.) is ordinary target-unreachability,
  // not a security violation — deliberately NOT an SsrfViolationError, so
  // callers can distinguish "this target doesn't resolve" from "this target
  // resolved to something we refuse to contact". See Part R.
  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(
      `DNS resolution failed for host "${hostname}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (records.length === 0) {
    throw new Error(`DNS resolution returned no addresses for host "${hostname}"`);
  }

  for (const record of records) {
    const check = checkIpAgainstSsrfPolicy(record.address, allowPrivateRanges);
    if (!check.allowed) {
      throw new SsrfViolationError(
        `Host "${hostname}" resolves to a disallowed address (${record.address}): ${check.reason}`,
      );
    }
  }

  const chosen = records[0];
  if (!chosen) {
    throw new SsrfViolationError(
      `DNS resolution returned no usable address for host "${hostname}"`,
    );
  }
  return { address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

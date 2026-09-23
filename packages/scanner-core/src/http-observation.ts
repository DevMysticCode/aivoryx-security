import type { SafeHttpResponse } from './http-client.js';

export type SameSiteValue = 'Strict' | 'Lax' | 'None';

/**
 * Sanitized cookie metadata — NEVER the cookie's value. Built once from a
 * Set-Cookie header and reused by every cookie-related passive check; the
 * raw header string is discarded immediately after parsing. See Part E.
 */
export interface HttpCookieObservation {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSiteValue | null;
  domain: string | null;
  path: string | null;
}

export interface HttpObservationRedirectHop {
  url: string;
  status: number;
}

/**
 * The typed internal model passive checks operate on (Part B). Built once
 * from a single SafeHttpClient response — passive checks never see the raw
 * response object, never make their own request, and never see anything
 * that could carry a secret (cookie values, Authorization headers).
 */
export interface HttpObservation {
  requestedUrl: string;
  finalUrl: string;
  scheme: 'http' | 'https';
  status: number;
  /** Lowercased header name -> value, EXCLUDING set-cookie (see `cookies`). */
  headers: Record<string, string>;
  contentType: string | null;
  observedResponseBytes: number;
  durationMs: number;
  redirectCount: number;
  redirectChain: HttpObservationRedirectHop[];
  tls: { protocol: string | null } | null;
  cookies: HttpCookieObservation[];
}

/**
 * Parses one Set-Cookie header instance into sanitized metadata. Returns
 * null for a malformed header (no `name=value` pair) rather than throwing —
 * passive analysis must never crash the scanner on an odd but harmless
 * response. The cookie's actual value is read only to locate the end of the
 * name/value pair and is never retained.
 */
export function parseSetCookieHeader(raw: string): HttpCookieObservation | null {
  const parts = raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const nameValue = parts[0];
  if (!nameValue) return null;

  const eqIndex = nameValue.indexOf('=');
  if (eqIndex <= 0) return null;
  const name = nameValue.slice(0, eqIndex).trim();
  if (!name) return null;

  let secure = false;
  let httpOnly = false;
  let sameSite: SameSiteValue | null = null;
  let domain: string | null = null;
  let path: string | null = null;

  for (const attr of parts.slice(1)) {
    const [rawKey, ...rest] = attr.split('=');
    const key = (rawKey ?? '').trim().toLowerCase();
    const value = rest.join('=').trim();

    if (key === 'secure') secure = true;
    else if (key === 'httponly') httpOnly = true;
    else if (key === 'samesite') {
      const normalized = value.toLowerCase();
      if (normalized === 'strict') sameSite = 'Strict';
      else if (normalized === 'lax') sameSite = 'Lax';
      else if (normalized === 'none') sameSite = 'None';
    } else if (key === 'domain') domain = value || null;
    else if (key === 'path') path = value || null;
  }

  return { name, secure, httpOnly, sameSite, domain, path };
}

/** Builds the passive-analysis observation model from one SafeHttpClient response. Pure — no I/O. */
export function buildHttpObservation(response: SafeHttpResponse): HttpObservation {
  const finalUrl = new URL(response.finalUrl);
  const scheme = finalUrl.protocol === 'https:' ? 'https' : 'http';

  const cookies = response.setCookieHeaders
    .map(parseSetCookieHeader)
    .filter((cookie): cookie is HttpCookieObservation => cookie !== null);

  return {
    requestedUrl: response.requestedUrl,
    finalUrl: response.finalUrl,
    scheme,
    status: response.status,
    headers: response.headers,
    contentType: response.headers['content-type'] ?? null,
    observedResponseBytes: response.bodyBytesRead,
    durationMs: response.durationMs,
    redirectCount: response.redirectCount,
    redirectChain: response.hops.map((hop) => ({ url: hop.url, status: hop.status })),
    tls: scheme === 'https' ? { protocol: response.tlsProtocol } : null,
    cookies,
  };
}

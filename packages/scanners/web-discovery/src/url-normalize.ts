// Deterministic URL normalization (Part 4). Rules, in order:
//
// 1. Relative URLs are resolved against the page they were found on
//    (WHATWG URL resolution — also collapses dot-segments per spec).
// 2. The hostname is lowercased.
// 3. The fragment (#...) is always removed — it's never sent to the server
//    and never affects which resource is requested.
// 4. The default port for the scheme (80 for http, 443 for https) is
//    stripped, so `http://example.com:80/` and `http://example.com/`
//    normalize identically.
// 5. An empty path becomes `/` (WHATWG URL already does this for http(s)).
// 6. The query string is ALWAYS preserved byte-for-byte (order and all) —
//    `/product?id=1` and `/product?id=2` are distinct discovered URLs, and
//    query parameters may encode entirely different application routes.
//    This is a deliberate choice: normalization must never be destructive
//    enough to change which application route a URL represents.
// 7. A real trailing slash (e.g. `/foo/`) is left untouched — some servers
//    treat `/foo` and `/foo/` as different resources, so collapsing them
//    would be a semantic change, not a normalization. Only the "no path at
//    all" case is normalized (to `/`), which is safe because it's what an
//    HTTP client would request anyway.
//
// Percent-encoding of the host/path is normalized as a side effect of
// WHATWG URL parsing (e.g. unreserved characters are decoded, everything
// else stays consistently encoded) — no additional pass is needed.

export class InvalidUrlError extends Error {
  constructor(raw: string) {
    super(`Not a valid URL: ${raw}`);
    this.name = 'InvalidUrlError';
  }
}

/** Normalizes `raw`, resolving it against `base` if it's relative. Throws InvalidUrlError for unparseable input. */
export function normalizeUrl(raw: string, base?: string): string {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new InvalidUrlError(raw);
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  const isDefaultPort =
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443');
  if (isDefaultPort) url.port = '';

  if (url.pathname === '') url.pathname = '/';

  return url.toString();
}

// Query parameter names whose VALUE is redacted before a URL is persisted —
// applied only at storage time (see Part 17), never to the URL actually
// used to make a request. Two URLs that differ only in a redacted
// parameter's value intentionally collapse to the same stored row: we don't
// want one discovered_urls row per distinct session token/API key value.
const SENSITIVE_QUERY_PARAM_PATTERN =
  /(token|password|secret|api[_-]?key|auth|session|credential)/i;

/** Redacts sensitive-looking query parameter VALUES for safe persistence. Never mutates the URL used for the actual HTTP request. */
export function redactSensitiveQueryParams(normalizedUrl: string): string {
  let url: URL;
  try {
    url = new URL(normalizedUrl);
  } catch {
    return normalizedUrl;
  }

  const sensitiveKeys = Array.from(url.searchParams.keys()).filter((key) =>
    SENSITIVE_QUERY_PARAM_PATTERN.test(key),
  );
  if (sensitiveKeys.length === 0) return normalizedUrl;

  for (const key of new Set(sensitiveKeys)) {
    url.searchParams.set(key, 'REDACTED');
  }
  return url.toString();
}

import http from 'node:http';
import https from 'node:https';
import type { LookupAddress } from 'node:dns';
import type { AssessmentScope } from '@aivoryx/shared-types';
import { requireUrlInScope } from './scope.js';
import { resolveHostSafely } from './dns-safe-resolve.js';
import { ResourceLimitExceededError, ScopeViolationError } from './errors.js';

export type SafeHttpMethod = 'GET' | 'HEAD';

export interface SafeHttpClientOptions {
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  maxRedirects: number;
  maxResponseBytes: number;
  maxHeaderBytes: number;
  /** Test-only escape hatch for local fixtures — see packages/config's SSRF_ALLOW_PRIVATE_RANGES. */
  allowPrivateRanges?: boolean;
  userAgent?: string;
}

export interface SafeHttpRequestOptions {
  method?: SafeHttpMethod;
}

export interface SafeHttpHop {
  url: string;
  status: number;
}

export interface SafeHttpResponse {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  /** Raw Set-Cookie header instances, one per cookie — never joined with ',' (which would corrupt Expires attributes and multi-cookie parsing) — see Node's special-cased `set-cookie` header array. */
  setCookieHeaders: string[];
  /** TLS protocol version (e.g. 'TLSv1.3'), when available for an https response. Never includes certificate/key material. */
  tlsProtocol: string | null;
  httpVersion: string;
  redirectCount: number;
  hops: SafeHttpHop[];
  bodyBytesRead: number;
  bodyTruncated: boolean;
  durationMs: number;
}

const DEFAULT_USER_AGENT = 'AivoryxSecurityScanner/1.0 (+https://aivoryx.security)';

/**
 * The only supported way for a scanner to make an outbound request to a
 * target. Enforces, in order, on the INITIAL url and on EVERY redirect hop:
 * scheme validation, scope validation, DNS resolution + SSRF validation
 * (pinning the connection to the exact validated IP — see
 * dns-safe-resolve.ts for the rebinding rationale), then applies connection/
 * request timeouts, a maximum response size, a maximum redirect count, and a
 * maximum header size. Scanner plugins MUST NOT use fetch/axios/undici/got
 * directly for target traffic — see Part F.
 */
export class SafeHttpClient {
  constructor(private readonly options: SafeHttpClientOptions) {}

  async request(
    rawUrl: string,
    scope: AssessmentScope,
    requestOptions: SafeHttpRequestOptions = {},
  ): Promise<SafeHttpResponse> {
    const method = requestOptions.method ?? 'GET';
    const started = Date.now();
    const hops: SafeHttpHop[] = [];
    const visited = new Set<string>();

    let currentUrl = new URL(rawUrl);

    for (let redirectCount = 0; ; redirectCount += 1) {
      const normalized = currentUrl.toString();
      if (visited.has(normalized)) {
        throw new ResourceLimitExceededError(`Redirect loop detected at ${normalized}`);
      }
      visited.add(normalized);

      // Steps 1-3 & 7-9: scheme/scope/path/exclusion validation.
      requireUrlInScope(currentUrl, scope);

      // Steps 4-6: DNS resolution + SSRF validation, pinned for the connect below.
      const resolved = await resolveHostSafely(currentUrl.hostname, {
        allowPrivateRanges: this.options.allowPrivateRanges,
      });

      const result = await this.performOneRequest(currentUrl, resolved.address, method);
      hops.push({ url: normalized, status: result.status });

      const isRedirect = result.status >= 300 && result.status < 400;
      const location = result.headers['location'];

      if (!isRedirect || !location) {
        return {
          requestedUrl: rawUrl,
          finalUrl: normalized,
          status: result.status,
          headers: result.headers,
          setCookieHeaders: result.setCookieHeaders,
          tlsProtocol: result.tlsProtocol,
          httpVersion: result.httpVersion,
          redirectCount,
          hops,
          bodyBytesRead: result.bodyBytesRead,
          bodyTruncated: result.bodyTruncated,
          durationMs: Date.now() - started,
        };
      }

      if (redirectCount >= this.options.maxRedirects) {
        throw new ResourceLimitExceededError(
          `Exceeded maximum of ${this.options.maxRedirects} redirects`,
        );
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new ScopeViolationError(`Redirect Location header is not a valid URL: ${location}`);
      }
      if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
        throw new ScopeViolationError(
          `Redirect to unsupported scheme rejected: ${nextUrl.protocol}`,
        );
      }

      // Every redirect destination is re-validated from scratch on the next
      // loop iteration (scope, then a fresh DNS+SSRF check) — a redirect is
      // never trusted just because the previous hop was in scope. Part B/E.
      currentUrl = nextUrl;
    }
  }

  private performOneRequest(
    url: URL,
    pinnedAddress: string,
    method: SafeHttpMethod,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    setCookieHeaders: string[];
    tlsProtocol: string | null;
    httpVersion: string;
    bodyBytesRead: number;
    bodyTruncated: boolean;
  }> {
    const transport = url.protocol === 'https:' ? https : http;
    const { connectTimeoutMs, requestTimeoutMs, maxResponseBytes, maxHeaderBytes } = this.options;

    return new Promise((resolve, reject) => {
      const lookup = (
        _hostname: string,
        opts: unknown,
        callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
      ) => {
        // Pins the connection to the exact address already validated above —
        // this is what closes the DNS-rebinding window (see dns-safe-resolve.ts).
        const family =
          typeof opts === 'object' && opts && 'family' in opts ? (opts as LookupAddress).family : 0;
        callback(null, pinnedAddress, family || (pinnedAddress.includes(':') ? 6 : 4));
      };

      const req = transport.request({
        protocol: url.protocol,
        hostname: url.hostname,
        host: url.hostname,
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lookup: lookup as any,
        headers: {
          'User-Agent': this.options.userAgent ?? DEFAULT_USER_AGENT,
          Accept: '*/*',
          Connection: 'close',
        },
        timeout: requestTimeoutMs,
      });

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        fn();
      };

      const connectTimer = setTimeout(() => {
        finish(() => {
          req.destroy();
          reject(new ResourceLimitExceededError(`Connection to ${url.hostname} timed out`));
        });
      }, connectTimeoutMs);

      let tlsProtocol: string | null = null;
      req.once('socket', (socket) => {
        socket.once('connect', () => clearTimeout(connectTimer));
        socket.once('secureConnect', () => {
          const getProtocol = (socket as unknown as { getProtocol?: () => string | null })
            .getProtocol;
          tlsProtocol =
            typeof getProtocol === 'function' ? (getProtocol.call(socket) ?? null) : null;
        });
      });

      req.once('timeout', () => {
        finish(() => {
          req.destroy();
          reject(new ResourceLimitExceededError(`Request to ${url.hostname} timed out`));
        });
      });

      req.once('error', (error) => {
        finish(() => reject(error));
      });

      req.once('response', (res) => {
        // Approximate header-size enforcement: Node's client API doesn't expose
        // a hard header-byte cap the way its server API does, so this checks
        // the raw wire representation after headers arrive and aborts before
        // any body is read if it's oversized. See Part G's documented limitation.
        const rawHeaderBytes = (res.rawHeaders ?? []).reduce((sum, part) => sum + part.length, 0);
        if (rawHeaderBytes > maxHeaderBytes) {
          finish(() => {
            res.destroy();
            reject(
              new ResourceLimitExceededError(`Response headers exceeded ${maxHeaderBytes} bytes`),
            );
          });
          return;
        }

        const headers: Record<string, string> = {};
        let setCookieHeaders: string[] = [];
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          const lowerKey = key.toLowerCase();
          if (lowerKey === 'set-cookie') {
            // Node returns 'set-cookie' as a string[] specifically because
            // joining multiple cookies with ',' would corrupt parsing (a
            // cookie's Expires attribute itself contains commas). Preserve
            // each instance separately rather than flattening into `headers`.
            setCookieHeaders = Array.isArray(value) ? value : [value];
            continue;
          }
          headers[lowerKey] = Array.isArray(value) ? value.join(', ') : value;
        }

        let bytesRead = 0;
        let truncated = false;

        res.on('data', (chunk: Buffer) => {
          bytesRead += chunk.length;
          // We never decompress a response body ourselves (no zlib/gzip
          // inflate is applied anywhere in this client) — the byte count
          // enforced here is always the raw wire size, which sidesteps
          // decompression-bomb risk entirely rather than trying to bound a
          // post-decompression size. See Part G.
          if (bytesRead > maxResponseBytes) {
            truncated = true;
            res.destroy();
          }
        });

        res.once('end', () => {
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              headers,
              setCookieHeaders,
              tlsProtocol,
              httpVersion: res.httpVersion,
              bodyBytesRead: bytesRead,
              bodyTruncated: truncated,
            }),
          );
        });

        res.once('close', () => {
          if (truncated) {
            finish(() =>
              resolve({
                status: res.statusCode ?? 0,
                headers,
                setCookieHeaders,
                tlsProtocol,
                httpVersion: res.httpVersion,
                bodyBytesRead: bytesRead,
                bodyTruncated: true,
              }),
            );
          }
        });

        res.once('error', (error) => {
          finish(() => reject(error));
        });
      });

      req.end();
    });
  }
}

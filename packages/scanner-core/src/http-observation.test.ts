import { describe, expect, it } from 'vitest';
import { buildHttpObservation, parseSetCookieHeader } from './http-observation.js';
import type { SafeHttpResponse } from './http-client.js';

describe('parseSetCookieHeader', () => {
  it('parses a simple cookie with no attributes', () => {
    const cookie = parseSetCookieHeader('session=abc123');
    expect(cookie).toEqual({
      name: 'session',
      secure: false,
      httpOnly: false,
      sameSite: null,
      domain: null,
      path: null,
    });
  });

  it('parses Secure, HttpOnly, and SameSite flags', () => {
    const cookie = parseSetCookieHeader('session=abc123; Secure; HttpOnly; SameSite=Strict');
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
  });

  it('parses SameSite=Lax and SameSite=None case-insensitively', () => {
    expect(parseSetCookieHeader('a=1; samesite=lax')?.sameSite).toBe('Lax');
    expect(parseSetCookieHeader('a=1; SAMESITE=NONE')?.sameSite).toBe('None');
  });

  it('parses Domain and Path', () => {
    const cookie = parseSetCookieHeader('a=1; Domain=example.com; Path=/app');
    expect(cookie?.domain).toBe('example.com');
    expect(cookie?.path).toBe('/app');
  });

  it('handles a cookie value containing an Expires date with commas', () => {
    const cookie = parseSetCookieHeader(
      'session=abc; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Secure',
    );
    expect(cookie?.name).toBe('session');
    expect(cookie?.secure).toBe(true);
  });

  it('never retains the cookie value', () => {
    const cookie = parseSetCookieHeader('session=super-secret-value; Secure');
    expect(JSON.stringify(cookie)).not.toContain('super-secret-value');
  });

  it('returns null for a malformed header with no name=value pair', () => {
    expect(parseSetCookieHeader('')).toBeNull();
    expect(parseSetCookieHeader('justtext')).toBeNull();
    expect(parseSetCookieHeader('=novalue')).toBeNull();
  });

  it('handles a cookie value that itself contains an equals sign', () => {
    const cookie = parseSetCookieHeader('token=abc=def==; Secure');
    expect(cookie?.name).toBe('token');
    expect(cookie?.secure).toBe(true);
  });
});

function baseResponse(overrides: Partial<SafeHttpResponse> = {}): SafeHttpResponse {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    headers: { 'content-type': 'text/html' },
    setCookieHeaders: [],
    tlsProtocol: 'TLSv1.3',
    httpVersion: '1.1',
    redirectCount: 0,
    hops: [{ url: 'https://example.com/', status: 200 }],
    bodyBytesRead: 100,
    bodyTruncated: false,
    durationMs: 10,
    ...overrides,
  };
}

describe('buildHttpObservation', () => {
  it('derives scheme from the final URL', () => {
    expect(buildHttpObservation(baseResponse()).scheme).toBe('https');
    expect(
      buildHttpObservation(
        baseResponse({ finalUrl: 'http://example.com/', requestedUrl: 'http://example.com/' }),
      ).scheme,
    ).toBe('http');
  });

  it('attaches TLS info only for https observations', () => {
    expect(buildHttpObservation(baseResponse()).tls).toEqual({ protocol: 'TLSv1.3' });
    expect(
      buildHttpObservation(
        baseResponse({ finalUrl: 'http://example.com/', requestedUrl: 'http://example.com/' }),
      ).tls,
    ).toBeNull();
  });

  it('parses multiple Set-Cookie headers into the cookies array and excludes set-cookie from headers', () => {
    const observation = buildHttpObservation(
      baseResponse({ setCookieHeaders: ['a=1; Secure', 'b=2; HttpOnly'] }),
    );
    expect(observation.cookies).toHaveLength(2);
    expect(observation.cookies.map((c) => c.name)).toEqual(['a', 'b']);
    expect(observation.headers['set-cookie']).toBeUndefined();
  });

  it('carries contentType, redirect chain, and byte counts through', () => {
    const observation = buildHttpObservation(baseResponse());
    expect(observation.contentType).toBe('text/html');
    expect(observation.redirectChain).toEqual([{ url: 'https://example.com/', status: 200 }]);
    expect(observation.observedResponseBytes).toBe(100);
  });
});

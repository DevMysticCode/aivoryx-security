import { describe, expect, it } from 'vitest';
import type { SafeHttpResponse } from '@aivoryx/scanner-core';
import { captureObservation } from './baseline.js';

function fakeResponse(overrides: Partial<SafeHttpResponse> = {}): SafeHttpResponse {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    headers: { 'content-type': 'text/html' },
    setCookieHeaders: [],
    tlsProtocol: null,
    httpVersion: '1.1',
    redirectCount: 0,
    hops: [],
    body: '<html>hello</html>',
    bodyBytesRead: 19,
    bodyTruncated: false,
    durationMs: 10,
    ...overrides,
  };
}

describe('captureObservation', () => {
  it('captures status, content type, and body length', () => {
    const observation = captureObservation(fakeResponse(), []);
    expect(observation.status).toBe(200);
    expect(observation.contentType).toBe('text/html');
    expect(observation.bodyLength).toBe('<html>hello</html>'.length);
  });

  it('includes the raw decoded body for classify()-time analysis (never auto-persisted — see executor.ts summarizeObservation)', () => {
    const observation = captureObservation(fakeResponse({ body: '<html>hello</html>' }), []);
    expect(observation.body).toBe('<html>hello</html>');
  });

  it('produces the same bodyHash for identical bodies and a different hash for different bodies', () => {
    const a = captureObservation(fakeResponse({ body: 'same' }), []);
    const b = captureObservation(fakeResponse({ body: 'same' }), []);
    const c = captureObservation(fakeResponse({ body: 'different' }), []);
    expect(a.bodyHash).toBe(b.bodyHash);
    expect(a.bodyHash).not.toBe(c.bodyHash);
  });

  it('finds marker strings present in the body and ignores absent ones', () => {
    const observation = captureObservation(fakeResponse({ body: '<script>alert(1)</script>' }), [
      'alert(1)',
      'not-present-marker',
    ]);
    expect(observation.markersFound).toEqual(['alert(1)']);
  });
});

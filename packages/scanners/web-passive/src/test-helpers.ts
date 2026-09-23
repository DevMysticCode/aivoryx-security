import type { HttpObservation, PassiveCheckContext } from '@aivoryx/scanner-core';

export function makeObservation(overrides: Partial<HttpObservation> = {}): HttpObservation {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    scheme: 'https',
    status: 200,
    headers: {},
    contentType: 'text/html',
    observedResponseBytes: 100,
    durationMs: 10,
    redirectCount: 0,
    redirectChain: [{ url: 'https://example.com/', status: 200 }],
    tls: { protocol: 'TLSv1.3' },
    cookies: [],
    ...overrides,
  };
}

export const testContext: PassiveCheckContext = {
  target: 'https://example.com/',
  assetType: 'WEB',
};

import { describe, expect, it } from 'vitest';
import { normalizeUrl, redactSensitiveQueryParams, InvalidUrlError } from './url-normalize.js';

describe('normalizeUrl', () => {
  it('resolves a relative URL against its base page', () => {
    expect(normalizeUrl('/about', 'https://example.com/home')).toBe('https://example.com/about');
    expect(normalizeUrl('contact', 'https://example.com/about/')).toBe(
      'https://example.com/about/contact',
    );
  });

  it('passes through an already-absolute URL', () => {
    expect(normalizeUrl('https://example.com/x')).toBe('https://example.com/x');
  });

  it('removes the fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://EXAMPLE.com/Path')).toBe('https://example.com/Path');
  });

  it('strips the default port for the scheme', () => {
    expect(normalizeUrl('https://example.com:443/x')).toBe('https://example.com/x');
    expect(normalizeUrl('http://example.com:80/x')).toBe('http://example.com/x');
  });

  it('keeps a non-default port', () => {
    expect(normalizeUrl('https://example.com:8443/x')).toBe('https://example.com:8443/x');
  });

  it('preserves the query string exactly, including distinct values', () => {
    expect(normalizeUrl('https://example.com/product?id=1')).toBe(
      'https://example.com/product?id=1',
    );
    expect(normalizeUrl('https://example.com/product?id=2')).toBe(
      'https://example.com/product?id=2',
    );
    expect(normalizeUrl('https://example.com/product?id=1')).not.toBe(
      normalizeUrl('https://example.com/product?id=2'),
    );
  });

  it('collapses dot-segments', () => {
    expect(normalizeUrl('https://example.com/a/b/../c')).toBe('https://example.com/a/c');
    expect(normalizeUrl('https://example.com/a/./b')).toBe('https://example.com/a/b');
  });

  it('normalizes an empty path to /', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('does not strip a real trailing slash from a non-root path', () => {
    expect(normalizeUrl('https://example.com/foo/')).toBe('https://example.com/foo/');
    expect(normalizeUrl('https://example.com/foo')).toBe('https://example.com/foo');
  });

  it('produces identical normalized forms for duplicate URLs', () => {
    const a = normalizeUrl('https://EXAMPLE.com:443/x#frag');
    const b = normalizeUrl('https://example.com/x');
    expect(a).toBe(b);
  });

  it('throws InvalidUrlError for unparseable input', () => {
    expect(() => normalizeUrl('not a url', undefined)).toThrow(InvalidUrlError);
  });
});

describe('redactSensitiveQueryParams', () => {
  it('redacts a token-like parameter value', () => {
    const result = redactSensitiveQueryParams('https://example.com/x?token=abc123&id=5');
    expect(result).toContain('token=REDACTED');
    expect(result).toContain('id=5');
    expect(result).not.toContain('abc123');
  });

  it('leaves non-sensitive parameters untouched', () => {
    const url = 'https://example.com/product?id=1&category=shoes';
    expect(redactSensitiveQueryParams(url)).toBe(url);
  });

  it('redacts common sensitive parameter names', () => {
    for (const name of ['password', 'api_key', 'apikey', 'secret', 'auth', 'session_id']) {
      const result = redactSensitiveQueryParams(`https://example.com/x?${name}=leaked-value`);
      expect(result).not.toContain('leaked-value');
    }
  });
});

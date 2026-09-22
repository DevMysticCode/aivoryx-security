import { describe, expect, it } from 'vitest';
import { checkIpAgainstSsrfPolicy, isValidIpAddress } from './ssrf.js';

describe('checkIpAgainstSsrfPolicy', () => {
  it('allows ordinary public IPv4 addresses', () => {
    expect(checkIpAgainstSsrfPolicy('93.184.216.34').allowed).toBe(true);
    expect(checkIpAgainstSsrfPolicy('8.8.8.8').allowed).toBe(true);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback range'],
    ['10.0.0.1', 'RFC1918'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.255', 'RFC1918'],
    ['192.168.1.1', 'RFC1918'],
    ['169.254.0.1', 'link-local'],
    ['169.254.169.254', 'cloud metadata'],
    ['0.0.0.0', 'this-network'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['192.0.2.1', 'documentation'],
  ])('blocks IPv4 %s (%s)', (ip) => {
    const result = checkIpAgainstSsrfPolicy(ip);
    expect(result.allowed).toBe(false);
  });

  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456:789a::1', 'unique-local'],
    ['ff02::1', 'multicast'],
  ])('blocks IPv6 %s (%s)', (ip) => {
    expect(checkIpAgainstSsrfPolicy(ip).allowed).toBe(false);
  });

  it('allows an ordinary public IPv6 address', () => {
    expect(checkIpAgainstSsrfPolicy('2606:4700:4700::1111').allowed).toBe(true);
  });

  it('blocks an IPv4-mapped IPv6 address whose embedded IPv4 is private', () => {
    expect(checkIpAgainstSsrfPolicy('::ffff:127.0.0.1').allowed).toBe(false);
    expect(checkIpAgainstSsrfPolicy('::ffff:169.254.169.254').allowed).toBe(false);
  });

  it('blocks a NAT64-mapped IPv6 address whose embedded IPv4 is private', () => {
    expect(checkIpAgainstSsrfPolicy('64:ff9b::7f00:1').allowed).toBe(false); // embeds 127.0.0.1
  });

  it('allows an IPv4-mapped IPv6 address whose embedded IPv4 is public', () => {
    expect(checkIpAgainstSsrfPolicy('::ffff:8.8.8.8').allowed).toBe(true);
  });

  it('test-only bypass allows private ranges only when explicitly enabled', () => {
    expect(checkIpAgainstSsrfPolicy('127.0.0.1', true).allowed).toBe(true);
    expect(checkIpAgainstSsrfPolicy('127.0.0.1', false).allowed).toBe(false);
  });

  it('rejects garbage input rather than treating it as allowed', () => {
    expect(checkIpAgainstSsrfPolicy('not-an-ip').allowed).toBe(false);
  });

  it('isValidIpAddress distinguishes valid from invalid addresses', () => {
    expect(isValidIpAddress('1.2.3.4')).toBe(true);
    expect(isValidIpAddress('::1')).toBe(true);
    expect(isValidIpAddress('999.999.999.999')).toBe(false);
    expect(isValidIpAddress('not-an-ip')).toBe(false);
  });
});

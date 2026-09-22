// SSRF IP-range policy: the reusable, dependency-free component every outbound
// request must clear before a connection is opened. Deliberately checks IP
// addresses, never hostnames — a hostname can lie (or change between checks);
// an IP range either contains an address or it doesn't. See Part C.

interface Cidr {
  family: 4 | 6;
  bytes: number[];
  prefixLength: number;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

/** Expands an IPv6 string (including `::` shorthand and IPv4-mapped tails) into 16 bytes. */
function parseIpv6(ip: string): number[] | null {
  let address = ip;
  // Strip zone id (e.g. fe80::1%eth0) — never meaningful for policy checks.
  const zoneIdx = address.indexOf('%');
  if (zoneIdx !== -1) address = address.slice(0, zoneIdx);

  // Handle an embedded IPv4 tail (e.g. ::ffff:192.168.0.1).
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hex = v4.map((b) => b.toString(16).padStart(2, '0'));
    address = `${address.slice(0, lastColon + 1)}${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
  }

  const [head, tailPart] = address.split('::');
  if (address.split('::').length > 2) return null;

  const headGroups = head ? head.split(':').filter((g) => g.length > 0) : [];
  const tailGroups = tailPart ? tailPart.split(':').filter((g) => g.length > 0) : [];

  let groups: string[];
  if (address.includes('::')) {
    const missing = 8 - (headGroups.length + tailGroups.length);
    if (missing < 0) return null;
    groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  } else {
    groups = address.split(':');
  }

  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function ipToBytes(ip: string): { family: 4 | 6; bytes: number[] } | null {
  const v4 = parseIpv4(ip);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = parseIpv6(ip);
  if (v6) return { family: 6, bytes: v6 };
  return null;
}

function cidr(spec: string): Cidr {
  const [addr, prefix] = spec.split('/');
  if (!addr || !prefix) throw new Error(`Invalid CIDR literal: ${spec}`);
  const parsed = ipToBytes(addr);
  if (!parsed) throw new Error(`Invalid CIDR literal: ${spec}`);
  return { family: parsed.family, bytes: parsed.bytes, prefixLength: Number(prefix) };
}

function bytesInCidr(bytes: number[], block: Cidr): boolean {
  let remaining = block.prefixLength;
  for (let i = 0; i < block.bytes.length; i += 1) {
    if (remaining <= 0) break;
    const bitsInByte = Math.min(8, remaining);
    const mask = bitsInByte === 8 ? 0xff : (0xff << (8 - bitsInByte)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((block.bytes[i] ?? 0) & mask)) return false;
    remaining -= bitsInByte;
  }
  return true;
}

// --- IPv4: private/reserved/non-global ranges --------------------------------
const BLOCKED_IPV4_RANGES = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // RFC1918 private
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, includes cloud metadata 169.254.169.254
  '172.16.0.0/12', // RFC1918 private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1 (documentation)
  '192.168.0.0/16', // RFC1918 private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2 (documentation)
  '203.0.113.0/24', // TEST-NET-3 (documentation)
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
  '255.255.255.255/32', // limited broadcast
].map(cidr);

// --- IPv6: private/reserved/non-global ranges ---------------------------------
// Deliberately does NOT include ::ffff:0:0/96 (IPv4-mapped) or 64:ff9b::/96
// (NAT64) as blanket-blocked ranges: those forms simply embed an IPv4
// address, which extractMappedIpv4() below re-checks against the IPv4
// policy directly — a mapped PUBLIC IPv4 must remain allowed, only a mapped
// PRIVATE/reserved one is blocked.
const BLOCKED_IPV6_RANGES = [
  '::/128', // unspecified
  '::1/128', // loopback
  '100::/64', // discard-only
  '2001:db8::/32', // documentation
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'ff00::/8', // multicast
].map(cidr);

export interface SsrfCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * The single SSRF gate: given a resolved IP address, decide whether a
 * connection to it is allowed. `allowPrivateRanges` exists ONLY for the
 * test-only local-fixture mechanism (Part W) — see
 * packages/config's SSRF_ALLOW_PRIVATE_RANGES, which the config schema
 * refuses to let be true in production.
 */
export function checkIpAgainstSsrfPolicy(ip: string, allowPrivateRanges = false): SsrfCheckResult {
  if (allowPrivateRanges) return { allowed: true };

  const parsed = ipToBytes(ip);
  if (!parsed) return { allowed: false, reason: `Unable to parse IP address: ${ip}` };

  if (parsed.family === 4) {
    const blocked = BLOCKED_IPV4_RANGES.find((range) => bytesInCidr(parsed.bytes, range));
    if (blocked) return { allowed: false, reason: `IPv4 address ${ip} is in a blocked range` };
    return { allowed: true };
  }

  // IPv4-mapped/NAT64 IPv6 addresses: also check the embedded IPv4 against the
  // IPv4 policy, since an attacker could otherwise smuggle a private IPv4
  // target through an IPv6-mapped representation.
  const mappedV4 = extractMappedIpv4(parsed.bytes);
  if (mappedV4) {
    const mappedResult = checkIpAgainstSsrfPolicy(mappedV4, allowPrivateRanges);
    if (!mappedResult.allowed) return mappedResult;
  }

  const blocked = BLOCKED_IPV6_RANGES.find((range) => bytesInCidr(parsed.bytes, range));
  if (blocked) return { allowed: false, reason: `IPv6 address ${ip} is in a blocked range` };
  return { allowed: true };
}

function extractMappedIpv4(bytes: number[]): string | null {
  // ::ffff:0:0/96 -> bytes[0..9] = 0, bytes[10..11] = 0xff, bytes[12..15] = IPv4
  const isMapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  // 64:ff9b::/96 NAT64
  const isNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0);
  if (!isMapped && !isNat64) return null;
  return bytes.slice(12, 16).join('.');
}

export function isValidIpAddress(value: string): boolean {
  return ipToBytes(value) !== null;
}

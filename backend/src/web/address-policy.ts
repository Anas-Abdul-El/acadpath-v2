import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * Which IP addresses the server may connect to when it fetches a URL it didn't choose
 * itself (here: URLs an AI found). Only public internet addresses are allowed, so a
 * malicious URL can't reach the cloud metadata service, the database, Redis, or anything
 * else on a private network (SSRF).
 */

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}

// Only global unicast (2000::/3) is allowed, minus ranges that are documentation or can
// embed an IPv4 address the checks above wouldn't see.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['2001:db8::', 32], // documentation
  ['2001::', 32], // Teredo
  ['2002::', 16], // 6to4
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

/** Expands an IPv6 address to its 8 groups, e.g. "::1" → [0,0,0,0,0,0,0,1]. */
function ipv6Groups(ip: string): number[] {
  // Normalise through URL: it rewrites a dotted tail ("::ffff:1.2.3.4") as hex groups.
  const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const [head, tail = ''] = normalized.split('::');
  const left = head ? head.split(':') : [];
  const right = normalized.includes('::') && tail ? tail.split(':') : [];
  const groups = normalized.includes('::')
    ? [
        ...left,
        ...Array<string>(8 - left.length - right.length).fill('0'),
        ...right,
      ]
    : left;
  return groups.map((group) => parseInt(group, 16));
}

/** The IPv4 address embedded in the last 32 bits of an IPv6 address. */
function embeddedIPv4(groups: number[]): string {
  const [high = 0, low = 0] = groups.slice(6);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

export function isPublicAddress(ip: string): boolean {
  if (isIPv4(ip)) return !blockedV4.check(ip, 'ipv4');
  if (!isIPv6(ip)) return false;

  const groups = ipv6Groups(ip);
  const isMapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const isNat64 =
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((g) => g === 0);
  // ::ffff:a.b.c.d and 64:ff9b::a.b.c.d reach an IPv4 host: judge that host.
  if (isMapped || isNat64) return isPublicAddress(embeddedIPv4(groups));

  return globalV6.check(ip, 'ipv6') && !blockedV6.check(ip, 'ipv6');
}

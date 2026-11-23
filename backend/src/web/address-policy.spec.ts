import { isPublicAddress } from './address-policy.js';

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '1.1.1.1', '185.199.108.153', '2606:4700:4700::1111'])(
    'allows the public address %s',
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback (other)', '127.8.9.10'],
    ['"this" network', '0.0.0.0'],
    ['private 10/8', '10.1.2.3'],
    ['private 172.16/12', '172.20.0.1'],
    ['private 192.168/16', '192.168.1.1'],
    ['link-local / cloud metadata', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 unique local', 'fd12:3456::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped private', '::ffff:10.0.0.1'],
    ['NAT64 of a private address', '64:ff9b::a00:1'],
    ['not an IP at all', 'localhost'],
  ])('blocks %s (%s)', (_case, ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

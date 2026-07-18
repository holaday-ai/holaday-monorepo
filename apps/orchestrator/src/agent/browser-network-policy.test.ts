import { describe, expect, it, vi } from 'vitest';
import {
  BrowserNetworkPolicy,
  isPublicInternetAddress,
} from './browser-network-policy.js';

describe('isPublicInternetAddress', () => {
  it('accepts globally routable IPv4 and IPv6 addresses', () => {
    expect(isPublicInternetAddress('8.8.8.8')).toBe(true);
    expect(isPublicInternetAddress('1.1.1.1')).toBe(true);
    expect(isPublicInternetAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects loopback, private, link-local, documentation, and metadata ranges', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '192.0.2.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
    ]) {
      expect(isPublicInternetAddress(address), address).toBe(false);
    }
  });
});

describe('BrowserNetworkPolicy', () => {
  it('rejects literal local and metadata targets without resolving DNS', async () => {
    const resolve = vi.fn(async () => [{ address: '8.8.8.8', family: 4 as const }]);
    const policy = new BrowserNetworkPolicy({ resolve });

    await expect(policy.check('http://127.0.0.1:3001/healthz')).resolves.toMatchObject({
      allowed: false,
      reason: 'private_network',
    });
    await expect(policy.check('http://metadata.google.internal/')).resolves.toMatchObject({
      allowed: false,
      reason: 'private_network',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects public-looking hostnames when DNS returns any private address', async () => {
    const policy = new BrowserNetworkPolicy({
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ],
    });

    await expect(policy.check('https://public-looking.example/path')).resolves.toMatchObject({
      allowed: false,
      reason: 'private_network',
    });
  });

  it('allows a hostname only when every resolved address is public', async () => {
    const policy = new BrowserNetworkPolicy({
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ],
    });

    await expect(policy.check('https://example.com/path')).resolves.toEqual({
      allowed: true,
      url: 'https://example.com/path',
      addresses: ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
    });
  });

  it('fails closed when DNS cannot be verified', async () => {
    const policy = new BrowserNetworkPolicy({
      resolve: async () => {
        throw new Error('resolver unavailable');
      },
    });

    await expect(policy.check('https://example.com/')).resolves.toMatchObject({
      allowed: false,
      reason: 'dns_unverified',
    });
  });

  it('deduplicates concurrent lookups but revalidates after the short cache window', async () => {
    let now = 10_000;
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
    const policy = new BrowserNetworkPolicy({ resolve, now: () => now, cacheTtlMs: 1_000 });

    await Promise.all([
      policy.check('https://example.com/a'),
      policy.check('https://example.com/b'),
    ]);
    expect(resolve).toHaveBeenCalledTimes(1);

    now += 1_001;
    await policy.check('https://example.com/c');
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

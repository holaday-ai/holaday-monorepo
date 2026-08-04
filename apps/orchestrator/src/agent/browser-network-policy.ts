import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type BrowserNetworkDecision =
  | {
      allowed: true;
      url: string;
      addresses: string[];
    }
  | {
      allowed: false;
      reason: 'invalid_url' | 'bad_scheme' | 'private_network' | 'dns_unverified';
      message: string;
    };

type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

interface BrowserNetworkPolicyOptions {
  resolve?: HostResolver;
  now?: () => number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

interface CachedResolution {
  expiresAt: number;
  value: Promise<readonly ResolvedAddress[]>;
}

const PRIVATE_NETWORK_MESSAGE =
  '为保护账户与服务器安全，不能访问本机、内网或云服务元数据地址。';
const DNS_UNVERIFIED_MESSAGE = '目标网址暂时无法安全解析，请稍后重试。';

/**
 * URL policy shared by every server-controlled browser navigation.
 *
 * A hostname is allowed only when all addresses returned by the trusted
 * resolver are globally routable. Rejecting mixed public/private answers is
 * deliberate: accepting the public member would leave a DNS-rebinding path.
 */
export class BrowserNetworkPolicy {
  private readonly resolve: HostResolver;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly cache = new Map<string, CachedResolution>();

  constructor(options: BrowserNetworkPolicyOptions = {}) {
    this.resolve = options.resolve ?? defaultResolver;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? 512);
  }

  async check(rawUrl: string): Promise<BrowserNetworkDecision> {
    const staticDecision = checkStaticBrowserUrl(rawUrl);
    if (!staticDecision.allowed) return staticDecision;

    const { url, host } = staticDecision;

    const literalFamily = isIP(host);
    if (literalFamily !== 0) {
      return isPublicInternetAddress(host)
        ? { allowed: true, url: url.href, addresses: [host] }
        : {
            allowed: false,
            reason: 'private_network',
            message: PRIVATE_NETWORK_MESSAGE,
          };
    }

    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await this.resolveCached(host);
    } catch {
      return {
        allowed: false,
        reason: 'dns_unverified',
        message: DNS_UNVERIFIED_MESSAGE,
      };
    }

    if (addresses.length === 0) {
      return {
        allowed: false,
        reason: 'dns_unverified',
        message: DNS_UNVERIFIED_MESSAGE,
      };
    }

    if (addresses.some(({ address }) => !isPublicInternetAddress(address))) {
      return {
        allowed: false,
        reason: 'private_network',
        message: PRIVATE_NETWORK_MESSAGE,
      };
    }

    return {
      allowed: true,
      url: url.href,
      addresses: [...new Set(addresses.map(({ address }) => address))],
    };
  }

  private resolveCached(hostname: string): Promise<readonly ResolvedAddress[]> {
    const now = this.now();
    const existing = this.cache.get(hostname);
    if (existing && existing.expiresAt > now) return existing.value;
    if (existing) this.cache.delete(hostname);

    for (const [cachedHostname, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(cachedHostname);
    }
    while (this.cache.size >= this.maxCacheEntries) {
      const oldestHostname = this.cache.keys().next().value as string | undefined;
      if (!oldestHostname) break;
      this.cache.delete(oldestHostname);
    }

    const value = this.resolve(hostname);
    this.cache.set(hostname, {
      expiresAt: now + this.cacheTtlMs,
      value,
    });
    return value;
  }
}

export const defaultBrowserNetworkPolicy = new BrowserNetworkPolicy();

export function staticBrowserUrlSafetyMessage(rawUrl: string): string | null {
  const decision = checkStaticBrowserUrl(rawUrl);
  return decision.allowed ? null : decision.message;
}

export function isPublicInternetAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isBlockedHostname(hostname: string): boolean {
  if (!hostname || !hostname.includes('.')) return true;
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata' ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home')
  );
}

function checkStaticBrowserUrl(rawUrl: string):
  | { allowed: true; url: URL; host: string }
  | Extract<BrowserNetworkDecision, { allowed: false }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      allowed: false,
      reason: 'invalid_url',
      message: '网址格式无效，请检查后重试。',
    };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      allowed: false,
      reason: 'bad_scheme',
      message: '只能访问 http 或 https 网页。',
    };
  }

  const host = normalizeHostname(url.hostname);
  if (isBlockedHostname(host) || (isIP(host) !== 0 && !isPublicInternetAddress(host))) {
    return {
      allowed: false,
      reason: 'private_network',
      message: PRIVATE_NETWORK_MESSAGE,
    };
  }
  return { allowed: true, url, host };
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [a = -1, b = -1, c = -1] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0] ?? '';
  // IPv4-compatible and IPv4-mapped forms are rejected conservatively. The
  // equivalent plain IPv4 address remains available for legitimate targets.
  if (normalized.includes('.')) return false;

  const words = expandIpv6(normalized);
  if (!words) return false;
  const [a = 0, b = 0, c = 0, d = 0] = words;
  const allZero = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;

  return !(
    allZero ||
    loopback ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('::') ||
    (a & 0xfe00) === 0xfc00 ||
    (a & 0xffc0) === 0xfec0 ||
    (a & 0xffc0) === 0xfe80 ||
    (a & 0xff00) === 0xff00 ||
    (a === 0x0100 && b === 0 && c === 0 && d === 0) ||
    (a === 0x0064 && b === 0xff9b && (c === 0 || c === 0x0001)) ||
    (a === 0x2001 && b === 0) ||
    (a === 0x2001 && b === 0x0002) ||
    (a === 0x2001 && b >= 0x0010 && b <= 0x001f) ||
    (a === 0x2001 && b === 0x0db8) ||
    a === 0x2002 ||
    (a & 0xfff0) === 0x3ff0
  );
}

function expandIpv6(address: string): number[] | null {
  if (!address || address.split('::').length > 2) return null;
  const [leftRaw = '', rightRaw = ''] = address.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((address.includes('::') && missing < 1) || (!address.includes('::') && missing !== 0)) {
    return null;
  }

  const parts = address.includes('::')
    ? [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return null;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

async function defaultResolver(hostname: string): Promise<readonly ResolvedAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses
    .filter((entry): entry is { address: string; family: 4 | 6 } =>
      entry.family === 4 || entry.family === 6,
    )
    .map(({ address, family }) => ({ address, family }))
    // The current production and local runners have reliable IPv4 egress,
    // while some hosts advertise IPv6 that is not routable from the box.
    // Prefer IPv4 but retain IPv6-only targets as a valid fallback.
    .sort((left, right) => left.family - right.family);
}

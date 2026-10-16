import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { browserProxyUpstreams, proxiedDomain } from '../agent/browser-tools/domain-egress.js';

/**
 * OPEN-ANY-SITE-1 — sites seen blocking the datacenter egress (a verification
 * wall on the main document, or a 403/429 for the page itself). A learned site
 * goes through the user's fixed mobile/ISP endpoint from the NEXT browser launch:
 * a browser already running keeps the routing it started with, so a wall is
 * never retried from a new IP on the spot.
 */
export const LEARNED_ENV = 'BROWSER_DOMAIN_PROXY_LEARNED_FILE';
export const LEARNED_TTL_MS = 30 * 86_400_000;
const MAX_SITES = 500;
/** Second-level registries where the site is the third label from the right. */
const TWO_LEVEL = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'co.jp',
  'ne.jp',
  'com.br',
  'co.in',
  'com.cn',
  'com.hk',
  'co.kr',
  'com.tw',
  'com.sg',
  'com.mx',
  'co.nz',
  'com.tr',
]);

/** The registrable site of a host (`www.reddit.com` → `reddit.com`), or null for IPs and local names. */
export function siteOf(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isIP(host) || !host.includes('.')) return null;
  if (/(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/.test(host)) return null;
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  return labels.slice(TWO_LEVEL.has(lastTwo) && labels.length > 2 ? -3 : -2).join('.');
}

interface Entry {
  reason: string;
  firstAt: number;
  lastAt: number;
  count: number;
}

export class EgressLearning {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly options: { file: string; now?: () => number }) {
    try {
      const raw = JSON.parse(readFileSync(options.file, 'utf8')) as Record<string, Entry>;
      for (const [site, entry] of Object.entries(raw))
        if (siteOf(site) === site && typeof entry?.lastAt === 'number')
          this.entries.set(site, entry);
    } catch {
      /* no file yet, or unreadable: start empty */
    }
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  /** Sites learned within the TTL, most recent first. */
  sites(): string[] {
    const cutoff = this.now() - LEARNED_TTL_MS;
    return [...this.entries]
      .filter(([, entry]) => entry.lastAt > cutoff)
      .sort((a, b) => b[1].lastAt - a[1].lastAt)
      .map(([site]) => site);
  }
  /** Records that `hostname` blocked the datacenter egress. True when the site is new. */
  record(hostname: string, reason: string): boolean {
    const site = siteOf(hostname);
    if (!site) return false;
    const now = this.now();
    const known = this.entries.get(site);
    this.entries.set(site, {
      reason,
      firstAt: known?.firstAt ?? now,
      lastAt: now,
      count: (known?.count ?? 0) + 1,
    });
    for (const [old] of [...this.entries].sort((a, b) => a[1].lastAt - b[1].lastAt)) {
      if (this.entries.size <= MAX_SITES) break;
      this.entries.delete(old);
    }
    try {
      mkdirSync(dirname(this.options.file), { recursive: true, mode: 0o700 });
      const temp = `${this.options.file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(Object.fromEntries(this.entries)), { mode: 0o600 });
      renameSync(temp, this.options.file);
    } catch {
      /* best effort: the in-memory list still applies to later launches */
    }
    return !known;
  }
}

let cached: { file: string; store: EgressLearning } | null = null;
/** The process-wide learned list (file from BROWSER_DOMAIN_PROXY_LEARNED_FILE). */
export function egressLearning(env: NodeJS.ProcessEnv = process.env): EgressLearning {
  const file = env[LEARNED_ENV] || join(process.cwd(), 'data', 'egress-learned.json');
  if (cached?.file !== file) cached = { file, store: new EgressLearning({ file }) };
  return cached.store;
}

/**
 * For a cloud browser task: records a site that refused the datacenter egress.
 * Null when browser-level proxying is off. A site already on the list (it went
 * through the endpoint, or a sign-in host of one) is not learned again.
 */
export function egressBlockLearner(
  env: NodeJS.ProcessEnv = process.env,
): ((url: string, reason: string) => void) | null {
  const upstreams = browserProxyUpstreams(env);
  if (!upstreams) return null;
  const store = egressLearning(env);
  return (url, reason) => {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    const site = siteOf(host);
    // A direct-only site (Google, YouTube) walls a proxy exit: never learn it.
    if (!site || proxiedDomain(site, upstreams.direct)) return;
    if (proxiedDomain(site, [...upstreams.domains, ...store.sites()])) return;
    store.record(host, reason);
  };
}

import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROXY_DOMAINS,
  domainEgressConfig,
  installDomainEgress,
  proxyPoolFromEnv,
  proxyPoolSlot,
} from './domain-egress.js';

/** CAPTCHA-REDUCE-1: a pool of fixed ISP IPs, one per user, Google search only. */
describe('proxy pool configuration', () => {
  const env = {
    BROWSER_DOMAIN_PROXY_ENABLED: 'true',
    BROWSER_DOMAIN_PROXY_POOL:
      'isp.example.test:10001,isp.example.test:10002,http://u2:p2@other.test:9',
    BROWSER_DOMAIN_PROXY_USERNAME: 'shared-user',
    BROWSER_DOMAIN_PROXY_PASSWORD: 'shared pass',
  };
  it('reads endpoints, fills shared credentials and defaults to Google search domains', () => {
    const pool = proxyPoolFromEnv(env).map((entry) => new URL(entry));
    expect(pool.map((u) => `${u.hostname}:${u.port}`)).toEqual([
      'isp.example.test:10001',
      'isp.example.test:10002',
      'other.test:9',
    ]);
    expect(decodeURIComponent(pool[0]!.username)).toBe('shared-user');
    expect(decodeURIComponent(pool[0]!.password)).toBe('shared pass');
    // An endpoint with its own credentials keeps them.
    expect(pool[2]!.username).toBe('u2');
    const config = domainEgressConfig(env);
    expect(config.enabled).toBe(true);
    expect(config.domains).toEqual(DEFAULT_PROXY_DOMAINS);
    expect(config.pool).toHaveLength(3);
  });
  it('keeps an explicit domain list and needs no pool for the single-URL mode', () => {
    expect(
      domainEgressConfig({ ...env, BROWSER_DOMAIN_PROXY_DOMAINS: 'example.test' }).domains,
    ).toEqual(['example.test']);
    expect(
      domainEgressConfig({ BROWSER_DOMAIN_PROXY_URL: 'http://x.test:1' }).pool,
    ).toBeUndefined();
  });
  it('maps a user to the same slot every time and spreads users over the pool', () => {
    expect(proxyPoolSlot('usr_a', 3)).toBe(proxyPoolSlot('usr_a', 3));
    const used = new Set(Array.from({ length: 30 }, (_, i) => proxyPoolSlot(`usr_${i}`, 3)));
    expect(used.size).toBe(3);
  });
});

describe('proxy pool on real Chromium (local stub proxies)', () => {
  let browser: Browser;
  const proxies: Server[] = [];
  const hits: Array<Array<{ host: string; auth: string }>> = [[], [], []];
  let pool: string[] = [];
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    for (let n = 0; n < 3; n++) {
      const server = createServer((req, res) => {
        const target = new URL(req.url ?? '/', 'http://unknown');
        const auth = String(req.headers['proxy-authorization'] ?? '');
        hits[n]!.push({ host: target.hostname, auth });
        res.setHeader('content-type', 'text/html');
        res.end(`<h1>via proxy ${n}</h1>`);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      proxies.push(server);
    }
    pool = proxies.map(
      (server) => `http://isp-user:isp-pass@127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
  });
  afterAll(async () => {
    await browser?.close();
    for (const server of proxies) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  const policy = {
    check: async (url: string) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
  };
  const run = async (user: string, urls: string[]) => {
    const page = await browser.newPage();
    const egress = await installDomainEgress(
      page,
      { enabled: true, domains: ['example.test'], proxyUrl: '', pool },
      policy,
      undefined,
      undefined,
      `${user}:task`,
      user,
    );
    const texts: string[] = [];
    for (const url of urls) {
      await page.goto(url, { timeout: 5000 }).catch(() => null);
      texts.push(
        await page
          .locator('h1')
          .innerText({ timeout: 500 })
          .catch(() => ''),
      );
    }
    await egress.dispose();
    await page.close();
    return texts;
  };
  it('sends a user through their own fixed IP on every task, with credentials', async () => {
    const users = ['usr_one', 'usr_two', 'usr_three', 'usr_four', 'usr_five'];
    for (const user of users) {
      const slot = proxyPoolSlot(user, 3);
      const before = hits[slot]!.length;
      expect(await run(user, ['http://www.example.test/search?q=x'])).toEqual([
        `via proxy ${slot}`,
      ]);
      expect(await run(user, ['http://www.example.test/again'])).toEqual([`via proxy ${slot}`]);
      expect(hits[slot]!.length - before).toBeGreaterThanOrEqual(2);
      const auth = hits[slot]!.at(-1)!.auth.replace(/^Basic /, '');
      expect(Buffer.from(auth, 'base64').toString()).toBe('isp-user:isp-pass');
    }
  });
  it('never proxies sign-in hosts or domains outside the list', async () => {
    const total = () => hits.reduce((n, h) => n + h.length, 0);
    const before = total();
    const texts = await run('usr_one', [
      'http://accounts.example.test/signin',
      'http://login.example.test/',
      'http://unlisted.test/',
    ]);
    expect(texts.every((t) => !t.startsWith('via proxy'))).toBe(true);
    expect(total()).toBe(before);
  });
});

describe('service worker guard (PROXY-TRIAL-1 finding)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  const withWorkers = async (urls: string[]) => {
    const page = await browser.newPage();
    const context = page.context();
    (context as unknown as { serviceWorkers: () => unknown[] }).serviceWorkers = () =>
      urls.map((url) => ({ url: () => url }));
    try {
      const egress = await installDomainEgress(
        page,
        { enabled: true, domains: ['example.test'], proxyUrl: 'http://127.0.0.1:9' },
        { check: async (url) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }) },
      );
      await egress.dispose();
      return 'installed';
    } catch (error) {
      return (error as Error).message;
    } finally {
      await page.close();
    }
  };
  it("ignores the browser's own extension workers (Chrome starts one)", async () => {
    expect(
      await withWorkers(['chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/thunk.js']),
    ).toBe('installed');
  });
  it('still refuses a web origin service worker that could bypass the route', async () => {
    expect(await withWorkers(['https://site.test/sw.js'])).toBe(
      'domain_proxy_service_worker_active',
    );
  });
});

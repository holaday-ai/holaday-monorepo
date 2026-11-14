import { createServer } from 'node:http';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestKeyProvider } from './crypto.js';
import { MemoryVaultStore, SessionVault } from './vault.js';
import { VaultBrowserWorker } from './worker.js';
let browser: Browser;
let origin: string;
let writes = 0;
const server = createServer((req, res) => {
  if (req.method !== 'GET') {
    writes++;
    res.end('write');
    return;
  }
  if (req.url === '/account-check') {
    res.setHeader('Content-Type', 'text/html');
    if (req.headers.cookie?.includes('sid=SYNTHETIC_ONLY'))
      res.end('<div data-session-ready>account</div>');
    else {
      res.statusCode = 401;
      res.end('login required');
    }
  } else if (req.url === '/challenge') {
    res.statusCode = 403;
    res.end('verification required');
  } else res.end("<button onclick=\"fetch('/write', {method:'POST'})\">Write</button>");
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});
describe('synthetic vault browser workflow', () => {
  it('imports, validates actual login, forks isolated context, blocks writes, saves after close, revokes', async () => {
    let now = Date.now();
    const vault = new SessionVault({
      now: () => now,
      store: new MemoryVaultStore(),
      keys: new TestKeyProvider(),
      importEnabled: true,
      profileEnabled: true,
    });
    const worker = new VaultBrowserWorker(vault, {
      context: (options) => browser.newContext(options),
      networkPolicy: {
        check: async (url) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
      },
      probes: new Map([[origin, { path: '/account-check', selector: '[data-session-ready]' }]]),
    });
    const grant = await vault.grant('alice', {
      origin,
      purposes: ['read', 'session-import', 'profile-persist'],
      storageKeys: [],
    });
    const state = {
      cookies: [
        {
          name: 'sid',
          value: 'SYNTHETIC_ONLY',
          domain: '127.0.0.1',
          path: '/',
          secure: false,
          httpOnly: true,
          hostOnly: true,
          session: true,
          sameSite: 'lax' as const,
        },
      ],
      storage: [],
    };
    expect(
      (await vault.import('alice', grant.id, state, (s, g) => worker.verify('alice', s, g))).status,
    ).toBe('connected');
    const task = await worker.open('alice', grant.id);
    await task.page.goto(origin);
    await task.page.getByRole('button', { name: 'Write' }).click();
    await task.page.waitForTimeout(50);
    expect(writes).toBe(0);
    const other = await browser.newContext();
    expect(await other.cookies(origin)).toHaveLength(0);
    await other.close();
    await task.close();
    const next = await worker.open('alice', grant.id);
    await next.page.goto(`${origin}/account-check`);
    expect(await next.page.locator('[data-session-ready]').count()).toBe(1);
    await vault.revoke('alice', grant.id);
    expect(next.page.isClosed()).toBe(true);
    await expect(worker.open('alice', grant.id)).rejects.toThrow('grant_unavailable');
    const expiring = await vault.grant('alice', {
      origin,
      purposes: ['read', 'session-import'],
      storageKeys: [],
    });
    await vault.import('alice', expiring.id, state, (s, g) => worker.verify('alice', s, g));
    const active = await worker.open('alice', expiring.id);
    now += 7 * 86400000 + 1;
    expect((await vault.list('alice')).find((g) => g.id === expiring.id)?.status).toBe('expired');
    expect(active.page.isClosed()).toBe(true);
    await expect(worker.open('alice', expiring.id)).rejects.toThrow('grant_unavailable');
  });
  it('does not call an unsupported site logged in and parks on a challenge', async () => {
    const vault = new SessionVault({
      store: new MemoryVaultStore(),
      keys: new TestKeyProvider(),
      importEnabled: true,
      profileEnabled: true,
    });
    const grant = await vault.grant('alice', {
      origin,
      purposes: ['read', 'session-import'],
      storageKeys: [],
    });
    const empty = { cookies: [], storage: [] };
    const unsupported = new VaultBrowserWorker(vault, {
      context: (options) => browser.newContext(options),
      networkPolicy: {
        check: async (url) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
      },
      probes: new Map(),
    });
    expect(await unsupported.verify('alice', empty, grant)).toBe('relogin');
    const challenge = new VaultBrowserWorker(vault, {
      context: (options) => browser.newContext(options),
      networkPolicy: {
        check: async (url) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
      },
      probes: new Map([[origin, { path: '/challenge', selector: '[data-session-ready]' }]]),
    });
    const challenged = await vault.import(
      'alice',
      grant.id,
      {
        cookies: [
          {
            name: 'sid',
            value: 'SYNTHETIC_ONLY',
            domain: '127.0.0.1',
            path: '/',
            secure: false,
            httpOnly: true,
            hostOnly: true,
            session: true,
            sameSite: 'lax',
          },
        ],
        storage: [],
      },
      (s, g) => challenge.verify('alice', s, g),
    );
    expect(challenged.status).toBe('risk_blocked');
  });
});

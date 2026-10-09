/** FIX-PR252 regressions: write-back volume, read-only forks, targeted grants, cookie scope. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cookieDomainInScope, cookieScopeForOrigin } from './cookie-scope.js';
import { TestKeyProvider } from './crypto.js';
import { createVaultRuntime } from './runtime.js';
import {
  MAX_ACTIVE_GRANTS,
  MemoryVaultStore,
  SessionVault,
  type VaultDocument,
  type VaultStore,
  nextExpiryAt,
} from './vault.js';
import { VaultBrowserWorker } from './worker.js';

/** Counts writes (locked update transactions) and lock-free reads separately. */
function countingStore() {
  const inner = new MemoryVaultStore();
  const counts = { writes: 0, reads: 0 };
  const store: VaultStore & { inner: MemoryVaultStore } = {
    inner,
    update<T>(userId: string, change: (doc: VaultDocument) => Promise<T>) {
      counts.writes++;
      return inner.update(userId, change);
    },
    read<T>(userId: string, view: (doc: VaultDocument) => T | Promise<T>) {
      counts.reads++;
      return inner.read(userId, view);
    },
  };
  return { store, counts };
}
const cookie = (domain: string, name = 'sid', value = 'SYNTHETIC_ONLY') => ({
  name,
  value,
  domain,
  path: '/',
  secure: false,
  httpOnly: true,
  hostOnly: !domain.startsWith('.'),
  session: true,
  sameSite: 'lax' as const,
});

describe('cookie scope: registrable domain + reviewed related login domains', () => {
  it('uses the public suffix list, keeps private suffixes as boundaries, excludes payment', () => {
    expect(cookieScopeForOrigin('https://www.jd.com')).toEqual(['jd.com']);
    expect(cookieScopeForOrigin('https://login.taobao.com')).toEqual(['taobao.com', 'tmall.com']);
    expect(cookieScopeForOrigin('https://shop.example.co.uk')).toEqual(['example.co.uk']);
    expect(cookieScopeForOrigin('https://alice.github.io')).toEqual(['alice.github.io']);
    expect(() => cookieScopeForOrigin('https://www.alipay.com')).toThrow('scope_denied');
    const jd = ['jd.com'];
    expect(cookieDomainInScope('.jd.com', jd)).toBe(true);
    expect(cookieDomainInScope('passport.jd.com', jd)).toBe(true);
    for (const outside of ['evil-jd.com', '.jd.com.evil.net', 'com', '.com', 'alipay.com'])
      expect(cookieDomainInScope(outside, jd)).toBe(false);
    expect(cookieDomainInScope('.alipay.com', ['taobao.com', 'tmall.com'])).toBe(false);
    expect(cookieDomainInScope('bob.github.io', ['alice.github.io'])).toBe(false);
  });
  it('imports a .jd.com parent-domain cookie for www.jd.com and refuses look-alikes', async () => {
    const vault = new SessionVault({
      store: new MemoryVaultStore(),
      keys: new TestKeyProvider(),
      importEnabled: true,
      profileEnabled: false,
    });
    const grant = await vault.grant('alice', {
      origin: 'https://www.jd.com',
      purposes: ['read', 'session-import'],
      storageKeys: [],
    });
    expect(grant.cookieDomains).toEqual(['jd.com']);
    const secure = (domain: string) => ({ ...cookie(domain), secure: true });
    for (const bad of ['.evil-jd.com', '.jd.com.evil.net', '.alipay.com']) {
      const g = await vault.grant('alice', {
        origin: 'https://www.jd.com',
        purposes: ['read', 'session-import'],
        storageKeys: [],
      });
      await expect(
        vault.import(
          'alice',
          g.id,
          { cookies: [secure(bad)], storage: [] },
          async () => 'connected',
        ),
      ).rejects.toThrow('scope_denied');
    }
    const imported = await vault.import(
      'alice',
      grant.id,
      { cookies: [secure('.jd.com'), secure('passport.jd.com')], storage: [] },
      async () => 'connected',
    );
    expect(imported).toMatchObject({ status: 'connected', cookieCount: 2 });
  });
});

describe('grant cap and expiry index (P3)', () => {
  it('counts only active grants and prunes old inactive history', async () => {
    const store = new MemoryVaultStore();
    const vault = new SessionVault({
      store,
      keys: new TestKeyProvider(),
      importEnabled: true,
      profileEnabled: false,
    });
    const request = {
      origin: 'https://www.jd.com',
      purposes: ['read', 'session-import'] as const,
      storageKeys: [],
    };
    for (let i = 0; i < MAX_ACTIVE_GRANTS; i++) {
      const g = await vault.grant('alice', request);
      await vault.revoke('alice', g.id);
    }
    await expect(vault.grant('alice', request)).resolves.toMatchObject({
      status: 'awaiting_import',
    });
    expect((await store.dump('alice')).grants.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < MAX_ACTIVE_GRANTS; i++) await vault.grant('alice', request);
    await expect(vault.grant('alice', request)).rejects.toThrow('grant_limit');
    const doc = await store.dump('alice');
    expect(nextExpiryAt(doc)).toBe(
      Math.min(...doc.grants.filter((g) => g.status !== 'revoked').map((g) => g.expiresAt)),
    );
  });
  it('0067 indexes next expiry; 0068 deletes only the legacy cookie queue and is repeatable', async () => {
    const m67 = await readFile(
      new URL('../../drizzle/0067_browser_session_vault.sql', import.meta.url),
      'utf8',
    );
    expect(m67).toMatch(/next_expiry_at BIGINT UNSIGNED NULL/);
    expect(m67).toMatch(/KEY idx_browser_session_vault_next_expiry \(next_expiry_at\)/);
    const m68 = await readFile(
      new URL('../../drizzle/0068_purge_legacy_cookie_queue.sql', import.meta.url),
      'utf8',
    );
    const statements = m68
      .split('\n')
      .filter((l) => !l.trim().startsWith('--') && l.trim())
      .join(' ')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(['DELETE FROM pending_cookies']);
  });
});

describe('vault browser worker (real Chromium)', () => {
  let browser: Browser;
  let origin: string;
  let second: string;
  const secondServer = createServer((_req, res) => res.end('second'));
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/account-check') {
      if (req.headers.cookie?.includes('sid=SYNTHETIC_ONLY')) res.end('<div data-ok>account</div>');
      else {
        res.statusCode = 401;
        res.end('login');
      }
      return;
    }
    if (req.url === '/rotate') {
      res.setHeader('Set-Cookie', `sid=SYNTHETIC_ROTATED_${Date.now()}; Path=/; HttpOnly`);
      res.end('rotated');
      return;
    }
    if (req.url === '/many') {
      res.end(Array.from({ length: 30 }, (_, i) => `<img src="/img${i}.png">`).join(''));
      return;
    }
    res.end('ok');
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await new Promise<void>((r) => secondServer.listen(0, '127.0.0.1', r));
    second = `http://127.0.0.1:${(secondServer.address() as AddressInfo).port}`;
    browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => secondServer.close(() => r()));
  });
  async function connected(
    profile = true,
    options: { statusPollMs?: number; checkpointMs?: number } = {},
  ) {
    const { store, counts } = countingStore();
    const vault = new SessionVault({
      store,
      keys: new TestKeyProvider(),
      importEnabled: true,
      profileEnabled: profile,
    });
    const writeBacks: string[] = [];
    const discards: string[] = [];
    const worker = new VaultBrowserWorker(vault, {
      context: (o) => browser.newContext(o),
      networkPolicy: {
        check: async (url) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
      },
      probes: new Map([[origin, { path: '/account-check', selector: '[data-ok]' }]]),
      onWriteBack: (reason) => writeBacks.push(reason),
      onDiscard: (reason) => discards.push(reason),
      ...options,
    });
    const grant = await vault.grant('alice', {
      origin,
      purposes: profile
        ? ['read', 'session-import', 'profile-persist']
        : ['read', 'session-import'],
      storageKeys: [],
    });
    await vault.import('alice', grant.id, { cookies: [cookie('127.0.0.1')], storage: [] }, (s, g) =>
      worker.verify('alice', s, g),
    );
    return { vault, store, counts, worker, grant, writeBacks, discards };
  }

  it('a 30-image page and an idle period cause no per-request or idle writes', async () => {
    const f = await connected();
    const task = await f.worker.open('alice', f.grant.id);
    try {
      const before = f.counts.writes;
      await task.page.goto(`${origin}/many`);
      await task.page.waitForLoadState('networkidle').catch(() => undefined);
      const pageWrites = f.counts.writes - before;
      await new Promise((r) => setTimeout(r, 1500));
      const idleWrites = f.counts.writes - before - pageWrites;
      expect(pageWrites).toBeLessThan(10);
      expect(pageWrites).toBe(0);
      expect(idleWrites).toBe(0);
    } finally {
      await task.close();
    }
  });

  it('writes back changed state at most once per checkpoint, not when unchanged; site change flushes', async () => {
    const f = await connected(true, { checkpointMs: 300 });
    const task = await f.worker.open('alice', f.grant.id);
    try {
      await task.page.goto(`${origin}/`);
      await new Promise((r) => setTimeout(r, 900));
      expect(f.writeBacks).toEqual([]);
      await task.page.goto(`${origin}/rotate`);
      await new Promise((r) => setTimeout(r, 900));
      expect(f.writeBacks).toEqual(['interval']);
      await new Promise((r) => setTimeout(r, 700));
      expect(f.writeBacks).toEqual(['interval']);
      // Leaving the current site (another in-scope origin) writes back immediately.
      await task.page.goto(`${origin}/rotate`);
      await task.page.goto(`${second}/`);
      await new Promise((r) => setTimeout(r, 150));
      expect(f.writeBacks).toContain('site_change');
    } finally {
      await task.close();
    }
  });

  it('a second task of the same user opens a read-only fork; its changes are discarded with a reason', async () => {
    const f = await connected();
    const first = await f.worker.open('alice', f.grant.id);
    const second = await f.worker.open('alice', f.grant.id);
    try {
      expect(first.mode).toBe('writer');
      expect(second.mode).toBe('readonly');
      await second.page.goto(`${origin}/rotate`);
      const saved = JSON.stringify(await f.store.inner.dump('alice'));
      await second.close();
      expect(f.discards).toEqual(['writer_busy']);
      expect(JSON.stringify(await f.store.inner.dump('alice'))).toBe(saved);
    } finally {
      await first.close();
    }
    // A session-only grant never takes a lease: two tasks are two read-only forks.
    const s = await connected(false);
    const a = await s.worker.open('alice', s.grant.id);
    const b = await s.worker.open('alice', s.grant.id);
    expect([a.mode, b.mode]).toEqual(['readonly', 'readonly']);
    await a.close();
    await b.close();
    expect(s.discards).toEqual(['session_only', 'session_only']);
  });

  it('revocation from another process stops the context within the status poll', async () => {
    const f = await connected(true, { statusPollMs: 200 });
    const task = await f.worker.open('alice', f.grant.id);
    // A second vault instance on the same store = another process (no in-memory tracker).
    const other = new SessionVault({
      store: f.store,
      keys: new TestKeyProvider(),
      importEnabled: true,
      profileEnabled: true,
    });
    await other.revoke('alice', f.grant.id);
    await new Promise((r) => setTimeout(r, 600));
    expect(task.page.isClosed()).toBe(true);
    await expect(task.close()).resolves.toBeUndefined();
    await expect(f.worker.open('alice', f.grant.id)).rejects.toThrow('grant_unavailable');
  });

  it('only a task targeting the granted site gets the vault context; others are untouched', async () => {
    const { store } = countingStore();
    const runtime = createVaultRuntime({
      importEnabled: true,
      profileEnabled: true,
      keys: new TestKeyProvider(),
      store,
      context: (o) => browser.newContext(o),
      probes: new Map([[origin, { path: '/account-check', selector: '[data-ok]' }]]),
    });
    if (!runtime) throw new Error('runtime missing');
    const grant = await runtime.vault.grant('alice', {
      origin,
      purposes: ['read', 'session-import'],
      storageKeys: [],
    });
    await runtime.vault.import(
      'alice',
      grant.id,
      { cookies: [cookie('127.0.0.1')], storage: [] },
      async () => 'connected',
    );
    const executor = () => ({ createSessionVaultContext: vi.fn((o) => browser.newContext(o)) });
    for (const target of [undefined, null, 'https://www.ctrip.com/hotels', 'http://localhost/']) {
      const e = executor();
      await runtime.prepare('alice', e as never, { targetUrl: target });
      expect(e.createSessionVaultContext).not.toHaveBeenCalled();
    }
    const e1 = executor();
    const e2 = executor();
    await runtime.prepare('alice', e1 as never, { targetUrl: `${origin}/orders` });
    await runtime.prepare('alice', e2 as never, { targetUrl: `${origin}/cart` });
    expect(e1.createSessionVaultContext).toHaveBeenCalledTimes(1);
    expect(e2.createSessionVaultContext).toHaveBeenCalledTimes(1);
    await runtime.finish(e1 as never);
    await runtime.finish(e2 as never);
  });
});

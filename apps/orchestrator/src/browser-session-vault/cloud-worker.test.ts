import { createServer } from 'node:http';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { TestKeyProvider } from './crypto.js';
import { LEASE_TTL, MemoryVaultStore, SessionVault } from './vault.js';
import { VaultBrowserWorker } from './worker.js';

let browser: Browser;
let origin: string;
let writes = 0;
let messages = 0;
let outsideOrigin: string;
let outsideWrites = 0;
const outsideServer = createServer((req, res) => {
  if (req.method === 'POST') outsideWrites++;
  res.setHeader('content-type', 'application/javascript');
  res.end('window.fixtureAssetLoaded = true');
});
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/write' && req.method === 'POST') {
    if (!req.headers.cookie?.includes('sid=SYNTHETIC_CLOUD_OWNER')) {
      res.statusCode = 401;
      res.end('missing identity');
      return;
    }
    writes++;
    res.end('saved');
  } else res.end('<main id="actual-page">Cloud workspace fixture</main>');
});
const wsServer = new WebSocketServer({ server });
wsServer.on('connection', (ws, req) => {
  if (!req.headers.cookie?.includes('sid=SYNTHETIC_CLOUD_OWNER')) {
    ws.close();
    return;
  }
  ws.on('message', (data) => {
    messages++;
    ws.send(`received:${data}`);
  });
});
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await new Promise<void>((resolve, reject) => {
    outsideServer.once('error', reject);
    outsideServer.listen(0, '127.0.0.1', resolve);
  });
  outsideOrigin = `http://localhost:${(outsideServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
  for (const ws of wsServer.clients) ws.terminate();
  await new Promise<void>((r) => wsServer.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => outsideServer.close(() => r()));
});
async function fixture() {
  let now = Date.now();
  const store = new MemoryVaultStore();
  const keys = new TestKeyProvider();
  const vault = new SessionVault({
    store,
    keys,
    now: () => now,
    importEnabled: true,
    profileEnabled: true,
    cloudHomeEnabled: true,
  });
  const grant = await vault.captureCloudProfile(
    'alice',
    {
      consent: 'cloud-browser-profile-v1',
      origin,
      storageKeys: ['account'],
    },
    async () => ({
      origin,
      state: {
        cookies: [
          {
            name: 'sid',
            value: 'SYNTHETIC_CLOUD_OWNER',
            domain: '127.0.0.1',
            path: '/',
            secure: false,
            httpOnly: true,
            hostOnly: true,
            sameSite: 'lax',
            session: true,
          },
        ],
        storage: [{ name: 'account', value: 'SYNTHETIC_ACCOUNT' }],
      },
    }),
  );
  const worker = new VaultBrowserWorker(vault, {
    context: (config) => browser.newContext(config),
    probes: new Map(),
    checkpointMs: 80,
    statusPollMs: 80,
    statusTimeoutMs: 200,
    maxUnverifiedMs: 500,
    networkPolicy: {
      check: async (url) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
    },
  });
  return {
    vault,
    worker,
    grant,
    store,
    keys,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
async function until(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(label);
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('real interactive cloud-profile context', () => {
  it('restores owned state, actually writes and exchanges WS messages, then closes on revoke', async () => {
    const f = await fixture();
    await expect(f.worker.open('alice', f.grant.id)).rejects.toThrow('scope_denied');
    const home = await f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' });
    try {
      await home.page.goto(origin);
      expect(await home.page.evaluate(() => localStorage.getItem('account'))).toBe(
        'SYNTHETIC_ACCOUNT',
      );
      const before = writes;
      const saved = await home.page.evaluate(async () => {
        try {
          return await (await fetch('/write', { method: 'POST' })).text();
        } catch {
          return 'blocked';
        }
      });
      expect(saved).toBe('saved');
      expect(writes).toBe(before + 1);
      const beforeMessages = messages;
      const result = await home.page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const socket = new WebSocket(location.origin.replace('http:', 'ws:'));
            const timer = setTimeout(() => {
              socket.close();
              resolve('timeout');
            }, 1000);
            socket.onopen = () => socket.send('SYNTHETIC_EDIT');
            socket.onmessage = (event) => {
              clearTimeout(timer);
              resolve(String(event.data));
              socket.close();
            };
            socket.onerror = () => {
              clearTimeout(timer);
              resolve('blocked');
            };
          }),
      );
      expect(result).toBe('received:SYNTHETIC_EDIT');
      expect(messages).toBe(beforeMessages + 1);
      const other = await browser.newContext();
      expect(await other.cookies(origin)).toEqual([]);
      await other.close();
      await f.vault.revoke('alice', f.grant.id);
      expect(home.page.isClosed()).toBe(true);
      await expect(
        f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' }),
      ).rejects.toThrow('grant_unavailable');
    } finally {
      await home.close(false);
    }
  });

  it('renews an unchanged active lease, checkpoints changed state, and restores the saved result', async () => {
    const f = await fixture();
    const home = await f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' });
    try {
      await home.page.goto(origin);
      const before = (await f.store.dump('alice')).grants[0]!.snapshot;
      f.advance(LEASE_TTL - 10);
      await until(
        async () =>
          ((await f.store.dump('alice')).grants[0]?.writer?.expiresAt ?? 0) > f.now() + 1000,
        'active home lease was not renewed',
      );
      expect((await f.store.dump('alice')).grants[0]!.snapshot).toEqual(before);
      f.advance(20);
      expect(await home.page.evaluate(async () => (await fetch('/')).ok)).toBe(true);
      await home.page.evaluate(() => localStorage.setItem('account', 'SYNTHETIC_UPDATED'));
      await until(
        async () => ((await f.store.dump('alice')).grants[0]?.snapshot?.version ?? 0) > 1,
        'changed state was not checkpointed',
      );
    } finally {
      await home.close();
    }
    const restored = await f.worker.open('alice', f.grant.id, undefined, {
      access: 'cloud-home-v1',
    });
    try {
      await restored.page.goto(origin);
      expect(await restored.page.evaluate(() => localStorage.getItem('account'))).toBe(
        'SYNTHETIC_UPDATED',
      );
    } finally {
      await restored.close();
    }
  });

  it('allows static public assets while refusing cross-site writes and navigation', async () => {
    const f = await fixture();
    const home = await f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' });
    try {
      await home.page.goto(origin);
      const before = outsideWrites;
      const result = await home.page.evaluate(async (outside) => {
        const loaded = await new Promise<boolean>((resolve) => {
          const script = document.createElement('script');
          script.src = `${outside}/asset.js`;
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.body.append(script);
        });
        let writeBlocked = false;
        try {
          await fetch(`${outside}/write`, { method: 'POST', mode: 'no-cors' });
        } catch {
          writeBlocked = true;
        }
        return { loaded, writeBlocked };
      }, outsideOrigin);
      expect(result).toEqual({ loaded: true, writeBlocked: true });
      expect(outsideWrites).toBe(before);
      await expect(home.page.goto(outsideOrigin)).rejects.toThrow();
    } finally {
      await home.close(false);
    }
  });

  it('stops an actual context after a separate vault runtime revokes its profile', async () => {
    const f = await fixture();
    const home = await f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' });
    try {
      await home.page.goto(origin);
      const external = new SessionVault({
        store: f.store,
        keys: f.keys,
        importEnabled: false,
        profileEnabled: false,
        cloudHomeEnabled: true,
      });
      await external.revoke('alice', f.grant.id);
      await until(
        async () => home.page.isClosed(),
        'cross-runtime revoke did not close the real browser context',
      );
      await expect(
        f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' }),
      ).rejects.toThrow('grant_unavailable');
    } finally {
      await home.close(false);
    }
  });

  it('never relays a queued WebSocket edit after liveness can no longer be confirmed', async () => {
    const f = await fixture();
    const home = await f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' });
    try {
      await home.page.goto(origin);
      const started = await home.page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const socket = new WebSocket(location.origin.replace('http:', 'ws:'));
            Object.assign(window, { fixtureSocket: socket });
            const timer = setTimeout(() => resolve(false), 1000);
            socket.onopen = () => {
              socket.send('SYNTHETIC_FIRST_EDIT');
            };
            socket.onmessage = () => {
              clearTimeout(timer);
              resolve(true);
            };
          }),
      );
      expect(started).toBe(true);
      const before = messages;
      const status = f.vault.status.bind(f.vault);
      f.vault.status = () => new Promise(() => {});
      try {
        await new Promise((r) => setTimeout(r, 330));
        if (!home.page.isClosed())
          await home.page.evaluate(() => {
            const socket = (window as unknown as { fixtureSocket: WebSocket }).fixtureSocket;
            if (socket.readyState === WebSocket.OPEN) socket.send('SYNTHETIC_LATE_EDIT');
          });
        await until(async () => home.page.isClosed(), 'unverifiable context did not stop');
        expect(messages).toBe(before);
      } finally {
        f.vault.status = status;
      }
    } finally {
      await home.close(false);
    }
  });
  it('stops sampling when the browser context closes unexpectedly', async () => {
    const f = await fixture();
    const home = await f.worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' });
    let reads = 0;
    const readState = home.context.storageState.bind(home.context);
    home.context.storageState = async (...args) => {
      reads++;
      return readState(...args);
    };
    try {
      await home.page.goto(origin);
      await home.context.close();
      const before = reads;
      await new Promise((r) => setTimeout(r, 250));
      expect(reads).toBe(before);
    } finally {
      await home.close(false);
    }
  });
  it('does not return a ready session if its context dies during initial capture', async () => {
    const f = await fixture();
    let stop!: () => Promise<void>;
    let unblock!: () => void;
    let seen!: () => void;
    const reading = new Promise<void>((resolve) => {
      seen = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const worker = new VaultBrowserWorker(f.vault, {
      context: async (config) => {
        const context = await browser.newContext(config);
        stop = () => context.close();
        const capture = context.storageState.bind(context);
        context.storageState = async (...args) => {
          seen();
          await barrier;
          return capture(...args);
        };
        return context;
      },
      probes: new Map(),
    });
    const opening = worker.open('alice', f.grant.id, undefined, { access: 'cloud-home-v1' });
    const rejected = expect(opening).rejects.toThrow('browser_unavailable');
    await reading;
    await stop();
    unblock();
    await rejected;
    expect((await f.store.dump('alice')).grants[0]!.writer).toBeUndefined();
  });
});

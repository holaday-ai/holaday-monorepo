/**
 * FIX-PR252-2: cross-process revocation has a hard upper bound even when the
 * status query hangs or fails. Default timings (no shortened poll) are used on
 * purpose; synthetic cookies only.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runUnifiedSupercarTask } from '../agent/browser-tools/unified-supercar-runner.js';
import { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import { TestKeyProvider } from './crypto.js';
import { MemoryVaultStore, SessionVault, type VaultDocument, type VaultStore } from './vault.js';
import {
  MAX_UNVERIFIED_MS,
  REVOCATION_UNVERIFIED,
  SESSION_REVOKED,
  STATUS_POLL_MS,
  STATUS_TIMEOUT_MS,
  VaultBrowserWorker,
} from './worker.js';

let browser: Browser;
let origin: string;
const hits: number[] = [];
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
  if (req.url?.startsWith('/probe')) hits.push(Date.now());
  res.end('ok');
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

type Mode = 'normal' | 'hang' | 'error' | 'slow';
/** A store whose lock-free status reads can be made to hang, fail or be slow. */
function faultyStore() {
  const inner = new MemoryVaultStore();
  const control = { mode: 'normal' as Mode };
  const store: VaultStore & { inner: MemoryVaultStore } = {
    inner,
    update: (userId, change) => inner.update(userId, change),
    read<T>(userId: string, view: (doc: VaultDocument) => T | Promise<T>) {
      if (control.mode === 'hang') return new Promise<T>(() => {});
      if (control.mode === 'error') return Promise.reject(new Error('db unavailable'));
      if (control.mode === 'slow')
        return new Promise<T>((resolve, reject) =>
          setTimeout(() => inner.read(userId, view).then(resolve, reject), 1500),
        );
      return inner.read(userId, view);
    },
  };
  return { store, control };
}
const cookie = {
  name: 'sid',
  value: 'SYNTHETIC_ONLY',
  domain: '127.0.0.1',
  path: '/',
  secure: false,
  httpOnly: true,
  hostOnly: true,
  session: true,
  sameSite: 'lax' as const,
};
async function openTask() {
  const { store, control } = faultyStore();
  const vault = new SessionVault({
    store,
    keys: new TestKeyProvider(),
    importEnabled: true,
    profileEnabled: true,
  });
  const interrupted: string[] = [];
  const discards: string[] = [];
  const worker = new VaultBrowserWorker(vault, {
    context: (o) => browser.newContext(o),
    networkPolicy: {
      check: async (url) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
    },
    probes: new Map([[origin, { path: '/account-check', selector: '[data-ok]' }]]),
    onDiscard: (reason) => discards.push(reason),
  });
  const grant = await vault.grant('alice', {
    origin,
    purposes: ['read', 'session-import', 'profile-persist'],
    storageKeys: [],
  });
  await vault.import('alice', grant.id, { cookies: [cookie], storage: [] }, (s, g) =>
    worker.verify('alice', s, g),
  );
  const task = await worker.open('alice', grant.id, undefined, {
    onInterrupted: (r) => interrupted.push(r),
  });
  await task.page.goto(`${origin}/`);
  // Another process: a second vault on the same store, without this process's tracker.
  const other = new SessionVault({
    store: store.inner,
    keys: new TestKeyProvider(),
    importEnabled: true,
    profileEnabled: true,
  });
  return { store, control, vault, other, task, grant, interrupted, discards };
}
/** Fires a request from the page every 250ms and records whether it got through. */
function probeLoop(task: Awaited<ReturnType<typeof openTask>>['task']) {
  let n = 0;
  const timer = setInterval(() => {
    if (task.page.isClosed()) return;
    void task.page
      .evaluate(
        (i) =>
          fetch(`/probe?n=${i}`).then(
            () => true,
            () => false,
          ),
        n++,
      )
      .catch(() => undefined);
  }, 250);
  return () => clearInterval(timer);
}

describe('revocation upper bound with a hung / failing / slow status query (default timings)', () => {
  it('documents the bound: poll + timeout ≤ 6s to hold requests, close ≤ 10s', () => {
    expect(STATUS_POLL_MS + STATUS_TIMEOUT_MS).toBeLessThanOrEqual(6000);
    expect(MAX_UNVERIFIED_MS + 250).toBeLessThanOrEqual(10000);
  });

  it('hung status query + revocation elsewhere: requests stop within 6s, context closes within 10s, no write-back', async () => {
    const f = await openTask();
    hits.length = 0;
    const stopProbe = probeLoop(f.task);
    try {
      f.control.mode = 'hang';
      const revokedAt = Date.now();
      await f.other.revoke('alice', f.grant.id);
      await new Promise((r) => setTimeout(r, 10500));
      const lastHit = hits.at(-1) ?? revokedAt;
      expect(lastHit - revokedAt).toBeLessThanOrEqual(6000);
      expect(f.task.page.isClosed()).toBe(true);
      expect(f.interrupted).toEqual([REVOCATION_UNVERIFIED]);
      // The old writer cannot write back: revoked in the store, no snapshot resurrected.
      await f.task.close();
      const doc = await f.store.inner.dump('alice');
      expect(doc.grants[0]).toMatchObject({ status: 'revoked', snapshot: undefined });
    } finally {
      stopProbe();
    }
  }, 30000);

  it('failing status query: requests are held from the first failed check and the context closes within the bound', async () => {
    const f = await openTask();
    hits.length = 0;
    const stopProbe = probeLoop(f.task);
    try {
      const failedFrom = Date.now();
      f.control.mode = 'error';
      await new Promise((r) => setTimeout(r, 10500));
      const lastHit = hits.at(-1) ?? failedFrom;
      // The next poll (≤ STATUS_POLL_MS + one tick) fails and holds traffic.
      expect(lastHit - failedFrom).toBeLessThanOrEqual(STATUS_POLL_MS + 500);
      expect(f.task.page.isClosed()).toBe(true);
      expect(f.interrupted).toEqual([REVOCATION_UNVERIFIED]);
    } finally {
      stopProbe();
    }
  }, 30000);

  it('slow but successful status query (1.5s) is not closed and keeps serving requests', async () => {
    const f = await openTask();
    hits.length = 0;
    const stopProbe = probeLoop(f.task);
    try {
      f.control.mode = 'slow';
      await new Promise((r) => setTimeout(r, 12000));
      expect(f.task.page.isClosed()).toBe(false);
      expect(f.interrupted).toEqual([]);
      const recent = hits.filter((t) => Date.now() - t < 1500);
      expect(recent.length).toBeGreaterThan(0);
    } finally {
      stopProbe();
      await f.task.close();
    }
  }, 30000);

  it('a held request resumes once a later check confirms the grant (transient failure)', async () => {
    const f = await openTask();
    hits.length = 0;
    f.control.mode = 'error';
    await new Promise((r) => setTimeout(r, STATUS_POLL_MS + 600));
    const pending = f.task.page.evaluate(() => fetch('/probe?held=1').then((r) => r.status));
    await new Promise((r) => setTimeout(r, 300));
    expect(hits).toHaveLength(0);
    f.control.mode = 'normal';
    expect(await pending).toBe(200);
    expect(f.task.page.isClosed()).toBe(false);
    await f.task.close();
  }, 30000);

  it('normal cross-process revocation still closes within one poll (+ query time)', async () => {
    const f = await openTask();
    const revokedAt = Date.now();
    await f.other.revoke('alice', f.grant.id);
    while (!f.task.page.isClosed() && Date.now() - revokedAt < 10000)
      await new Promise((r) => setTimeout(r, 100));
    expect(Date.now() - revokedAt).toBeLessThanOrEqual(STATUS_POLL_MS + STATUS_TIMEOUT_MS);
    expect(f.interrupted).toEqual([SESSION_REVOKED]);
  }, 30000);
});

describe('a stopped vault session parks the task instead of continuing', () => {
  it('the unified runner returns awaiting_user with the reason code and executes nothing', async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    let calls = 0;
    const adapter = {
      create: async () => {
        calls++;
        return {
          content: [
            calls === 1
              ? {
                  type: 'tool_use',
                  id: 'a',
                  name: 'navigate',
                  input: { url: `${origin}/probe?runner=1` },
                }
              : {
                  type: 'tool_use',
                  id: 'b',
                  name: 'finish',
                  input: { status: 'completed', summary: 'done', evidence: 'ok' },
                },
          ],
        };
      },
    } as unknown as MessagesAdapter;
    hits.length = 0;
    const result = await runUnifiedSupercarTask({
      taskId: 'vault-stopped',
      intent: '查看我的订单',
      executor: { getPage: async () => page, sessionInterruption: REVOCATION_UNVERIFIED } as never,
      messagesAdapter: adapter,
      maxIterations: 4,
    });
    expect(result).toMatchObject({ status: 'awaiting_user' });
    expect((result as { question: string }).question).toContain(REVOCATION_UNVERIFIED);
    expect(hits).toHaveLength(0);
    await page.close();
  });
});

describe('FIX-PR252-3: a late pre-revocation snapshot cannot extend the deadline', () => {
  it.each([1, 2, 3])(
    'run %i: valid snapshot returned after 1.9s, revoked meanwhile, then reads hang → stop ≤6s, close ≤10s',
    async () => {
      const f = await openTask();
      let first = true;
      let snapshotTaken!: (at: number) => void;
      const taken = new Promise<number>((resolve) => {
        snapshotTaken = resolve;
      });
      f.store.read = async (userId, view) => {
        if (!first) return new Promise(() => {});
        first = false;
        const snapshot = await f.store.inner.read(userId, view);
        snapshotTaken(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 1900));
        return snapshot;
      };
      let closedAt: number | undefined;
      f.task.context.once('close', () => {
        closedAt = Date.now();
      });
      await taken;
      const revokedAt = Date.now();
      await f.other.revoke('alice', f.grant.id);
      hits.length = 0;
      const stopProbe = probeLoop(f.task);
      try {
        await new Promise((resolve) => setTimeout(resolve, 11500));
        const lastAdmitted = Math.max(
          0,
          ...hits.filter((t) => t >= revokedAt).map((t) => t - revokedAt),
        );
        if (process.env.REVOCATION_TIMING_LOG)
          (await import('node:fs')).appendFileSync(
            process.env.REVOCATION_TIMING_LOG,
            `${JSON.stringify({ lastAdmittedMs: lastAdmitted, closedAfterMs: closedAt ? closedAt - revokedAt : null })}\n`,
          );
        expect(lastAdmitted).toBeLessThanOrEqual(6000);
        expect(closedAt).toBeDefined();
        expect((closedAt ?? Number.POSITIVE_INFINITY) - revokedAt).toBeLessThanOrEqual(10000);
        expect(f.interrupted).toEqual([REVOCATION_UNVERIFIED]);
      } finally {
        stopProbe();
        await f.task.close(false);
      }
    },
    30000,
  );
});

describe('FIX-PR252-3: an actually closed vault context parks the task', () => {
  it.each([REVOCATION_UNVERIFIED, SESSION_REVOKED])(
    'real executor, context closed (%s): awaiting_user with the reason, model never runs',
    async (reason) => {
      const executor = new PlaywrightExecutor();
      Object.assign(executor, { browser });
      const context = await executor.createSessionVaultContext({});
      await context.newPage();
      executor.markSessionInterrupted(reason);
      await context.close();
      let modelCalls = 0;
      const adapter = {
        create: async () => {
          modelCalls++;
          throw new Error('model_must_not_run');
        },
      } as unknown as MessagesAdapter;
      const outcome = await runUnifiedSupercarTask({
        taskId: `closed-${reason}`,
        intent: '只读查看页面',
        executor,
        messagesAdapter: adapter,
        maxIterations: 1,
      });
      expect(modelCalls).toBe(0);
      expect(outcome).toMatchObject({ status: 'awaiting_user' });
      expect((outcome as { question: string }).question).toContain(reason);
    },
  );
  it('without an interruption a broken page is still a plain failure', async () => {
    const executor = new PlaywrightExecutor();
    Object.assign(executor, { browser });
    const context = await executor.createSessionVaultContext({});
    await context.close();
    const outcome = await runUnifiedSupercarTask({
      taskId: 'closed-no-reason',
      intent: '只读查看页面',
      executor,
      messagesAdapter: { create: async () => ({ content: [] }) } as unknown as MessagesAdapter,
      maxIterations: 1,
    });
    expect(outcome.status).toBe('failed');
  });
});

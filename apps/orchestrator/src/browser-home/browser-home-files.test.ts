import { rm } from 'node:fs/promises';
import { pino } from 'pino';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import {
  persistTaskBrowserDownload,
  sharedBrowserDownload,
} from '../agent/browser-tools/browser-download.js';
import type { BrowserDownloadReceipt } from '../agent/browser-tools/playwright-unified-executor.js';
import { runUnifiedSupercarTask } from '../agent/browser-tools/unified-supercar-runner.js';
import type { RunSupercarOptions } from '../agent/supercar/agent-loop.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { BrowserSessionTarget } from '../browser-pool/types.js';
import { TestKeyProvider } from '../browser-session-vault/crypto.js';
import { createVaultRuntime, installVaultRuntime } from '../browser-session-vault/runtime.js';
import { MemoryVaultStore } from '../browser-session-vault/vault.js';
import { env } from '../config/env.js';
import { _resetSharedStorageProviderForTesting } from '../files/storage-provider.js';
import { browserOutputFixture } from '../files/testing/browser-output-fixture.js';
import type { Context } from '../trpc/context.js';
import { browserHomeRouter } from '../trpc/routers/browser-home.js';
import { BrowserHomeFiles } from './browser-home-files.js';
import { BrowserHomeSessions } from './browser-home-session.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
});
async function fixture() {
  const f = await browserOutputFixture();
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route('https://fixture.test/**', (route) =>
    route.fulfill(
      route.request().url().endsWith('.csv')
        ? {
            contentType: 'text/csv',
            headers: { 'content-disposition': 'attachment; filename="export.csv"' },
            body: 'name,count\nalpha,2\n',
          }
        : { contentType: 'text/html', body: '<a id="export" href="/export.csv">Export</a>' },
    ),
  );
  const page = await context.newPage();
  await page.goto('https://fixture.test/');
  const home: BrowserInstance = {
    taskId: 'bhs_usr_alice',
    userId: 'usr_alice',
    sessionPolicy: 'personal_home',
    status: 'ready',
    index: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    executor: { getPage: async () => page } as never,
  };
  let live: BrowserInstance | null = home;
  const pool = {
    peek: (id: string) => (live?.taskId === id ? live : null),
    touch: () => {},
    browserHomeHolder: () => (live?.taskId === 'tsk_alice' ? 'tsk_alice' : null),
    peekBrowserHome: () => live,
    release: async () => {
      live = null;
      await context.close();
      return true;
    },
    endBrowserHomeLoan: () => null,
  };
  const manager = new BrowserHomeFiles();
  const sessions = new BrowserHomeSessions();
  await manager.attach({
    instance: home,
    pool,
    fileService: f.service,
    userIdInternal: 7,
    enabled: () => true,
    onIdle: (original) => sessions.backgroundOperationEnded(pool as never, 'usr_alice', original),
  });
  return {
    ...f,
    context,
    page,
    home,
    manager,
    sessions,
    pool,
    replace: (next: BrowserInstance) => {
      live = next;
    },
    async close() {
      await context.close();
      await rm(f.root, { recursive: true, force: true });
    },
  };
}
async function exportFile(f: Awaited<ReturnType<typeof fixture>>) {
  const [download] = await Promise.all([
    f.page.waitForEvent('download'),
    f.page.locator('#export').click(),
  ]);
  const shared = sharedBrowserDownload(download, f.home.executor);
  expect(shared).not.toBeNull();
  return { download, receipt: await shared! };
}

describe('Actual Home download events', () => {
  it('saves one actual Download for manual and task consumers, with original task/source and bytes', async () => {
    const f = await fixture();
    try {
      f.home.taskId = 'tsk_alice';
      const { download, receipt } = await exportFile(f);
      expect(await sharedBrowserDownload(download, f.home.executor)).toEqual(receipt);
      const published: string[] = [];
      await persistTaskBrowserDownload(
        download,
        f.home.executor,
        async () => {
          throw new Error('must not save twice');
        },
        (saved) => {
          published.push(saved.fileId);
        },
      );
      expect(published).toEqual([receipt.fileId]);
      expect(f.records).toHaveLength(1);
      expect(f.records[0]).toMatchObject({
        taskId: 9,
        browserSource: {
          sessionId: 'bhs_usr_alice',
          origin: 'https://fixture.test',
          taskId: 'tsk_alice',
        },
      });
      expect((await f.service.loadForUser(receipt.fileId, 7))?.buffer.toString()).toBe(
        'name,count\nalpha,2\n',
      );
      expect(f.manager.recent('usr_alice')).toMatchObject([
        { state: 'saved', fileId: receipt.fileId },
      ]);
      expect(f.manager.recent('usr_bob')).toEqual([]);
      expect(() => sharedBrowserDownload(download, {})).toThrow('download_owner_changed');
    } finally {
      await f.close();
    }
  });

  it('keeps a pending save through last-viewer cleanup and never closes a replacement', async () => {
    const f = await fixture();
    let continueSave = () => {};
    try {
      const hold = new Promise<void>((resolve) => {
        continueSave = resolve;
      });
      const store = f.service.storeBrowserOutput.bind(f.service);
      vi.spyOn(f.service, 'storeBrowserOutput').mockImplementation(async (input) => {
        await hold;
        return store(input);
      });
      const [download] = await Promise.all([
        f.page.waitForEvent('download'),
        f.page.locator('#export').click(),
      ]);
      const save = sharedBrowserDownload(download, f.home.executor)!;
      expect(f.home.homeFileTransfers?.pending()).toBe(true);
      expect(await f.sessions.close(f.pool as never, 'usr_alice', { onlyIfUnused: true })).toBe(
        false,
      );
      expect(f.pool.peek('bhs_usr_alice')).toBe(f.home);
      const replacement = {
        ...f.home,
        executor: { getPage: async () => f.page },
      } as BrowserInstance;
      f.replace(replacement);
      continueSave();
      const receipt = await save;
      expect(f.pool.peek('bhs_usr_alice')).toBe(replacement);
      expect(f.records).toHaveLength(1);
      expect(f.records[0]).toMatchObject({
        externalId: receipt.fileId,
        taskId: null,
        browserSource: { sessionId: 'bhs_usr_alice' },
      });
    } finally {
      continueSave();
      await f.close();
    }
  });

  it('refuses a stopped source before persistence, with no file publication', async () => {
    const f = await fixture();
    try {
      // The original owner must remain valid after the stream is read, not only on event arrival.
      f.home.executor.markSessionInterrupted = () => {};
      Object.defineProperty(f.home.executor, 'sessionInterruption', {
        get: () => 'session_revoked',
      });
      const [download] = await Promise.all([
        f.page.waitForEvent('download'),
        f.page.locator('#export').click(),
      ]);
      await expect(sharedBrowserDownload(download, f.home.executor)).rejects.toThrow();
      expect(f.records).toEqual([]);
      expect(f.manager.recent('usr_alice')[0]?.state).toBe('failed');
    } finally {
      await f.close();
    }
  });

  it('settles overlapping downloads without leaving stale pending entries and refuses a fourth active file', async () => {
    const f = await fixture();
    let release = () => {};
    try {
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const store = f.service.storeBrowserOutput.bind(f.service);
      vi.spyOn(f.service, 'storeBrowserOutput').mockImplementation(async (input) => {
        await held;
        return store(input);
      });
      const results: Array<Promise<unknown>> = [];
      for (let i = 0; i < 4; i++) {
        const [download] = await Promise.all([
          f.page.waitForEvent('download'),
          f.page.locator('#export').click(),
        ]);
        results.push(
          sharedBrowserDownload(download, f.home.executor)!.then(
            (value) => ({ ok: true, value }),
            () => ({ ok: false }),
          ),
        );
      }
      release();
      const settled = await Promise.all(results);
      expect(settled.filter((result) => (result as { ok: boolean }).ok)).toHaveLength(3);
      expect(f.records).toHaveLength(3);
      expect(f.manager.recent('usr_alice').filter((row) => row.state === 'pending')).toEqual([]);
    } finally {
      release();
      await f.close();
    }
  });

  it('publishes the shared actual file through the production unified task entry', async () => {
    const f = await fixture();
    f.home.taskId = 'tsk_alice';
    const control = browserControlSessions.start(f.home);
    const published: BrowserDownloadReceipt[] = [];
    let turn = 0;
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.flatMap(strings)
          : value && typeof value === 'object'
            ? Object.values(value).flatMap(strings)
            : [];
    try {
      const result = await runUnifiedSupercarTask({
        taskId: 'tsk_alice',
        userExternalId: 'usr_alice',
        intent: '下载当前网页的 CSV 文件，不做其他操作。',
        executor: f.home.executor,
        browserControl: control.control,
        browserRescue: false,
        timeoutMs: 8000,
        browserCapabilities: {
          viewportV2: false,
          observationV2: false,
          routingV2: false,
          replayV1: false,
        },
        onBrowserDownload: async () => {
          throw new Error('duplicate file save');
        },
        onBrowserDownloadSaved: (receipt) => {
          published.push(receipt);
        },
        messagesAdapter: {
          metadata: { provider: 'anthropic', model: 'fixed-local-file-fixture' },
          async create(request) {
            turn++;
            const ref = strings(request.messages)
              .map((text) => text.match(/link "Export" \[ref=(e\d+)\]/)?.[1])
              .find(Boolean);
            const call =
              turn === 1
                ? { name: 'snapshot', input: {} }
                : turn === 2
                  ? { name: 'download', input: { ref: ref ?? 'missing-ref' } }
                  : {
                      name: 'finish',
                      input: {
                        status: 'completed',
                        summary: 'CSV 文件已保存。',
                        evidence: published[0]?.downloadUrl ?? 'no saved file',
                      },
                    };
            return {
              id: String(turn),
              metadata: this.metadata,
              stopReason: 'tool_use',
              content: [{ type: 'tool_use', id: String(turn), ...call }],
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadInputTokens: null,
                cacheCreationInputTokens: null,
                complete: true,
              },
            };
          },
        },
      } as RunSupercarOptions);
      expect(result.status).toBe('completed');
      expect(published).toHaveLength(1);
      expect(f.records).toHaveLength(1);
      expect(published[0]).toMatchObject({
        fileId: f.records[0]!.externalId,
        mimetype: 'application/octet-stream',
      });
      expect((await f.service.loadForUser(published[0]!.fileId, 7))?.buffer.toString()).toBe(
        'name,count\nalpha,2\n',
      );
    } finally {
      control.finish();
      await f.close();
    }
  });

  it('wires the actual Home open path before navigation, gates Vault downloads and lists owned files after close', async () => {
    const f = await browserOutputFixture();
    const settings = {
      home: env.BROWSER_HOME_ENABLED,
      allowlist: env.BROWSER_HOME_ALLOWLIST,
      profiles: env.BROWSER_HOME_PROFILE_V1,
      files: env.BROWSER_HOME_FILES_V1,
    };
    const runtime = createVaultRuntime({
      importEnabled: false,
      profileEnabled: false,
      cloudHomeEnabled: true,
      keys: new TestKeyProvider(),
      store: new MemoryVaultStore(),
    })!;
    const grant = await runtime.vault.captureCloudProfile(
      'usr_alice',
      {
        consent: 'cloud-browser-profile-v1',
        origin: 'https://fixture.test',
        storageKeys: ['setting'],
      },
      async () => ({
        origin: 'https://fixture.test',
        state: { cookies: [], storage: [{ name: 'setting', value: 'SYNTHETIC' }] },
      }),
    );
    let context = await browser.newContext();
    let live: BrowserInstance | null = null;
    let downloadSeen = Promise.resolve(null as import('playwright').Download | null);
    const downloadOptions: boolean[] = [];
    const executor = {
      getPage: async () => context.pages()[0] ?? (await context.newPage()),
      createSessionVaultContext: async (options: Parameters<Browser['newContext']>[0]) => {
        downloadOptions.push(options?.acceptDownloads === true);
        await context.close();
        context = await browser.newContext(options);
        return context;
      },
      markSessionInterrupted: () => {},
      navigate: async (page: import('playwright').Page, url: string) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
        return { ok: true };
      },
    };
    const pool = {
      peek: (id: string) => (live?.taskId === id ? live : null),
      touch: () => {},
      setIdleTimeout: () => true,
      browserHomeHolder: () => null,
      peekBrowserHome: () => live,
      endBrowserHomeLoan: () => null,
      allocate: async (
        taskId: string,
        userId: string,
        _viewport: unknown,
        session: BrowserSessionTarget,
      ) => {
        await runtime.prepare(userId, executor as never, session);

        const page = await executor.getPage();

        downloadSeen = new Promise((resolve) => page.once('download', resolve));
        await context.route('https://fixture.test/**', (route) =>
          route.fulfill({
            contentType: 'text/csv',
            headers: { 'content-disposition': 'attachment; filename="auto.csv"' },
            body: 'automatic,export\n1,2\n',
          }),
        );
        live = {
          taskId,
          userId,
          executor: executor as never,
          status: 'ready',
          index: 0,
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          sessionPolicy: session.sessionPolicy,
          cloudProfileId: session.cloudProfileId,
        };
        return live;
      },
      release: async () => {
        live = null;
        await runtime.finish(executor as never);
        await context.close();
        return true;
      },
    };
    const caller = (userId: string) =>
      browserHomeRouter.createCaller({
        userId,
        db: f.db,
        logger: pino({ level: 'silent' }),
        browserPool: pool,
      } as unknown as Context);
    try {
      env.BROWSER_HOME_ENABLED = true;
      env.BROWSER_HOME_ALLOWLIST = '';
      env.BROWSER_HOME_PROFILE_V1 = true;
      env.BROWSER_HOME_FILES_V1 = false;
      installVaultRuntime(runtime);
      vi.stubEnv('STORAGE_PROVIDER', 'local');
      vi.stubEnv('HOLADAY_FILES_ROOT', f.root);
      _resetSharedStorageProviderForTesting();
      vi.spyOn(defaultBrowserNetworkPolicy, 'check').mockImplementation(async (url) => ({
        allowed: true,
        url,
        addresses: ['1.1.1.1'],
      }));

      const before = await caller('usr_alice').open({
        viewerId: 'entry-viewer-before',
        profileId: grant.id,
      });

      expect(before.filesEnabled).toBe(false);
      const refused = await downloadSeen;
      expect(await refused?.failure()).not.toBeNull();
      expect(f.records).toEqual([]);
      await caller('usr_alice').close();
      env.BROWSER_HOME_FILES_V1 = true;
      const opened = await caller('usr_alice').open({
        viewerId: 'entry-viewer-after',
        profileId: grant.id,
      });
      expect(opened.filesEnabled).toBe(true);
      expect(downloadOptions).toEqual([false, true]);
      const download = await downloadSeen;
      const receipt = await sharedBrowserDownload(download!, executor)!;
      expect(f.records).toHaveLength(1);
      expect((await f.service.loadForUser(receipt.fileId, 7))?.buffer.toString()).toBe(
        'automatic,export\n1,2\n',
      );
      await caller('usr_alice').close();
      const files = await caller('usr_alice').files();
      expect(files.files).toMatchObject([
        { fileId: receipt.fileId, origin: 'https://fixture.test', available: true },
      ]);
      expect((await caller('usr_bob').files()).files).toEqual([]);
    } finally {
      await caller('usr_alice').close();
      await runtime.finish(executor as never);
      await context.close();
      env.BROWSER_HOME_ENABLED = settings.home;
      env.BROWSER_HOME_ALLOWLIST = settings.allowlist;
      env.BROWSER_HOME_PROFILE_V1 = settings.profiles;
      env.BROWSER_HOME_FILES_V1 = settings.files;
      installVaultRuntime(undefined);
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      _resetSharedStorageProviderForTesting();
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

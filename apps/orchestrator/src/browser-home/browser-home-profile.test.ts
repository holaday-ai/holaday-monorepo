import { type Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { TestKeyProvider } from '../browser-session-vault/crypto.js';
import { MemoryVaultStore, SessionVault } from '../browser-session-vault/vault.js';
import { VaultBrowserWorker } from '../browser-session-vault/worker.js';
import {
  browserHomeSaveProfileSchema,
  prepareBrowserHomeProfileSave,
  saveBrowserHomeProfile,
} from './browser-home-profile.js';
import { BrowserHomeSessions } from './browser-home-session.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(() => vi.restoreAllMocks());
const origin = 'https://fixture.test';
async function fixture() {
  vi.spyOn(defaultBrowserNetworkPolicy, 'check').mockImplementation(async (url) => ({
    allowed: true as const,
    url,
    addresses: ['1.1.1.1'],
  }));
  const context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.fulfill({ body: '<main>Actual owned Home fixture</main>', contentType: 'text/html' }),
  );
  const page = await context.newPage();
  await page.goto(`${origin}/account`);
  await page.evaluate(() => localStorage.setItem('preference', 'SYNTHETIC_LOCAL_PRIVATE'));
  await context.addCookies([
    { name: 'sid', value: 'SYNTHETIC_COOKIE_PRIVATE', url: origin, httpOnly: true, secure: true },
  ]);
  const home = {
    taskId: 'bhs_alice',
    userId: 'alice',
    status: 'ready',
    sessionPolicy: 'personal_home',
    capabilities: { collaborationV2: true },
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  let current: BrowserInstance | null = home;
  const pool = {
    peek: (id: string) => (id === 'bhs_alice' ? current : null),
    browserHomeHolder: () => null,
  };
  const store = new MemoryVaultStore();
  const vault = new SessionVault({
    store,
    keys: new TestKeyProvider(),
    importEnabled: false,
    profileEnabled: false,
    cloudHomeEnabled: true,
  });
  const worker = new VaultBrowserWorker(vault, {
    context: (config) => browser.newContext(config),
    probes: new Map(),
  });
  const sessions = new BrowserHomeSessions();
  browserControlSessions.review(home);
  const source = await prepareBrowserHomeProfileSave({ userId: 'alice', pool, sessions });
  if (!source) throw new Error('expected owned fixture source');
  const request = {
    consent: 'cloud-browser-profile-v1' as const,
    origin,
    includeStorage: true,
    sourceId: source.sourceId,
    requestId: 'ee52fe57-1dd1-4562-828d-afcb84b0c96f',
    requestedAt: Date.now(),
    clearEpoch: 0,
  };
  const args = { userId: 'alice', pool, vault, worker, sessions, request };
  return {
    ...args,
    args,
    store,
    home,
    context,
    page,
    replace: () => {
      current = { ...home };
    },
  };
}

describe('capture the actual owned Home after explicit site consent', () => {
  it.each(['document', 'human', 'instance', 'forged'] as const)(
    'refuses a prepared consent after its %s changes, before reading values',
    async (change) => {
      const f = await fixture();
      try {
        if (change === 'document') await f.page.reload();
        if (change === 'human')
          browserControlSessions.openForViewer(f.home)!.control.noteHumanInput('insertText');
        if (change === 'instance') f.replace();
        if (change === 'forged') f.request.sourceId = 'ae52fe57-1dd1-4562-828d-afcb84b0c96f';
        const read = vi.spyOn(f.worker, 'captureSite');
        await expect(saveBrowserHomeProfile(f.args)).rejects.toThrow('home_profile_page_changed');
        expect(read).not.toHaveBeenCalled();
        expect(await f.vault.list('alice')).toEqual([]);
      } finally {
        await f.context.close();
      }
    },
  );
  it('captures values only after durable consent and recovers a lost response without recapturing', async () => {
    const f = await fixture();
    try {
      const capture = f.worker.captureSite.bind(f.worker);
      const calls = vi.spyOn(f.worker, 'captureSite').mockImplementation(async (...args) => {
        expect((await f.vault.list('alice'))[0]?.status).toBe('awaiting_import');
        return capture(...args);
      });
      const saved = await saveBrowserHomeProfile(f.args);
      expect(saved).toMatchObject({ id: f.request.requestId, origin, status: 'connected' });
      expect(JSON.stringify(saved)).not.toContain('SYNTHETIC_');
      expect(JSON.stringify(await f.store.dump('alice'))).not.toContain('SYNTHETIC_');
      await f.page.goto('https://other.test/new-page');
      f.replace();
      expect(await saveBrowserHomeProfile(f.args)).toEqual(saved);
      expect(calls).toHaveBeenCalledOnce();
      const restored = await f.vault.checkout('alice', saved.id, { access: 'cloud-home-v1' });
      expect(restored.state.cookies[0]?.value).toBe('SYNTHETIC_COOKIE_PRIVATE');
      expect(restored.state.storage).toEqual([
        { name: 'preference', value: 'SYNTHETIC_LOCAL_PRIVATE' },
      ]);
      await f.vault.release('alice', saved.id, restored);
    } finally {
      await f.context.close();
    }
  });

  it.each(['document', 'human', 'instance'] as const)(
    'discards capture when the %s changes during the read',
    async (change) => {
      const f = await fixture();
      try {
        const capture = f.worker.captureSite.bind(f.worker);
        vi.spyOn(f.worker, 'captureSite').mockImplementation(async (...args) => {
          const value = await capture(...args);
          if (change === 'document') await f.page.reload();
          if (change === 'instance') f.replace();
          if (change === 'human')
            await browserControlSessions.openForViewer(f.home)!.control.runHuman(async () => {
              await f.page.evaluate(() =>
                localStorage.setItem('preference', 'CHANGED_WHILE_SAVING'),
              );
            }, 'insertText');
          return value;
        });
        await expect(saveBrowserHomeProfile(f.args)).rejects.toThrow('home_profile_page_changed');
        expect((await f.vault.list('alice'))[0]?.status).toBe('revoked');
        expect((await f.vault.cloudHomeSettings('alice')).selectedProfileId).toBeNull();
      } finally {
        await f.context.close();
      }
    },
  );

  it('refuses a task-held claim, another owner, wrong origin and raw browser state', async () => {
    const f = await fixture();
    try {
      const claim = f.sessions.claimTask(f.pool, 'alice');
      expect(claim.kind).toBe('claimed');
      await expect(saveBrowserHomeProfile(f.args)).rejects.toThrow('home_profile_busy');
      if (claim.kind === 'claimed') claim.claim.release();
      await expect(saveBrowserHomeProfile({ ...f.args, userId: 'bob' })).rejects.toThrow(
        'home_profile_closed',
      );
      await expect(
        saveBrowserHomeProfile({
          ...f.args,
          request: { ...f.request, origin: 'https://other.test' },
        }),
      ).rejects.toThrow('home_profile_page_changed');
      expect(
        browserHomeSaveProfileSchema.safeParse({ ...f.request, state: { cookies: [] } }).success,
      ).toBe(false);
      expect(await f.vault.list('alice')).toEqual([]);
    } finally {
      await f.context.close();
    }
  });
});

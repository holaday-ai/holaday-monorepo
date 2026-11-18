import { pino } from 'pino';
/** Real Home/router/pool/Vault/executor with Chromium; only OS spawn/SQL/auth are synthetic. */
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance, BrowserSessionTarget, BrowserSlot } from '../browser-pool/types.js';
import { TestKeyProvider } from '../browser-session-vault/crypto.js';
import { createVaultRuntime, installVaultRuntime } from '../browser-session-vault/runtime.js';
import { MemoryVaultStore } from '../browser-session-vault/vault.js';
import { env } from '../config/env.js';
import type { Context } from '../trpc/context.js';
import { browserHomeRouter } from '../trpc/routers/browser-home.js';
import { BrowserHomeSessions, browserHomeSessions } from './browser-home-session.js';

const logger = pino({ level: 'silent' });
const ORIGIN = 'https://fixture.test';
const OWNER = 'recovery_alice';
const original = {
  enabled: env.BROWSER_HOME_ENABLED,
  profiles: env.BROWSER_HOME_PROFILE_V1,
  allowlist: env.BROWSER_HOME_ALLOWLIST,
};

beforeEach(() => {
  env.BROWSER_HOME_ENABLED = true;
  env.BROWSER_HOME_PROFILE_V1 = true;
  env.BROWSER_HOME_ALLOWLIST = '';
  vi.spyOn(defaultBrowserNetworkPolicy, 'check').mockImplementation(async (url) => {
    if (new URL(url).origin !== ORIGIN) throw new Error('Fixture may not access external sites');
    return { allowed: true, url, addresses: ['1.1.1.1'] };
  });
});
afterEach(() => {
  installVaultRuntime(undefined);
  env.BROWSER_HOME_ENABLED = original.enabled;
  env.BROWSER_HOME_PROFILE_V1 = original.profiles;
  env.BROWSER_HOME_ALLOWLIST = original.allowlist;
  vi.restoreAllMocks();
});

async function fixture() {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  await browser.newContext();
  const runtime = createVaultRuntime({
    importEnabled: false,
    profileEnabled: false,
    cloudHomeEnabled: true,
    keys: new TestKeyProvider(),
    store: new MemoryVaultStore(),
  })!;
  const grant = await runtime.vault.captureCloudProfile(
    OWNER,
    { consent: 'cloud-browser-profile-v1', origin: ORIGIN, storageKeys: ['account'] },
    async () => ({
      origin: ORIGIN,
      state: { cookies: [], storage: [{ name: 'account', value: 'SYNTHETIC_RECOVERY_STATE' }] },
    }),
  );
  const executor = new PlaywrightExecutor({
    // Replaces only the CDP transport. Every context/page operation is real Chromium.
    chromium: { connectOverCDP: async () => browser },
  });
  expect((await executor.connect('http://synthetic-cdp.invalid')).ok).toBe(true);
  const pool = new BrowserPool(
    {
      maxInstances: 2,
      idleTimeoutMs: 300_000,
      baseDir: '/private/tmp/ba-recovery-unused',
      cdpPortStart: 9300,
      vncPortStart: 5910,
      wsPortStart: 6090,
      displayStart: 100,
      screenSize: '1280x800x24',
    },
    logger,
  );
  const internal = pool as unknown as {
    allocator: { claim(): BrowserSlot };
    instances: Map<string, BrowserInstance>;
    spawnInstance: (...args: unknown[]) => Promise<BrowserInstance>;
    tearDownInstance: (instance: BrowserInstance) => Promise<void>;
  };
  let allocations = 0;
  internal.spawnInstance = async (...args: unknown[]) => {
    const [taskId, userId, , session] = args as [string, string, unknown, BrowserSessionTarget];
    allocations++;
    await runtime.prepare(userId, executor, session);
    const page = await executor.getPage();
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<main>Saved workspace</main>' }),
    );
    const instance: BrowserInstance = {
      ...internal.allocator.claim(),
      taskId,
      userId,
      index: 0,
      userDataDir: '/private/tmp/ba-recovery-unused/no-profile-written',
      executor,
      sessionPolicy: session.sessionPolicy,
      cloudProfileId: session.cloudProfileId,
      status: 'ready',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    internal.instances.set(taskId, instance);
    return instance;
  };
  internal.tearDownInstance = async () => {
    await runtime.finish(executor);
    await executor.disconnect();
  };
  installVaultRuntime(runtime);
  const caller = browserHomeRouter.createCaller({
    userId: OWNER,
    logger,
    browserPool: pool,
  } as Context);
  return {
    runtime,
    grant,
    executor,
    pool,
    caller,
    allocations: () => allocations,
    async close() {
      await browserHomeSessions.close(pool, OWNER);
      await pool.shutdown();
      await runtime.finish(executor);
      await executor.disconnect();
      await browser.close();
    },
  };
}

describe('Personal Home recovery uses the original live context', () => {
  it('does not report ready when a revoked saved profile has stopped its actual context', async () => {
    const f = await fixture();
    try {
      await f.caller.open({ viewerId: 'recovery-viewer-1', profileId: f.grant.id });
      const context = (await f.executor.getPage()).context();
      expect((await context.storageState()).origins[0]?.localStorage).toEqual([
        { name: 'account', value: 'SYNTHETIC_RECOVERY_STATE' },
      ]);
      await f.caller.forgetProfile({ profileId: f.grant.id });
      expect(f.executor.sessionInterruption).toBe('session_revoked');
      expect(context.pages()).toEqual([]);
      // The default request must fail too; it must not reuse the pool's stale ready marker.
      await expect(f.caller.open({ viewerId: 'recovery-viewer-2' })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(f.allocations()).toBe(1);
      const claim = browserHomeSessions.claimTask(f.pool, OWNER);
      if (claim.kind === 'claimed') claim.claim.release();
      expect(claim.kind).toBe('closed');
    } finally {
      await f.close();
    }
  });

  it('rejects a revoked context even when the open request was already reading its page', async () => {
    const f = await fixture();
    let releaseRead = () => {};
    let releaseClaim = () => {};
    try {
      await f.caller.open({ profileId: f.grant.id });
      const claim = browserHomeSessions.claimTask(f.pool, OWNER);
      expect(claim.kind).toBe('claimed');
      if (claim.kind === 'claimed') releaseClaim = claim.claim.release;
      const originalGetPage = f.executor.getPage.bind(f.executor);
      let enteredRead = () => {};
      const entered = new Promise<void>((resolve) => {
        enteredRead = resolve;
      });
      const held = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const read = vi.spyOn(f.executor, 'getPage').mockImplementationOnce(async () => {
        const page = await originalGetPage();
        enteredRead();
        await held;
        return page;
      });
      const result = expect(f.caller.open()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      await entered;
      await f.caller.forgetProfile({ profileId: f.grant.id });
      releaseRead();
      await result;
      read.mockRestore();
      expect(claim.kind === 'claimed' && claim.claim.isCurrent()).toBe(false);
      if (claim.kind === 'claimed') claim.claim.release();
      expect(f.allocations()).toBe(1);
    } finally {
      releaseRead();
      releaseClaim();
      await f.close();
    }
  });

  it('keeps the task loan when the last viewer leaves and rejoins that exact context', async () => {
    const f = await fixture();
    const sessions = new BrowserHomeSessions();
    try {
      const profile = { id: f.grant.id, origin: ORIGIN };
      await sessions.open(f.pool, OWNER, logger, 'task-viewer-1', profile);
      const home = sessions.locate(f.pool, OWNER)!.instance;
      const page = await f.executor.getPage();
      expect(f.pool.lendBrowserHome(OWNER, 'task-recovery-1', 'personal_home')).toBe(home);
      expect(sessions.leave(f.pool, OWNER, 'task-viewer-1')).toBe('scheduled');
      // Run the grace callback deterministically without shortening Vault's liveness timers.
      expect(await sessions.close(f.pool, OWNER, { onlyIfUnused: true })).toBe(false);
      expect(f.pool.browserHomeHolder(OWNER)).toBe('task-recovery-1');
      await sessions.open(f.pool, OWNER, logger, 'task-viewer-2', profile);
      expect(sessions.locate(f.pool, OWNER)).toEqual({ instance: home, heldBy: 'task-recovery-1' });
      expect(await f.executor.getPage()).toBe(page);
      expect(f.allocations()).toBe(1);
      expect(sessions.giveBack(f.pool, 'task-recovery-1', OWNER)).toBe(true);
      expect(sessions.locate(f.pool, OWNER)).toEqual({ instance: home, heldBy: null });
    } finally {
      await sessions.close(f.pool, OWNER);
      await f.close();
    }
  });
});

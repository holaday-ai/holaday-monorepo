import { type Browser, type BrowserContext, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestKeyProvider } from './crypto.js';
import { createVaultRuntime } from './runtime.js';
import { MemoryVaultStore } from './vault.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
});
async function fixture() {
  const runtime = createVaultRuntime({
    importEnabled: false,
    profileEnabled: false,
    cloudHomeEnabled: true,
    keys: new TestKeyProvider(),
    store: new MemoryVaultStore(),
  })!;
  const grant = await runtime.vault.captureCloudProfile(
    'alice',
    {
      consent: 'cloud-browser-profile-v1',
      origin: 'https://fixture.test',
      storageKeys: ['account'],
    },
    async () => ({
      origin: 'https://fixture.test',
      state: {
        cookies: [
          {
            name: 'sid',
            value: 'SYNTHETIC_HOME_IDENTITY',
            domain: 'fixture.test',
            path: '/',
            secure: true,
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
  let context: BrowserContext | undefined;
  const executor = {
    createSessionVaultContext: async (config: Parameters<Browser['newContext']>[0]) => {
      context = await browser.newContext(config);
      return context;
    },
    markSessionInterrupted: (_reason: string) => {},
  };
  return { runtime, grant, executor, context: () => context };
}
describe('Home allocation -> actual Vault context preparation', () => {
  it('restores only the explicit owned profile and closes that context at release', async () => {
    const f = await fixture();
    try {
      await f.runtime.prepare('alice', f.executor as never, {
        sessionPolicy: 'personal_home',
        cloudProfileId: f.grant.id,
        targetUrl: 'https://fixture.test',
      });
      expect(f.context()?.pages().length).toBe(1);
      expect((await f.context()!.cookies('https://fixture.test'))[0]?.value).toBe(
        'SYNTHETIC_HOME_IDENTITY',
      );
      expect((await f.context()!.storageState()).origins[0]?.localStorage).toEqual([
        { name: 'account', value: 'SYNTHETIC_ACCOUNT' },
      ]);
      await f.runtime.finish(f.executor as never);
      expect(f.context()!.pages()).toEqual([]);
      const restored = await f.runtime.vault.checkout('alice', f.grant.id, {
        access: 'cloud-home-v1',
      });
      expect(restored.mode).toBe('writer');
      await f.runtime.vault.release('alice', f.grant.id, restored);
    } finally {
      await f.runtime.finish(f.executor as never);
    }
  });

  it('does not auto-select personal state for a public, readonly or empty Home allocation', async () => {
    for (const session of [
      { sessionPolicy: 'anonymous', cloudProfileId: 'ignored' },
      { sessionPolicy: 'vault_allowed', targetUrl: 'https://fixture.test' },
      { sessionPolicy: 'personal_home' },
    ] as const) {
      const f = await fixture();
      await f.runtime.prepare('alice', f.executor as never, session);
      expect(f.context()).toBeUndefined();
    }
  });

  it('refuses another owner profile and never falls back to an empty browser', async () => {
    const f = await fixture();
    await expect(
      f.runtime.prepare('bob', f.executor as never, {
        sessionPolicy: 'personal_home',
        cloudProfileId: f.grant.id,
      }),
    ).rejects.toThrow('grant_unavailable');
    expect(f.context()).toBeUndefined();
  });
});

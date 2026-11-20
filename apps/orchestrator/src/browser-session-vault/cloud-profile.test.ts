import { describe, expect, it, vi } from 'vitest';
import { TestKeyProvider, seal, unseal } from './crypto.js';
import { LEASE_TTL, MemoryVaultStore, SessionVault } from './vault.js';

const DAY = 86_400_000;
const origin = 'https://fixture.test';
const consent = {
  consent: 'cloud-browser-profile-v1',
  origin,
  storageKeys: ['account-preference'],
};
const state = {
  cookies: [
    {
      name: 'sid',
      value: 'SYNTHETIC_CLOUD_SESSION',
      domain: 'fixture.test',
      path: '/',
      secure: true,
      httpOnly: true,
      hostOnly: true,
      sameSite: 'lax',
      session: true,
    },
  ],
  storage: [{ name: 'account-preference', value: 'SYNTHETIC_USER_SETTING' }],
};
function fixture(enabled = true) {
  let now = 1_700_000_000_000;
  const store = new MemoryVaultStore();
  const keys = new TestKeyProvider();
  const vault = new SessionVault({
    store,
    keys,
    importEnabled: true,
    profileEnabled: true,
    cloudHomeEnabled: enabled,
    now: () => now,
  });
  return {
    vault,
    store,
    keys,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const capture = async () => ({ origin, state });

describe('explicit native-cloud profiles in the existing vault', () => {
  it('seals the owned capture, but never selects it for an ordinary readonly task', async () => {
    const f = fixture();
    const grant = await f.vault.captureCloudProfile('alice', consent, capture);
    expect(grant).toMatchObject({
      origin,
      sessionAccess: 'cloud-home-v1',
      status: 'connected',
      purposes: ['read', 'act', 'profile-persist'],
      cookieCount: 1,
    });
    expect(grant.expiresAt).toBe(f.now() + 30 * DAY);
    const stored = JSON.stringify(await f.store.dump('alice'));
    expect(stored).not.toContain('SYNTHETIC_CLOUD_SESSION');
    expect(stored).not.toContain('SYNTHETIC_USER_SETTING');
    expect(JSON.stringify(grant)).not.toContain('SYNTHETIC_');
    expect(await f.vault.match('alice', origin)).toBeNull();
    expect(await f.vault.matchCloudProfile('alice', `${origin}/account`)).toMatchObject({
      id: grant.id,
    });
    expect(await f.vault.matchCloudProfile('alice', 'https://sub.fixture.test/')).toBeNull();
    expect(await f.vault.matchCloudProfile('bob', origin)).toBeNull();
    await expect(f.vault.checkout('alice', grant.id)).rejects.toThrow('scope_denied');
    await expect(f.vault.checkout('bob', grant.id, { access: 'cloud-home-v1' })).rejects.toThrow(
      'grant_unavailable',
    );
    const checked = await f.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
    expect(checked.mode).toBe('writer');
    expect(checked.state).toEqual(state);
    expect(await f.vault.status('alice', grant.id, { token: null, version: checked.version })).toBe(
      'cas_conflict',
    );
  });

  it('does not upgrade an imported readonly grant or let the legacy grant route create an interactive one', async () => {
    const f = fixture();
    await expect(
      f.vault.grant('alice', {
        origin,
        purposes: ['read', 'act', 'profile-persist'],
        storageKeys: [],
      }),
    ).rejects.toThrow('invalid_grant');
    const legacy = await f.vault.grant('alice', {
      origin,
      purposes: ['read', 'session-import'],
      storageKeys: [],
    });
    await f.vault.import('alice', legacy.id, { ...state, storage: [] }, async () => 'connected');
    await f.vault.captureCloudProfile('alice', consent, capture);
    expect(await f.vault.match('alice', origin)).toMatchObject({ id: legacy.id });
    await expect(f.vault.checkout('alice', legacy.id, { access: 'cloud-home-v1' })).rejects.toThrow(
      'scope_denied',
    );
    expect((await f.vault.checkout('alice', legacy.id)).mode).toBe('readonly');
  });

  it.each([
    { enabled: false, input: consent, error: 'cloud_profile_disabled' },
    { enabled: true, input: { ...consent, consent: 'session-import-v1' }, error: 'invalid_grant' },
    { enabled: true, input: { ...consent, state }, error: 'invalid_grant' },
  ])(
    'rejects invalid consent before accessing the live browser: $error',
    async ({ enabled, input, error }) => {
      const f = fixture(enabled);
      const readBrowser = vi.fn(capture);
      await expect(f.vault.captureCloudProfile('alice', input, readBrowser)).rejects.toThrow(error);
      expect(readBrowser).not.toHaveBeenCalled();
      expect(await f.vault.list('alice')).toEqual([]);
    },
  );

  it.each([
    { actual: { origin: 'https://other.test', state }, error: 'scope_denied' },
    { actual: { origin, state: { cookies: [], storage: [] } }, error: 'empty_session' },
  ])('refuses a mismatched or empty actual capture: $error', async ({ actual, error }) => {
    const f = fixture();
    await expect(f.vault.captureCloudProfile('alice', consent, async () => actual)).rejects.toThrow(
      error,
    );
    expect(await f.vault.matchCloudProfile('alice', origin)).toBeNull();
    expect((await f.vault.list('alice'))[0]?.status).toBe('revoked');
  });

  it.each(['revoke', 'clear'] as const)(
    'lets %s win over a browser capture still in flight',
    async (action) => {
      const f = fixture();
      let resolve!: (value: { origin: string; state: unknown }) => void;
      let seen!: () => void;
      const started = new Promise<void>((r) => {
        seen = r;
      });
      const pending = f.vault.captureCloudProfile('alice', consent, () => {
        seen();
        return new Promise((r) => {
          resolve = r;
        });
      });
      const rejected = expect(pending).rejects.toThrow('grant_unavailable');
      await started;
      const [grant] = await f.vault.list('alice');
      if (action === 'clear') await f.vault.clear('alice');
      else await f.vault.revoke('alice', grant!.id);
      resolve({ origin, state });
      await rejected;
      expect(await f.vault.matchCloudProfile('alice', origin)).toBeNull();
      const saved = (await f.store.dump('alice')).grants[0]!;
      expect(saved.status).toBe('revoked');
      expect(saved.snapshot).toBeUndefined();
    },
  );

  it('requires one live interactive writer, and an expired writer cannot resume or overwrite its successor', async () => {
    const f = fixture();
    const grant = await f.vault.captureCloudProfile('alice', consent, capture);
    const first = await f.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
    await expect(f.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' })).rejects.toThrow(
      'writer_busy',
    );
    f.advance(LEASE_TTL + 1);
    expect(await f.vault.status('alice', grant.id, first)).toBe('cas_conflict');
    const second = await f.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
    await expect(f.vault.save('alice', grant.id, first, state)).rejects.toThrow('cas_conflict');
    await f.vault.save('alice', grant.id, second, state);
    expect(await f.vault.matchCloudProfile('alice', origin)).toMatchObject({ id: grant.id });
  });

  it('expires idle cloud identity and cannot read it when the new feature is disabled', async () => {
    const f = fixture();
    const grant = await f.vault.captureCloudProfile('alice', consent, capture);
    const disabled = new SessionVault({
      store: f.store,
      keys: f.keys,
      importEnabled: true,
      profileEnabled: true,
    });
    await expect(disabled.checkout('alice', grant.id, { access: 'cloud-home-v1' })).rejects.toThrow(
      'cloud_profile_disabled',
    );
    expect(await disabled.matchCloudProfile('alice', origin)).toBeNull();
    f.advance(7 * DAY + 1);
    expect(await f.vault.matchCloudProfile('alice', origin)).toBeNull();
    await expect(f.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' })).rejects.toThrow(
      'grant_unavailable',
    );
  });

  it('renews only the current live home lease without rewriting or exposing browser state', async () => {
    const f = fixture();
    const grant = await f.vault.captureCloudProfile('alice', consent, capture);
    const writer = await f.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
    const snapshot = (await f.store.dump('alice')).grants[0]!.snapshot;
    f.advance(LEASE_TTL - 1);
    await f.vault.renewCloudLease('alice', grant.id, writer);
    f.advance(2);
    expect(await f.vault.status('alice', grant.id, writer)).toBe('live');
    expect((await f.store.dump('alice')).grants[0]!.snapshot).toEqual(snapshot);
    await expect(f.vault.renewCloudLease('bob', grant.id, writer)).rejects.toThrow(
      'grant_unavailable',
    );
    f.advance(LEASE_TTL);
    await expect(f.vault.renewCloudLease('alice', grant.id, writer)).rejects.toThrow(
      'cas_conflict',
    );
    const successor = await f.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
    await expect(f.vault.renewCloudLease('alice', grant.id, writer)).rejects.toThrow(
      'cas_conflict',
    );
    await f.vault.revoke('alice', grant.id);
    await expect(f.vault.renewCloudLease('alice', grant.id, successor)).rejects.toThrow(
      'grant_unavailable',
    );
  });

  it('expires an unfinished capture after five minutes and refuses its late result', async () => {
    const f = fixture();
    let resolve!: (value: { origin: string; state: unknown }) => void;
    let started!: () => void;
    const read = new Promise<void>((r) => {
      started = r;
    });
    const pending = f.vault.captureCloudProfile('alice', consent, () => {
      started();
      return new Promise((r) => {
        resolve = r;
      });
    });
    const rejected = expect(pending).rejects.toThrow('grant_unavailable');
    await read;
    f.advance(5 * 60_000);
    expect((await f.vault.list('alice'))[0]?.status).toBe('expired');
    resolve({ origin, state });
    await rejected;
    expect((await f.store.dump('alice')).grants[0]!.snapshot).toBeUndefined();
  });

  it('honors the earliest cookie or explicit consent expiry', async () => {
    const f = fixture();
    const g = await f.vault.captureCloudProfile(
      'alice',
      { ...consent, expiresAt: f.now() + 40_000 },
      async () => ({
        origin,
        state: {
          ...state,
          cookies: [
            { ...state.cookies[0], session: false, expirationDate: (f.now() + 30_000) / 1000 },
          ],
        },
      }),
    );
    f.advance(30_000);
    expect(await f.vault.matchCloudProfile('alice', origin)).toBeNull();
    await expect(f.vault.checkout('alice', g.id, { access: 'cloud-home-v1' })).rejects.toThrow(
      'grant_unavailable',
    );
  });

  it('authenticates interactive access in the envelope instead of reinterpreting a readonly blob', async () => {
    const keys = new TestKeyProvider();
    const context = {
      userId: 'alice',
      origin,
      grantId: 'grant',
      purpose: 'profile' as const,
      version: 1,
    };
    const blob = await seal(keys, { ...context, access: 'cloud-home-v1' }, state);
    await expect(unseal(keys, context, blob)).rejects.toThrow('vault_crypto_failed');
    expect(await unseal(keys, { ...context, access: 'cloud-home-v1' }, blob)).toEqual(state);
  });
});

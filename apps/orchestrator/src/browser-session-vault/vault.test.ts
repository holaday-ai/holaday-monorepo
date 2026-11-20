import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TestKeyProvider,
  assertVaultConfiguration,
  rewrapEnvelope,
  seal,
  unseal,
} from './crypto.js';
import { LEASE_TTL, MemoryVaultStore, SessionVault } from './vault.js';

const DAY = 86400000;
const origin = 'https://fixture.test';
const state = {
  cookies: [
    {
      name: 'sid',
      value: 'SYNTHETIC_ONLY',
      domain: 'fixture.test',
      path: '/',
      secure: true,
      httpOnly: true,
      hostOnly: true,
      sameSite: 'lax' as const,
      session: true,
    },
  ],
  storage: [],
};
function setup() {
  let now = 1000000000;
  const store = new MemoryVaultStore();
  const keys = new TestKeyProvider();
  const audit = vi.fn();
  const vault = new SessionVault({
    store,
    keys,
    now: () => now,
    importEnabled: true,
    profileEnabled: true,
    audit,
  });
  return {
    vault,
    store,
    keys,
    audit,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
const request = {
  origin,
  purposes: ['read', 'session-import', 'profile-persist'] as const,
  storageKeys: [],
};
afterEach(() => vi.unstubAllEnvs());
describe('session vault lifecycle', () => {
  it('grants, seals, checks login and reuses only in the owning user task', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    expect(grant.expiresAt - f.now()).toBe(7 * DAY);
    const verifier = vi.fn(async () => 'connected' as const);
    const result = await f.vault.import('alice', grant.id, state, verifier);
    expect(result.status).toBe('connected');
    expect(verifier).toHaveBeenCalledOnce();
    expect(JSON.stringify(await f.store.dump('alice'))).not.toContain('SYNTHETIC_ONLY');
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain('SYNTHETIC_ONLY');
    await expect(f.vault.checkout('bob', grant.id)).rejects.toThrow('grant_unavailable');
    const task = await f.vault.checkout('alice', grant.id);
    expect(task.state.cookies[0]?.value).toBe('SYNTHETIC_ONLY');
    await expect(f.vault.import('alice', grant.id, state, verifier)).rejects.toThrow(
      'import_consumed',
    );
    await f.vault.save('alice', grant.id, task, state);
    expect((await f.vault.list('alice'))[0]?.status).toBe('connected');
  });
  it('revocation closes contexts and dominates an older writer', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await f.vault.import('alice', grant.id, state, async () => 'connected');
    const task = await f.vault.checkout('alice', grant.id);
    const close = vi.fn(async () => {});
    f.vault.track('alice', grant.id, close);
    await f.vault.revoke('alice', grant.id, 'logout');
    expect(close).toHaveBeenCalledOnce();
    await expect(f.vault.save('alice', grant.id, task, state)).rejects.toThrow('grant_unavailable');
    await expect(f.vault.checkout('alice', grant.id)).rejects.toThrow('grant_unavailable');
    const stored = await f.store.dump('alice');
    expect(JSON.stringify(stored)).not.toContain('ciphertext');
  });
  it('enforces one writer, CAS and logout wins without merging old cookies', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await f.vault.import('alice', grant.id, state, async () => 'connected');
    const first = await f.vault.checkout('alice', grant.id);
    expect(first.mode).toBe('writer');
    // A concurrent task is a read-only fork (never an allocation failure) and cannot write back.
    const fork = await f.vault.checkout('alice', grant.id);
    expect(fork).toMatchObject({ mode: 'readonly', reason: 'writer_busy', token: null });
    await expect(f.vault.save('alice', grant.id, fork, state)).rejects.toThrow('cas_conflict');
    await f.vault.save('alice', grant.id, first, state);
    await expect(f.vault.save('alice', grant.id, first, state)).rejects.toThrow('cas_conflict');
    const next = await f.vault.checkout('alice', grant.id);
    await f.vault.save('alice', grant.id, next, { cookies: [], storage: [] });
    await expect(f.vault.checkout('alice', grant.id)).rejects.toThrow('grant_unavailable');
  });
  it('expires imported sessions and profile idle/absolute limits', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await f.vault.import('alice', grant.id, state, async () => 'connected');
    f.advance(7 * DAY + 1);
    await expect(f.vault.checkout('alice', grant.id)).rejects.toThrow('grant_unavailable');
    expect((await f.vault.list('alice'))[0]?.status).toBe('expired');
    await expect(
      f.vault.grant('alice', { ...request, expiresAt: f.now() + 31 * DAY }),
    ).rejects.toThrow('invalid_grant');
  });
  it('rejects out-of-scope cookies/storage, unselected SSO and unsafe origins', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await expect(
      f.vault.import(
        'alice',
        grant.id,
        { ...state, cookies: [{ ...state.cookies[0], domain: '.other.test' }] },
        async () => 'connected',
      ),
    ).rejects.toThrow('scope_denied');
    await expect(
      f.vault.import(
        'alice',
        grant.id,
        { ...state, storage: [{ name: 'token', value: 'SYNTHETIC_ONLY' }] },
        async () => 'connected',
      ),
    ).rejects.toThrow('scope_denied');
    await expect(
      f.vault.grant('alice', { ...request, origin: 'https://fixture.test/path' }),
    ).rejects.toThrow('invalid_grant');
  });
  it('keeps challenges unusable, fails closed on KMS errors and revocation during verification', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await f.vault.import('alice', grant.id, state, async () => 'risk_blocked');
    await expect(f.vault.checkout('alice', grant.id)).rejects.toThrow('grant_unavailable');
    const second = await f.vault.grant('alice', request);
    await expect(
      f.vault.import('alice', second.id, state, async () => {
        await f.vault.revoke('alice', second.id);
        return 'connected';
      }),
    ).rejects.toThrow('grant_unavailable');
  });
  it('serializes competing one-use imports and refuses a stale lease after takeover', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    const outcomes = await Promise.allSettled([
      f.vault.import('alice', grant.id, state, async () => 'connected'),
      f.vault.import('alice', grant.id, state, async () => 'connected'),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const stale = await f.vault.checkout('alice', grant.id);
    f.advance(LEASE_TTL + 1);
    const current = await f.vault.checkout('alice', grant.id);
    await expect(f.vault.save('alice', grant.id, stale, state)).rejects.toThrow('cas_conflict');
    await f.vault.save('alice', grant.id, current, state);
  });
  it('purges expired ciphertext and active contexts; enforces cookie expiry and a 30 day profile grant ceiling', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await f.vault.import(
      'alice',
      grant.id,
      {
        ...state,
        cookies: [{ ...state.cookies[0], session: false, expirationDate: (f.now() + 1000) / 1000 }],
      },
      async () => 'connected',
    );
    const close = vi.fn(async () => {});
    f.vault.track('alice', grant.id, close);
    f.advance(1001);
    expect((await f.vault.list('alice'))[0]?.status).toBe('expired');
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(await f.store.dump('alice'))).not.toContain('ciphertext');
    expect(
      (await f.vault.grant('alice', { ...request, purposes: ['read', 'profile-persist'] }))
        .expiresAt - f.now(),
    ).toBe(30 * DAY);
    await expect(
      f.vault.grant('alice', {
        ...request,
        purposes: ['read', 'profile-persist'],
        expiresAt: f.now() + 30 * DAY + 1,
      }),
    ).rejects.toThrow('invalid_grant');
  });
  it('preserves partition metadata but rejects inconsistent cookie lifetime and oversized scope', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await expect(
      f.vault.import(
        'alice',
        grant.id,
        { ...state, cookies: [{ ...state.cookies[0], expirationDate: 1234567890 }] },
        async () => 'connected',
      ),
    ).rejects.toThrow('scope_denied');
    const partitioned = {
      ...state,
      cookies: [
        {
          ...state.cookies[0],
          partitionKey: { topLevelSite: origin, hasCrossSiteAncestor: false },
        },
      ],
    };
    await f.vault.import('alice', grant.id, partitioned, async () => 'connected');
    expect((await f.vault.checkout('alice', grant.id)).state).toEqual(partitioned);
    expect(JSON.stringify(await f.store.dump('alice'))).not.toContain('SYNTHETIC_ONLY');
    await expect(
      f.vault.grant('alice', {
        ...request,
        storageKeys: Array.from({ length: 21 }, (_, i) => `key${i}`),
      }),
    ).rejects.toThrow('invalid_grant');
  });
  it('clear removes all recoverable ciphertext and denies the next task', async () => {
    const f = setup();
    const grant = await f.vault.grant('alice', request);
    await f.vault.import('alice', grant.id, state, async () => 'connected');
    await f.vault.clear('alice');
    await expect(f.vault.checkout('alice', grant.id)).rejects.toThrow('grant_unavailable');
    expect(JSON.stringify(await f.store.dump('alice'))).not.toContain('ciphertext');
  });
});
describe('envelope and configuration', () => {
  it('binds user/site/grant/purpose/version and detects tampering', async () => {
    const keys = new TestKeyProvider();
    const context = {
      userId: 'alice',
      origin,
      grantId: 'g1',
      purpose: 'session' as const,
      version: 1,
    };
    const blob = await seal(keys, context, state);
    expect(await unseal(keys, context, blob)).toEqual(state);
    await expect(unseal(keys, { ...context, userId: 'bob' }, blob)).rejects.toThrow(
      'vault_crypto_failed',
    );
    await expect(
      unseal(keys, context, { ...blob, ciphertext: blob.ciphertext.slice(1) }),
    ).rejects.toThrow('vault_crypto_failed');
    for (const change of [
      { origin: 'https://other.test' },
      { grantId: 'g2' },
      { purpose: 'profile' as const },
      { version: 2 },
    ]) {
      await expect(unseal(keys, { ...context, ...change }, blob)).rejects.toThrow(
        'vault_crypto_failed',
      );
    }
  });
  it('does not retain a failed KMS import or expose a provider error', async () => {
    const store = new MemoryVaultStore();
    const vault = new SessionVault({
      store,
      importEnabled: true,
      profileEnabled: false,
      keys: {
        kind: 'kms',
        wrap: async () => {
          throw new Error('SYNTHETIC_PROVIDER_DETAIL');
        },
        unwrap: async () => {
          throw new Error('SYNTHETIC_PROVIDER_DETAIL');
        },
      },
    });
    const grant = await vault.grant('alice', { ...request, purposes: ['read', 'session-import'] });
    await expect(vault.import('alice', grant.id, state, async () => 'connected')).rejects.toThrow(
      'vault_crypto_failed',
    );
    const stored = JSON.stringify(await store.dump('alice'));
    expect(stored).not.toContain('ciphertext');
    expect(stored).not.toContain('SYNTHETIC_PROVIDER_DETAIL');
    expect(stored).not.toContain('SYNTHETIC_ONLY');
  });
  it('rotates a wrapped DEK without changing ciphertext and refuses the old wrapping key', async () => {
    const oldKeys = new TestKeyProvider();
    const newKeys = new TestKeyProvider();
    const context = {
      userId: 'alice',
      origin,
      grantId: 'g1',
      purpose: 'session' as const,
      version: 1,
    };
    const before = await seal(oldKeys, context, state);
    const after = await rewrapEnvelope(oldKeys, newKeys, context, before);
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.wrappedKey).not.toBe(before.wrappedKey);
    expect(await unseal(newKeys, context, after)).toEqual(state);
    await expect(unseal(oldKeys, context, after)).rejects.toThrow('vault_crypto_failed');
    await expect(
      rewrapEnvelope(newKeys, oldKeys, { ...context, userId: 'bob' }, after),
    ).rejects.toThrow('vault_crypto_failed');
  });
  it('is off by default and forbids local keys outside tests', () => {
    expect(
      assertVaultConfiguration({ importEnabled: false, profileEnabled: false }),
    ).toBeUndefined();
    expect(() => assertVaultConfiguration({ importEnabled: true, profileEnabled: false })).toThrow(
      'vault_key_provider_required',
    );
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new TestKeyProvider()).toThrow('test_key_provider_forbidden');
  });
});

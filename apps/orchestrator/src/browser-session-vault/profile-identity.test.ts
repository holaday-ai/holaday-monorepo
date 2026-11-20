import { describe, expect, it } from 'vitest';
import { TestKeyProvider } from './crypto.js';
import { type SiteIdentity, issueIdentityProof } from './profile-snapshot.js';
import { MemoryVaultStore, SessionVault } from './vault.js';

const origin = 'https://fixture.test';
const state = {
  cookies: [
    {
      name: 'sid',
      value: 'PRIVATE_TOKEN',
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
const identity = { adapter: 'fixture-subject-v1', subject: 'PRIVATE_ACCOUNT_ALICE' };
async function fixture() {
  const store = new MemoryVaultStore();
  const vault = new SessionVault({
    store,
    keys: new TestKeyProvider(),
    cloudHomeEnabled: true,
    importEnabled: true,
    profileEnabled: true,
  });
  const grant = await vault.captureCloudProfile(
    'alice',
    {
      consent: 'cloud-browser-profile-v1',
      origin,
      storageKeys: [],
    },
    async (pending) => ({
      origin,
      state,
      identityProof: issueIdentityProof(
        {
          userId: 'alice',
          grantId: pending.id,
          grantVersion: pending.version,
          origin,
          snapshotVersion: 0,
        },
        state,
        identity,
      ),
    }),
  );
  const checkout = await vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
  const proof = (raw: typeof state, subject: SiteIdentity = identity) =>
    issueIdentityProof(
      {
        userId: 'alice',
        grantId: grant.id,
        grantVersion: grant.version,
        origin,
        snapshotVersion: checkout.version,
      },
      raw,
      subject,
    );
  return { store, vault, grant, checkout, proof };
}

describe('bound account continuity at the Vault transaction', () => {
  it('supports cookie-only identity and keeps same-account token rotation writable', async () => {
    const f = await fixture();
    expect(f.checkout.identity).toEqual(identity);
    expect(JSON.stringify(f.grant)).not.toContain('PRIVATE_ACCOUNT_ALICE');
    const refreshed = {
      ...state,
      cookies: [{ ...state.cookies[0]!, value: 'ROTATED_PRIVATE_TOKEN' }],
    };
    await f.vault.save('alice', f.grant.id, f.checkout, refreshed, {
      identityProof: f.proof(refreshed),
    });
    const next = await f.vault.checkout('alice', f.grant.id, { access: 'cloud-home-v1' });
    expect(next.state).toEqual(refreshed);
    expect(next.identity).toEqual(identity);
    for (const value of ['PRIVATE_ACCOUNT_ALICE', 'ROTATED_PRIVATE_TOKEN'])
      expect(JSON.stringify(await f.store.dump('alice'))).not.toContain(value);
  });
  it('refuses missing proof or a different subject without replacing the original encrypted account', async () => {
    const f = await fixture();
    await expect(f.vault.save('alice', f.grant.id, f.checkout, state)).rejects.toThrow(
      'identity_unverified',
    );
    await expect(
      f.vault.save('alice', f.grant.id, f.checkout, state, {
        identityProof: f.proof(state, { ...identity, subject: 'PRIVATE_ACCOUNT_BOB' }),
      }),
    ).rejects.toThrow('account_changed');
    await f.vault.release('alice', f.grant.id, f.checkout);
    const next = await f.vault.checkout('alice', f.grant.id, { access: 'cloud-home-v1' });
    expect(next.identity).toEqual(identity);
    expect(next.state).toEqual(state);
  });
  it('a successful proof cannot restore a grant revoked while verification was pending', async () => {
    const f = await fixture();
    const proof = f.proof(state);
    await f.vault.revoke('alice', f.grant.id);
    await expect(
      f.vault.save('alice', f.grant.id, f.checkout, state, { identityProof: proof }),
    ).rejects.toThrow('grant_unavailable');
    expect((await f.vault.list('alice'))[0]?.status).toBe('revoked');
  });
  it('explicit logout keeps the original tombstone behavior without requiring a fresh subject proof', async () => {
    const f = await fixture();
    await f.vault.save('alice', f.grant.id, f.checkout, { cookies: [], storage: [] });
    expect((await f.vault.list('alice'))[0]?.status).toBe('revoked');
  });
});

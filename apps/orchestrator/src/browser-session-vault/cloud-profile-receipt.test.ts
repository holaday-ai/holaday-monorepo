import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TestKeyProvider } from './crypto.js';
import { MemoryVaultStore, SessionVault } from './vault.js';

const origin = 'https://fixture.test';
const consent = { consent: 'cloud-browser-profile-v1', origin, storageKeys: ['preference'] };
const state = { cookies: [], storage: [{ name: 'preference', value: 'SYNTHETIC_PRIVATE_VALUE' }] };
function fixture() {
  let now = 1_700_000_000_000;
  const store = new MemoryVaultStore();
  const vault = new SessionVault({
    store,
    keys: new TestKeyProvider(),
    importEnabled: false,
    profileEnabled: false,
    cloudHomeEnabled: true,
    now: () => now,
  });
  const operation = {
    requestId: 'ee52fe57-1dd1-4562-828d-afcb84b0c96f',
    requestHash: createHash('sha256').update('consent-intent').digest('hex'),
    requestedAt: now,
    clearEpoch: 0,
    makeDefault: true,
  };
  return {
    vault,
    store,
    operation,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const capture = async () => ({ origin, state });

describe('durable Home save receipts and selected profile', () => {
  it('cancelling an older request does not interrupt a later pending save', async () => {
    const f = fixture();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const first = f.vault.captureCloudProfile(
      'alice',
      consent,
      async () => {
        firstStarted();
        await firstGate;
        return capture();
      },
      f.operation,
    );
    const rejected = expect(first).rejects.toThrow('grant_unavailable');
    await firstReady;
    const next = {
      ...f.operation,
      clearEpoch: 1,
      requestId: 'ae52fe57-1dd1-4562-828d-afcb84b0c96f',
    };
    const second = f.vault.captureCloudProfile(
      'alice',
      consent,
      async () => {
        secondStarted();
        await secondGate;
        return capture();
      },
      next,
    );
    await secondReady;
    await f.vault.cancelCloudProfileSave(
      'alice',
      f.operation.requestId,
      f.operation.requestHash,
      f.operation.clearEpoch,
    );
    releaseFirst();
    releaseSecond();
    await rejected;
    expect((await second).status).toBe('connected');
    expect((await f.vault.cloudHomeSettings('alice')).selectedProfileId).toBe(next.requestId);
  });
  it('cancels an unseen request before a delayed copy can start', async () => {
    const f = fixture();
    expect(
      await f.vault.cancelCloudProfileSave(
        'alice',
        f.operation.requestId,
        f.operation.requestHash,
        f.operation.clearEpoch,
      ),
    ).toBeNull();
    const read = vi.fn(capture);
    await expect(f.vault.captureCloudProfile('alice', consent, read, f.operation)).rejects.toThrow(
      'profile_settings_changed',
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('cancels a pending capture without erasing a known saved result', async () => {
    const f = fixture();
    let unblock!: () => void;
    let seen!: () => void;
    const started = new Promise<void>((resolve) => {
      seen = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const pending = f.vault.captureCloudProfile(
      'alice',
      consent,
      async () => {
        seen();
        await gate;
        return capture();
      },
      f.operation,
    );
    const rejected = expect(pending).rejects.toThrow('grant_unavailable');
    await started;
    expect(
      (
        await f.vault.cancelCloudProfileSave(
          'alice',
          f.operation.requestId,
          f.operation.requestHash,
          f.operation.clearEpoch,
        )
      )?.status,
    ).toBe('revoked');
    unblock();
    await rejected;
    const operation = {
      ...f.operation,
      clearEpoch: (await f.vault.cloudHomeSettings('alice')).clearEpoch,
      requestId: 'ae52fe57-1dd1-4562-828d-afcb84b0c96f',
    };
    const saved = await f.vault.captureCloudProfile('alice', consent, capture, operation);
    expect(
      await f.vault.cancelCloudProfileSave(
        'alice',
        saved.id,
        operation.requestHash,
        operation.clearEpoch,
      ),
    ).toEqual(saved);
    expect((await f.vault.cloudHomeSettings('alice')).selectedProfileId).toBe(saved.id);
  });
  it('recovers a saved result without reading a changed browser or creating another profile', async () => {
    const f = fixture();
    const grant = await f.vault.captureCloudProfile('alice', consent, capture, f.operation);
    expect(grant.id).toBe(f.operation.requestId);
    expect(await f.vault.cloudHomeSettings('alice')).toEqual({
      selectedProfileId: grant.id,
      clearEpoch: 1,
    });
    const readAgain = vi.fn(capture);
    expect(await f.vault.captureCloudProfile('alice', consent, readAgain, f.operation)).toEqual(
      grant,
    );
    expect(readAgain).not.toHaveBeenCalled();
    expect(await f.vault.cloudProfileReceipt('alice', grant.id, f.operation.requestHash)).toEqual(
      grant,
    );
    expect(await f.vault.cloudProfileReceipt('bob', grant.id, f.operation.requestHash)).toBeNull();
    expect(await f.vault.list('alice')).toHaveLength(1);
    expect(JSON.stringify(grant)).not.toContain('captureRequestHash');
    expect(JSON.stringify(await f.vault.list('alice'))).not.toContain(f.operation.requestHash);
    expect(JSON.stringify(await f.store.dump('alice'))).not.toContain('SYNTHETIC_PRIVATE_VALUE');
  });

  it('keeps an in-flight save unresolved and rejects a changed intent using the same identifier', async () => {
    const f = fixture();
    let unblock!: () => void;
    let seen!: () => void;
    const started = new Promise<void>((resolve) => {
      seen = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const pending = f.vault.captureCloudProfile(
      'alice',
      consent,
      async () => {
        seen();
        await gate;
        return capture();
      },
      f.operation,
    );
    await started;
    try {
      const duplicate = vi.fn(capture);
      await expect(
        f.vault.captureCloudProfile('alice', consent, duplicate, f.operation),
      ).rejects.toThrow('profile_capture_pending');
      expect(duplicate).not.toHaveBeenCalled();
      await expect(
        f.vault.cloudProfileReceipt('alice', f.operation.requestId, 'b'.repeat(64)),
      ).rejects.toThrow('profile_request_conflict');
      expect(await f.vault.cloudHomeSettings('alice')).toEqual({
        selectedProfileId: null,
        clearEpoch: 1,
      });
    } finally {
      unblock();
      await pending;
    }
  });

  it('clear wins even when no grant existed when an old save was prepared', async () => {
    const f = fixture();
    await f.vault.clear('alice');
    const readBrowser = vi.fn(capture);
    await expect(
      f.vault.captureCloudProfile('alice', consent, readBrowser, f.operation),
    ).rejects.toThrow('profile_settings_changed');
    expect(readBrowser).not.toHaveBeenCalled();
    expect(await f.vault.cloudHomeSettings('alice')).toEqual({
      selectedProfileId: null,
      clearEpoch: 1,
    });
    expect(await f.vault.list('alice')).toEqual([]);
  });

  it('does not resurrect a revoked receipt and rejects an unknown save after its replay window', async () => {
    const f = fixture();
    const grant = await f.vault.captureCloudProfile('alice', consent, capture, f.operation);
    await f.vault.revoke('alice', grant.id);
    const readAgain = vi.fn(capture);
    await expect(
      f.vault.captureCloudProfile('alice', consent, readAgain, f.operation),
    ).rejects.toThrow('grant_unavailable');
    await expect(f.vault.selectCloudHomeProfile('alice', grant.id)).rejects.toThrow(
      'grant_unavailable',
    );
    expect((await f.vault.cloudHomeSettings('alice')).selectedProfileId).toBe(grant.id);
    await f.vault.selectCloudHomeProfile('alice', null);
    expect((await f.vault.cloudHomeSettings('alice')).selectedProfileId).toBeNull();
    f.advance(5 * 60_000);
    await expect(
      f.vault.captureCloudProfile('alice', consent, readAgain, {
        ...f.operation,
        requestId: 'ae52fe57-1dd1-4562-828d-afcb84b0c96f',
      }),
    ).rejects.toThrow('profile_request_expired');
    expect(readAgain).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { TestKeyProvider } from './crypto.js';
import { createVaultRuntime } from './runtime.js';
import { MemoryVaultStore } from './vault.js';

describe('vault startup guard', () => {
  it('defaults off without accessing a store or launching a browser', () => {
    expect(createVaultRuntime({ importEnabled: false, profileEnabled: false })).toBeUndefined();
  });
  it('cannot enable either path without a provider', () => {
    expect(() => createVaultRuntime({ importEnabled: true, profileEnabled: false })).toThrow(
      'vault_key_provider_required',
    );
    expect(() => createVaultRuntime({ importEnabled: false, profileEnabled: true })).toThrow(
      'vault_key_provider_required',
    );
    expect(() =>
      createVaultRuntime({ importEnabled: false, profileEnabled: false, cloudHomeEnabled: true }),
    ).toThrow('vault_key_provider_required');
  });
  it('persists a cloud profile independently while both legacy import switches are off', async () => {
    const runtime = createVaultRuntime({
      importEnabled: false,
      profileEnabled: false,
      cloudHomeEnabled: true,
      keys: new TestKeyProvider(),
      store: new MemoryVaultStore(),
    })!;
    const state = { cookies: [], storage: [{ name: 'preference', value: 'SYNTHETIC_SETTING' }] };
    const grant = await runtime.vault.captureCloudProfile(
      'alice',
      {
        consent: 'cloud-browser-profile-v1',
        origin: 'https://fixture.test',
        storageKeys: ['preference'],
      },
      async () => ({ origin: 'https://fixture.test', state }),
    );
    const writer = await runtime.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
    expect(writer.state).toEqual(state);
    await runtime.vault.save('alice', grant.id, writer, state);
    const restored = await runtime.vault.checkout('alice', grant.id, { access: 'cloud-home-v1' });
    expect(restored.version).toBe(2);
    expect(restored.state).toEqual(state);
  });
  it('can explicitly use ephemeral keys and memory store only under test', () => {
    expect(
      createVaultRuntime({
        importEnabled: true,
        profileEnabled: true,
        keys: new TestKeyProvider(),
        store: new MemoryVaultStore(),
      }),
    ).toBeDefined();
  });
});

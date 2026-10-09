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

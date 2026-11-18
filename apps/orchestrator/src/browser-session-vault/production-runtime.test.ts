import { describe, expect, it, vi } from 'vitest';
import { createProductionVaultRuntime, parseTrustedSiteProbes } from './production-runtime.js';
import { createVaultRuntime } from './runtime.js';
import { MemoryVaultStore } from './vault.js';

const arn = 'arn:aws:kms:ap-southeast-1:123456789012:key/12345678-1234-1234-1234-123456789012';
const site = {
  origin: 'https://fixture.example',
  path: '/account',
  selector: '[data-active]',
  subject: { selector: '[data-account-id]', attribute: 'data-account-id', adapter: 'fixture-v1' },
};
const configured = {
  importEnabled: false,
  profileEnabled: true,
  cloudHomeEnabled: false,
  provider: 'aws-kms',
  region: 'ap-southeast-1',
  keyArn: arn,
  profile: 'holaday-browser-vault',
  probesJson: JSON.stringify([site]),
};
function dependencies() {
  const keys = {
    kind: 'kms' as const,
    wrap: vi.fn(),
    unwrap: vi.fn(),
    assertReady: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const createKeys = vi.fn(() => keys);
  const createRuntime = vi.fn((options: Parameters<typeof createVaultRuntime>[0]) =>
    createVaultRuntime({ ...options, store: new MemoryVaultStore() }),
  );
  return { keys, createKeys, createRuntime };
}
describe('production Vault startup configuration', () => {
  it('does no key/profile/database work when all Vault paths are off', async () => {
    const deps = dependencies();
    expect(
      await createProductionVaultRuntime(
        { importEnabled: false, profileEnabled: false, provider: 'unused-invalid' },
        deps,
      ),
    ).toBeUndefined();
    expect(deps.createKeys).not.toHaveBeenCalled();
    expect(deps.createRuntime).not.toHaveBeenCalled();
  });
  it('validates the real key before constructing the runtime with trusted probes', async () => {
    const deps = dependencies();
    const runtime = await createProductionVaultRuntime(configured, deps);
    expect(runtime).toBeDefined();
    expect(deps.keys.assertReady).toHaveBeenCalledOnce();
    expect(deps.keys.assertReady.mock.invocationCallOrder[0]).toBeLessThan(
      deps.createRuntime.mock.invocationCallOrder[0]!,
    );
    expect(deps.createRuntime.mock.calls[0]?.[0].probes?.get(site.origin)).toEqual({
      path: site.path,
      selector: site.selector,
      subject: site.subject,
    });
    runtime!.close();
    runtime!.close();
    expect(deps.keys.close).toHaveBeenCalledOnce();
  });
  it.each(['provider', 'region', 'keyArn', 'profile', 'probesJson'] as const)(
    'refuses missing %s before credentials or runtime work',
    async (field) => {
      const deps = dependencies();
      await expect(
        createProductionVaultRuntime({ ...configured, [field]: undefined }, deps),
      ).rejects.toThrow(/vault_/);
      expect(deps.createKeys).not.toHaveBeenCalled();
      expect(deps.createRuntime).not.toHaveBeenCalled();
    },
  );
  it('cleans up a failed key readiness check and never creates the runtime', async () => {
    const deps = dependencies();
    deps.keys.assertReady.mockRejectedValueOnce(new Error('vault_kms_unavailable'));
    await expect(createProductionVaultRuntime(configured, deps)).rejects.toThrow(
      'vault_kms_unavailable',
    );
    expect(deps.keys.close).toHaveBeenCalledOnce();
    expect(deps.createRuntime).not.toHaveBeenCalled();
  });
  it('cleans up construction failure without exposing its diagnostic text', async () => {
    const deps = dependencies();
    deps.createRuntime.mockImplementationOnce(() => {
      throw new Error('must-not-expose-secret-diagnostic');
    });
    await expect(createProductionVaultRuntime(configured, deps)).rejects.toThrow(
      /^vault_startup_failed$/,
    );
    expect(deps.keys.close).toHaveBeenCalledOnce();
  });
  it('parses only exact public HTTPS origins with local readonly probe paths', () => {
    expect([...parseTrustedSiteProbes(JSON.stringify([site])).keys()]).toEqual([site.origin]);
    for (const entry of [
      { ...site, origin: 'http://fixture.example' },
      { ...site, origin: 'https://fixture.example/path' },
      { ...site, origin: 'https://127.0.0.1' },
      { ...site, origin: 'https://name:secret@fixture.example' },
      { ...site, path: '//outside.example/account' },
      { ...site, path: '/account?logout=1' },
      { ...site, subject: undefined },
      { ...site, subject: { ...site.subject, adapter: '' } },
      { ...site, selector: '' },
      { ...site, unexpected: 'field' },
    ])
      expect(() => parseTrustedSiteProbes(JSON.stringify([entry]))).toThrow(/vault_trusted_site/);
    expect(() => parseTrustedSiteProbes(JSON.stringify([site, site]))).toThrow(
      /vault_trusted_site/,
    );
    expect(() => parseTrustedSiteProbes('[]')).toThrow(/vault_trusted_site/);
  });
});

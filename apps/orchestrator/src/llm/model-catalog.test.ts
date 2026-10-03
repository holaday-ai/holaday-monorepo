import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_MODEL_CATALOG,
  type BrainEntry,
  ModelCatalogError,
  type ModelCatalogStore,
  applyBrainUpdate,
  createModelCatalogService,
  currentBrain,
  enterBrain,
  listBrainsForViewer,
  normalizeLaneModels,
  resolveBrainFromEntries,
  runWithBrain,
  selectDefaultBrain,
} from './model-catalog.js';

const allConfigured = () => true;
const catalog = (): BrainEntry[] => BUILTIN_MODEL_CATALOG.map((entry) => ({ ...entry }));

describe('model catalog rules', () => {
  it('seeds 千问 as the only visible default, Claude/GPT hidden and admin-only', () => {
    const entries = catalog();
    expect(selectDefaultBrain(entries).id).toBe('qwen');
    expect(entries.filter((entry) => entry.isDefault).map((entry) => entry.id)).toEqual(['qwen']);
    expect(entries.find((entry) => entry.id === 'claude')).toMatchObject({
      userVisible: false,
      adminOnly: true,
    });
    expect(entries.find((entry) => entry.id === 'gpt')).toMatchObject({
      userVisible: false,
      adminOnly: true,
    });
  });

  it('falls back to a Qwen row when the table has zero or several defaults', () => {
    const none = catalog().map((entry) => ({ ...entry, isDefault: false }));
    const many = catalog().map((entry) => ({ ...entry, isDefault: true }));
    expect(selectDefaultBrain(none).id).toBe('qwen');
    expect(selectDefaultBrain(many).id).toBe('qwen');
  });

  it('shows ordinary users only visible brains and flags admin-only ones for admins', () => {
    const user = listBrainsForViewer(catalog(), { isAdmin: false }, allConfigured);
    expect(user.map((item) => item.id)).toEqual(['qwen']);

    const admin = listBrainsForViewer(catalog(), { isAdmin: true }, allConfigured);
    expect(admin.map((item) => [item.id, item.adminOnly])).toEqual([
      ['qwen', false],
      ['claude', true],
      ['gpt', true],
    ]);
  });

  it('marks brains whose provider key is missing as not configured', () => {
    const items = listBrainsForViewer(
      catalog(),
      { isAdmin: true },
      (provider) => provider !== 'openai',
    );
    expect(items.find((item) => item.id === 'gpt')?.configured).toBe(false);
    expect(items.find((item) => item.id === 'qwen')?.configured).toBe(true);
  });

  it('resolves to the default when nothing is requested', () => {
    expect(resolveBrainFromEntries(catalog(), { isAdmin: false }, allConfigured)).toMatchObject({
      brain: { id: 'qwen' },
      requestedBrainId: null,
      fallbackReason: null,
    });
  });

  it('falls back to 千问 with a reason for unknown, hidden or unconfigured brains', () => {
    expect(
      resolveBrainFromEntries(
        catalog(),
        { isAdmin: false, requestedBrainId: 'nope' },
        allConfigured,
      ),
    ).toMatchObject({
      brain: { id: 'qwen' },
      requestedBrainId: 'nope',
      fallbackReason: 'NOT_FOUND',
    });
    expect(
      resolveBrainFromEntries(
        catalog(),
        { isAdmin: false, requestedBrainId: 'claude' },
        allConfigured,
      ),
    ).toMatchObject({ brain: { id: 'qwen' }, fallbackReason: 'NOT_VISIBLE' });
    expect(
      resolveBrainFromEntries(
        catalog(),
        { isAdmin: true, requestedBrainId: 'claude' },
        () => false,
      ),
    ).toMatchObject({ brain: { id: 'qwen' }, fallbackReason: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('lets admins use admin-only brains and users use brains made visible', () => {
    expect(
      resolveBrainFromEntries(
        catalog(),
        { isAdmin: true, requestedBrainId: 'claude' },
        allConfigured,
      ),
    ).toMatchObject({ brain: { id: 'claude' }, fallbackReason: null });
    const shown = applyBrainUpdate(catalog(), 'claude', { userVisible: true });
    expect(
      resolveBrainFromEntries(shown, { isAdmin: false, requestedBrainId: 'claude' }, allConfigured),
    ).toMatchObject({ brain: { id: 'claude' }, fallbackReason: null });
  });

  it('keeps exactly one default when another brain becomes default', () => {
    const next = applyBrainUpdate(catalog(), 'gpt', { isDefault: true });
    expect(next.filter((entry) => entry.isDefault).map((entry) => entry.id)).toEqual(['gpt']);
    // A new default must be visible to everyone.
    expect(next.find((entry) => entry.id === 'gpt')?.userVisible).toBe(true);
  });

  it('refuses to hide the current default', () => {
    expect(() => applyBrainUpdate(catalog(), 'qwen', { userVisible: false })).toThrow(
      ModelCatalogError,
    );
  });

  it('refuses illegal lane model names and unknown brains', () => {
    expect(() =>
      applyBrainUpdate(catalog(), 'claude', { laneModels: { generate: 'bad model; drop' } }),
    ).toThrow(ModelCatalogError);
    expect(() => applyBrainUpdate(catalog(), 'missing', { userVisible: true })).toThrow(
      ModelCatalogError,
    );
    const next = applyBrainUpdate(catalog(), 'claude', {
      laneModels: { generate: ' claude-opus-4-7 ' },
    });
    expect(next.find((entry) => entry.id === 'claude')?.laneModels.generate).toBe(
      'claude-opus-4-7',
    );
  });

  it('normalizes stored lane JSON and drops unknown lanes', () => {
    expect(normalizeLaneModels('{"generate":"qwen3.7-plus","nope":"x","plan":""}')).toEqual({
      generate: 'qwen3.7-plus',
    });
    expect(normalizeLaneModels(null)).toEqual({});
  });
});

describe('model catalog service', () => {
  const memoryStore = (initial: BrainEntry[]) => {
    let rows = initial;
    const store: ModelCatalogStore & { loads: number } = {
      loads: 0,
      async load() {
        store.loads += 1;
        return rows.map((row) => ({ ...row }));
      },
      async save(change) {
        rows = change.next.map((row) => ({ ...row }));
      },
    };
    return store;
  };

  it('caches for 10s and applies an admin change immediately', async () => {
    let clock = 0;
    const store = memoryStore(catalog());
    const service = createModelCatalogService({
      store,
      isProviderConfigured: allConfigured,
      now: () => clock,
    });

    await service.list();
    await service.list();
    expect(store.loads).toBe(1);

    await service.update({
      id: 'claude',
      patch: { userVisible: true },
      actorExternalId: 'usr_admin',
    });
    const visible = listBrainsForViewer(service.snapshot(), { isAdmin: false }, allConfigured);
    expect(visible.map((item) => item.id)).toEqual(['qwen', 'claude']);

    clock = 10_001;
    await service.list();
    expect(store.loads).toBe(3);
  });

  it('keeps serving the built-in catalog when the table is missing', async () => {
    const onLoadError = vi.fn();
    const service = createModelCatalogService({
      store: {
        load: () => Promise.reject(new Error("Table 'model_catalog' doesn't exist")),
        save: () => Promise.reject(new Error('unreachable')),
      },
      isProviderConfigured: allConfigured,
      onLoadError,
    });
    const resolved = await service.resolveBrain({ isAdmin: false });
    expect(resolved.brain.id).toBe('qwen');
    expect(onLoadError).toHaveBeenCalledTimes(1);
  });
});

describe('per-task brain context', () => {
  it('carries the bound brain across awaits and leaves the outside unbound', async () => {
    const resolved = {
      brain: catalog()[1] as BrainEntry,
      requestedBrainId: 'claude',
      fallbackReason: null,
    };
    const seen = await runWithBrain(resolved, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentBrain()?.brain.id;
    });
    expect(seen).toBe('claude');
    expect(currentBrain()).toBeUndefined();
  });

  it('binds a brain resolved midway through a request without leaking to the caller', async () => {
    const resolved = {
      brain: catalog()[2] as BrainEntry,
      requestedBrainId: 'gpt',
      fallbackReason: null,
    };
    const handler = async () => {
      await Promise.resolve();
      enterBrain(resolved);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentBrain()?.brain.id;
    };
    expect(await handler()).toBe('gpt');
    expect(currentBrain()).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_MODEL_CATALOG,
  type BrainEntry,
  createModelCatalogService,
} from '../../llm/model-catalog.js';

const state = vi.hoisted(() => ({ admins: new Set<string>() }));

vi.mock('../../llm/model-catalog-runtime.js', async () => {
  let rows: BrainEntry[] = BUILTIN_MODEL_CATALOG.map((entry) => ({ ...entry }));
  const modelCatalogService = createModelCatalogService({
    store: {
      async load() {
        return rows.map((row) => ({ ...row }));
      },
      async save(change) {
        rows = change.next.map((row) => ({ ...row }));
      },
    },
    isProviderConfigured: (provider) => provider !== 'openai',
  });
  return {
    modelCatalogService,
    isAdminUser: async (_db: unknown, userId: string) => state.admins.has(userId),
  };
});

const { modelsRouter } = await import('./models.js');

/** Minimal db for adminProcedure's role lookup. */
function dbFor(userId: string) {
  const row = state.admins.has(userId)
    ? { role: 'admin', status: 'active' }
    : { role: 'user', status: 'active' };
  const chain = { from: () => chain, where: () => chain, limit: async () => [row] };
  return { select: () => chain };
}

function caller(userId: string) {
  return modelsRouter.createCaller({ userId, db: dbFor(userId) } as never);
}

describe('models router', () => {
  it('gives ordinary users only 千问', async () => {
    const result = await caller('usr_plain').list();
    expect(result.items.map((item) => item.id)).toEqual(['qwen']);
    expect(result.items[0]).toMatchObject({ label: '千问', isDefault: true, adminOnly: false });
  });

  it('shows admins the admin-only brains with their flag and key status', async () => {
    state.admins.add('usr_admin');
    const result = await caller('usr_admin').list();
    expect(result.items.map((item) => [item.id, item.adminOnly, item.configured])).toEqual([
      ['qwen', false, true],
      ['claude', true, true],
      ['gpt', true, false],
    ]);
  });

  it('rejects admin mutations from ordinary users', async () => {
    await expect(
      caller('usr_plain').adminUpdate({ id: 'claude', userVisible: true }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('makes a brain visible to users immediately after an admin switch, without restart', async () => {
    state.admins.add('usr_admin');
    await caller('usr_admin').adminUpdate({ id: 'claude', userVisible: true });
    const result = await caller('usr_plain').list();
    expect(result.items.map((item) => item.id)).toEqual(['qwen', 'claude']);
  });

  it('refuses to hide the default brain', async () => {
    state.admins.add('usr_admin');
    await expect(
      caller('usr_admin').adminUpdate({ id: 'qwen', userVisible: false }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

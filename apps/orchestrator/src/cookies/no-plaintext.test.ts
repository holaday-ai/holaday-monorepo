import { afterEach, expect, it, vi } from 'vitest';
import { _resetMasterKeyCacheForTests } from './cookie-crypto.js';
import { injectPendingCookies, upsertPendingCookies } from './sync-service.js';
afterEach(() => {
  vi.unstubAllEnvs();
  _resetMasterKeyCacheForTests();
});
it('never dual-writes cookie plaintext even on the legacy compatibility helper', async () => {
  vi.stubEnv('COOKIE_MASTER_KEY', Buffer.alloc(32, 9).toString('base64'));
  _resetMasterKeyCacheForTests();
  let inserted: unknown;
  let updated: unknown;
  const db = {
    insert: () => ({
      values: (value: unknown) => {
        inserted = value;
        return {
          onDuplicateKeyUpdate: async (value: unknown) => {
            updated = value;
          },
        };
      },
    }),
  };
  await upsertPendingCookies(db as never, 1, [
    { domain: 'fixture.test', name: 'sid', value: 'SYNTHETIC_ONLY' },
  ]);
  expect(inserted).toMatchObject({ cookiesJson: null });
  expect(updated).toMatchObject({ set: { cookiesJson: null } });
  expect(JSON.stringify([inserted, updated])).not.toContain('SYNTHETIC_ONLY');
});

it('drops a plaintext-only legacy queue row without injecting it', async () => {
  const addCookies = vi.fn();
  const deleted = vi.fn(async () => {});
  let select = 0;
  const db = {
    select: () => {
      const rows =
        ++select === 1
          ? [{ id: 1 }]
          : [{ id: 2, cookiesJson: '[{"name":"sid","value":"SYNTHETIC_ONLY"}]' }];
      const chain = { from: () => chain, where: () => chain, limit: async () => rows };
      return chain;
    },
    delete: () => ({ where: deleted }),
  };
  expect(
    await injectPendingCookies({
      db: db as never,
      context: { addCookies } as never,
      userExternalId: 'owner',
    }),
  ).toBe(0);
  expect(addCookies).not.toHaveBeenCalled();
  expect(deleted).toHaveBeenCalledOnce();
});

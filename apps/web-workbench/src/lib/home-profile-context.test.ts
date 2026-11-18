import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHomeProfileContext } from './home-profile-context';
const state = vi.hoisted(() => ({
  token: 'SYNTHETIC_A',
  switchAfterSave: false,
  saved: new Map<string, { owner: string; request: { requestId: string; origin: string } }>(),
}));
vi.mock('./auth', () => ({ getAccessToken: () => state.token }));
vi.mock('./trpc', () => ({
  createPinnedTrpc: (token: string) => {
    const owner = token === 'SYNTHETIC_A' ? 'usr_a' : 'usr_b';
    return {
      auth: { me: { query: async () => ({ userId: owner }) } },
      browserHome: {
        profileOptions: {
          query: async () => ({
            enabled: true,
            profiles: [],
            selectedProfileId: null,
            clearEpoch: 0,
            serverNow: Date.now(),
            source: {
              sourceId: 'ae52fe57-1dd1-4562-828d-afcb84b0c96f',
              origin: 'https://fixture.test',
              expiresAt: Date.now() + 120000,
            },
          }),
        },
        saveProfile: {
          mutate: async (request: { requestId: string; origin: string }) => {
            state.saved.set(request.requestId, { owner, request });
            if (state.switchAfterSave) state.token = 'SYNTHETIC_B';
            return {
              id: request.requestId,
              origin: request.origin,
              status: 'connected',
              expiresAt: Date.now() + 300000,
            };
          },
        },
        profileSaveReceipt: {
          query: async (request: { requestId: string; origin: string }) => {
            const result = state.saved.get(request.requestId);
            return result?.owner === owner
              ? {
                  state: 'saved',
                  id: request.requestId,
                  origin: request.origin,
                  expiresAt: Date.now() + 300000,
                }
              : { state: 'missing' };
          },
        },
      },
    };
  },
}));
const data = new Map<string, string>();
beforeEach(() => {
  state.token = 'SYNTHETIC_A';
  state.switchAfterSave = false;
  state.saved.clear();
  data.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('navigator', {
    locks: { request: async (_key: string, run: () => Promise<unknown>) => run() },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it('refuses stale displayed actor before any profile effect', async () => {
  state.token = 'SYNTHETIC_B';
  await expect(createHomeProfileContext('usr_a', () => {})).rejects.toThrow('当前账号已变化');
  expect(state.saved.size).toBe(0);
  expect(data.size).toBe(0);
});
it('retains a hashed original-owner intent after token change and recovers it only for that actor', async () => {
  const context = await createHomeProfileContext('usr_a', () => {});
  state.switchAfterSave = true;
  await expect(context.journal.save(await context.api.options(), true)).rejects.toThrow(
    '登录态已切换',
  );
  expect([...state.saved.values()].map((row) => row.owner)).toEqual(['usr_a']);
  const key = [...data.keys()][0]!;
  expect(key).toMatch(/^holaday\.home-profile-save\.v1\.[a-f0-9]{64}$/);
  expect([...data.values()][0]).not.toMatch(/SYNTHETIC_A|SYNTHETIC_B|Bearer|usr_a/);
  const other = await createHomeProfileContext('usr_b', () => {});
  expect(await other.journal.inspect()).toEqual({ pending: null, receipt: null });
  expect(data.size).toBe(1);
  state.token = 'SYNTHETIC_A';
  const original = await createHomeProfileContext('usr_a', () => {});
  expect((await original.journal.inspect()).receipt?.state).toBe('saved');
  expect(data.size).toBe(0);
});

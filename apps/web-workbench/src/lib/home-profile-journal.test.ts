import { describe, expect, it } from 'vitest';
import {
  HomeProfileJournal,
  type HomeProfileJournalDependencies,
  type HomeProfileOptions,
  type HomeSaveRequest,
} from './home-profile-journal';
const REQUEST_ID = 'ee52fe57-1dd1-4562-828d-afcb84b0c96f';
const SOURCE_ID = 'ae52fe57-1dd1-4562-828d-afcb84b0c96f';
const options: HomeProfileOptions = {
  enabled: true,
  profiles: [],
  selectedProfileId: null,
  clearEpoch: 0,
  serverNow: 1_700_000_000_000,
  source: { sourceId: SOURCE_ID, origin: 'https://fixture.test', expiresAt: 1_700_000_120_000 },
};
function fixture() {
  const data = new Map<string, string>();
  const saved = new Map<string, HomeSaveRequest>();
  const posted: HomeSaveRequest[] = [];
  let current = true;
  let dropSave = false;
  let dropCancel = false;
  let issued = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const deps: HomeProfileJournalDependencies = {
    key: 'holaday.home-profile-save.v1.owner-hash',
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    },
    lock: <T>(run: () => Promise<T>) => {
      const result = queue.catch(() => {}).then(run);
      queue = result;
      return result;
    },
    current: () => {
      if (!current) throw new Error('登录态已切换');
    },
    uuid: () => {
      issued++;
      return REQUEST_ID;
    },
    api: {
      options: async () => options,
      receipt: async (request) =>
        saved.has(request.requestId)
          ? {
              state: 'saved',
              id: request.requestId,
              origin: request.origin,
              expiresAt: 1_700_010_000_000,
            }
          : { state: 'missing' },
      save: async (request) => {
        if (!data.size) throw new Error('intent not durable before request');
        posted.push(structuredClone(request));
        saved.set(request.requestId, structuredClone(request));
        if (dropSave) throw new Error('response lost');
        return {
          id: request.requestId,
          origin: request.origin,
          status: 'connected',
          expiresAt: 1_700_010_000_000,
        };
      },
      cancel: async () => {
        if (dropCancel) throw new Error('cancel response lost');
        return { state: 'cancelled' };
      },
      select: async () => ({}),
      forget: async () => ({}),
    },
  };
  return {
    deps,
    data,
    saved,
    posted,
    journal: new HomeProfileJournal(deps),
    issued: () => issued,
    changeActor: () => {
      current = false;
    },
    loseSave: () => {
      dropSave = true;
    },
    loseCancel: () => {
      dropCancel = true;
    },
  };
}
describe('owned Home save intent in the actual browser storage boundary', () => {
  it('persists one immutable highlevel intent before submitting and removes it only after a known receipt', async () => {
    const f = fixture();
    const result = await f.journal.save(options, true);
    expect(result.receipt).toMatchObject({
      state: 'saved',
      id: REQUEST_ID,
      origin: 'https://fixture.test',
    });
    expect(f.posted).toEqual([
      {
        consent: 'cloud-browser-profile-v1',
        requestId: REQUEST_ID,
        sourceId: SOURCE_ID,
        origin: 'https://fixture.test',
        requestedAt: 1_700_000_000_000,
        clearEpoch: 0,
        includeStorage: true,
      },
    ]);
    expect(f.data.size).toBe(0);
    expect(f.saved.size).toBe(1);
  });
  it('after a lost response and reload, queries the old receipt without recapturing the new page', async () => {
    const f = fixture();
    f.loseSave();
    await expect(f.journal.save(options, true)).rejects.toThrow('response lost');
    const stored = [...f.data.values()][0]!;
    expect(stored).toContain(SOURCE_ID);
    expect(stored).not.toMatch(/access_token|Bearer|cookie|\/account|password/);
    const reloaded = new HomeProfileJournal(f.deps);
    expect((await reloaded.inspect()).receipt).toMatchObject({ state: 'saved', id: REQUEST_ID });
    expect(f.posted).toHaveLength(1);
    expect(f.issued()).toBe(1);
    expect(f.data.size).toBe(0);
  });
  it('an unknown old request blocks a new source until cancellation is confirmed', async () => {
    const f = fixture();
    f.loseSave();
    await expect(f.journal.save(options, false)).rejects.toThrow('response lost');
    f.saved.clear();
    const changed = {
      ...options,
      source: {
        ...options.source!,
        sourceId: 'be52fe57-1dd1-4562-828d-afcb84b0c96f',
        origin: 'https://other.test',
      },
    };
    expect((await new HomeProfileJournal(f.deps).save(changed, true)).receipt).toEqual({
      state: 'missing',
    });
    expect(f.posted).toHaveLength(1);
    expect(f.issued()).toBe(1);
    f.loseCancel();
    await expect(f.journal.cancel()).rejects.toThrow('cancel response lost');
    expect(f.data.size).toBe(1);
  });
  it('two panels reconcile the same unresolved operation under the shared storage lock', async () => {
    const f = fixture();
    f.loseSave();
    const first = f.journal.save(options, true);
    const second = new HomeProfileJournal(f.deps).save(options, true);
    await expect(first).rejects.toThrow('response lost');
    expect((await second).receipt?.state).toBe('saved');
    expect(f.posted).toHaveLength(1);
    expect(f.saved.size).toBe(1);
  });
  it('actor change after a network effect retains the original owner record for reconciliation', async () => {
    const f = fixture();
    const save = f.deps.api.save;
    f.deps.api.save = async (request) => {
      const result = await save(request);
      f.changeActor();
      return result;
    };
    await expect(f.journal.save(options, true)).rejects.toThrow('登录态已切换');
    expect(f.data.size).toBe(1);
    expect(f.saved.size).toBe(1);
  });
  it('corrupt or state-bearing local metadata cannot be overwritten by a new request', async () => {
    const f = fixture();
    f.data.set(
      f.deps.key,
      JSON.stringify({ version: 1, request: { ...options, cookies: ['PRIVATE'] } }),
    );
    const before = f.data.get(f.deps.key);
    await expect(f.journal.save(options, true)).rejects.toThrow();
    expect(f.data.get(f.deps.key)).toBe(before);
    expect(f.posted).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  type UserFileClosureRow,
  type UserFileClosureStore,
  closureFileCategoryForMimetype,
  deleteUserFilesPage,
} from './file-service.js';
import type { StorageProvider } from './storage-provider.js';

describe('account closure file deletion', () => {
  it('deletes 205 objects before their rows in three pages of at most 100 without fetching', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => fileRow(index + 1, 'image/png'));
    const events: string[] = [];
    const store = new MemoryClosureStore(rows, events);
    const storage = fakeStorage(events, new Set(['/objects/17']));
    let afterId: number | undefined;
    const pageSizes: number[] = [];

    for (let call = 0; call < 3; call += 1) {
      const result = await deleteUserFilesPage(
        {
          userIdInternal: 7,
          ...(afterId === undefined ? {} : { afterId }),
          limit: 100,
          categoryId: 'media_assets',
        },
        { store, storage },
      );
      pageSizes.push(result.deleted);
      afterId = result.nextAfterId ?? undefined;
      expect(result.done).toBe(call === 2);
    }

    expect(pageSizes).toEqual([100, 100, 5]);
    expect(store.rows).toHaveLength(0);
    expect(storage.delete).toHaveBeenCalledTimes(205);
    expect(storage.get).not.toHaveBeenCalled();
    expect(events).toContain('missing:17');
    for (let id = 1; id <= 205; id += 1) {
      expect(events.indexOf(`object:${id}`)).toBeLessThan(events.indexOf(`row:${id}`));
    }
  });

  it('keeps object 51 and its row at the failed checkpoint, then retries it once successfully', async () => {
    const events: string[] = [];
    const rows = Array.from({ length: 205 }, (_, index) => fileRow(index + 1, 'image/png'));
    const store = new MemoryClosureStore(rows, events);
    const storage = fakeStorage(events);
    const successes = new Map<number, number>();
    let first51 = true;
    vi.mocked(storage.delete).mockImplementation(async (path) => {
      const id = Number(path.split('/').at(-1));
      events.push(`object:${id}`);
      if (id === 51 && first51) {
        first51 = false;
        throw new Error('test timeout');
      }
      successes.set(id, (successes.get(id) ?? 0) + 1);
    });

    const durableAfterId: number | undefined = undefined;
    await expect(
      deleteUserFilesPage(
        {
          userIdInternal: 7,
          limit: 100,
          categoryId: 'media_assets',
        },
        { store, storage },
      ),
    ).rejects.toThrow('test timeout');

    expect(store.rows.some((row) => row.id === 51)).toBe(true);
    expect(store.rows.some((row) => row.id === 50)).toBe(false);
    expect(durableAfterId).toBeUndefined();

    const retry = await deleteUserFilesPage(
      {
        userIdInternal: 7,
        ...(durableAfterId === undefined ? {} : { afterId: durableAfterId }),
        limit: 100,
        categoryId: 'media_assets',
      },
      { store, storage },
    );
    expect(retry).toEqual({ nextAfterId: 150, deleted: 100, done: false });
    expect(successes.get(51)).toBe(1);
    for (let id = 1; id <= 50; id += 1) expect(successes.get(id)).toBe(1);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('aborts a hanging closure object delete and keeps its database row', async () => {
    const events: string[] = [];
    const store = new MemoryClosureStore([fileRow(1, 'image/png')], events);
    const storage = fakeStorage(events);
    vi.mocked(storage.delete).mockImplementation(
      async (_path: string, options?: { signal?: AbortSignal }) => {
        if (!options?.signal) throw new Error('missing closure abort signal');
        await new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    );

    await expect(
      deleteUserFilesPage(
        { userIdInternal: 7, limit: 100, categoryId: 'media_assets' },
        { store, storage, deleteTimeoutMs: 5 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.rows).toHaveLength(1);
    expect(events).not.toContain('row:1');
  });

  it('combines lease cancellation with the object timeout and keeps its database row', async () => {
    const events: string[] = [];
    const store = new MemoryClosureStore([fileRow(1, 'image/png')], events);
    const storage = fakeStorage(events);
    let observedSignal: AbortSignal | undefined;
    let started!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(storage.delete).mockImplementation(async (_path, options) => {
      observedSignal = options?.signal;
      started();
      await new Promise<never>((_resolve, reject) => {
        observedSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('lease lost', 'AbortError')),
          { once: true },
        );
      });
    });
    const controller = new AbortController();
    const deletion = deleteUserFilesPage(
      { userIdInternal: 7, limit: 100, categoryId: 'media_assets' },
      { store, storage, deleteTimeoutMs: 60_000, signal: controller.signal },
    );
    await deleteStarted;
    controller.abort();

    await expect(deletion).rejects.toMatchObject({ name: 'AbortError' });
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(events).not.toContain('row:1');
  });

  it('partitions media and task files exclusively, assigning null and non-standard MIME conservatively', async () => {
    expect(closureFileCategoryForMimetype(null)).toBe('task_execution');
    expect(closureFileCategoryForMimetype('application/x-private')).toBe('task_execution');
    expect(closureFileCategoryForMimetype(' image/png')).toBe('task_execution');
    expect(closureFileCategoryForMimetype('IMAGE/PNG')).toBe('media_assets');

    const events: string[] = [];
    const store = new MemoryClosureStore(
      [
        fileRow(1, 'image/png'),
        fileRow(2, 'video/mp4'),
        fileRow(3, 'audio/wav'),
        fileRow(4, 'application/pdf'),
        fileRow(5, 'application/x-private'),
        fileRow(6, ''),
        fileRow(7, null),
      ],
      events,
    );
    const storage = fakeStorage(events);

    await expect(
      deleteUserFilesPage(
        { userIdInternal: 7, limit: 100, categoryId: 'media_assets' },
        { store, storage },
      ),
    ).resolves.toEqual({ nextAfterId: null, deleted: 3, done: true });
    await expect(
      deleteUserFilesPage(
        { userIdInternal: 7, limit: 100, categoryId: 'task_execution' },
        { store, storage },
      ),
    ).resolves.toEqual({ nextAfterId: null, deleted: 4, done: true });

    expect(store.rows).toHaveLength(0);
    expect(events.filter((event) => event.startsWith('object:'))).toEqual([
      'object:1',
      'object:2',
      'object:3',
      'object:4',
      'object:5',
      'object:6',
      'object:7',
    ]);
  });
});

function fileRow(id: number, mimetype: string | null): UserFileClosureRow {
  return { id, userId: 7, storagePath: `/objects/${id}`, mimetype };
}

class MemoryClosureStore implements UserFileClosureStore {
  constructor(
    public rows: UserFileClosureRow[],
    private readonly events: string[],
  ) {}

  async listOwnedPage(input: {
    userIdInternal: number;
    afterId: number;
    limit: number;
    categoryId: 'task_execution' | 'media_assets';
  }): Promise<UserFileClosureRow[]> {
    return this.rows
      .filter(
        (row) =>
          row.userId === input.userIdInternal &&
          row.id > input.afterId &&
          closureFileCategoryForMimetype(row.mimetype) === input.categoryId,
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, input.limit);
  }

  async deleteOwnedRow(input: {
    id: number;
    userIdInternal: number;
    categoryId: 'task_execution' | 'media_assets';
  }): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) =>
        row.id === input.id &&
        row.userId === input.userIdInternal &&
        closureFileCategoryForMimetype(row.mimetype) === input.categoryId,
    );
    if (index < 0) return false;
    this.events.push(`row:${input.id}`);
    this.rows.splice(index, 1);
    return true;
  }
}

function fakeStorage(events: string[], missing = new Set<string>()): StorageProvider {
  return {
    pathFor: vi.fn(),
    put: vi.fn(),
    putFile: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(async (path: string) => {
      const id = Number(path.split('/').at(-1));
      events.push(`object:${id}`);
      if (missing.has(path)) events.push(`missing:${id}`);
    }),
    getSignedUrl: vi.fn(),
    getSignedPutUrl: vi.fn(),
    stat: vi.fn(),
  };
}

import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ storage: {} as { stat: ReturnType<typeof vi.fn> } }));
vi.mock('../../files/storage-provider.js', async (original) => ({
  ...(await original<object>()),
  getSharedStorageProvider: () => fixture.storage,
}));
import { __filesRouterInternals, filesRouter } from './files.js';

function rows(
  paths = [
    'usr_owner/input/file_present/a.png',
    '/tmp/holaday-files/usr_owner/input/file_missing/a.png',
    '/tmp/holaday-files/usr_owner/input/file_denied/a.png',
  ],
) {
  return paths.map((storagePath, index) => ({
    id: 100 - index,
    externalId: `file_${index}`,
    userId: 7,
    kind: 'input',
    status: 'active',
    expiresAt: null,
    storagePath,
    filename: `${index}.png`,
    mimetype: 'image/png',
    sizeBytes: 1,
    createdAt: new Date(),
  }));
}
function caller(files = rows(), owner = 'usr_owner') {
  const db = {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: () => ({
          limit: async () => [{ id: 7 }],
          orderBy: () => ({
            limit: async () => (getTableName(table) === 'task_files' ? files : []),
          }),
        }),
      }),
    }),
  };
  return filesRouter.createCaller({
    userId: owner,
    req: {},
    db,
    logger: { warn: vi.fn() },
  } as never);
}
beforeEach(() => {
  vi.useRealTimers();
  fixture.storage = {
    stat: vi.fn(async (key: string) => {
      if (key.includes('missing')) return null;
      if (key.includes('denied')) throw new Error('AccessDenied');
      return { sizeBytes: 1 };
    }),
  };
});

describe('file list metadata and legacy availability contract', () => {
  it('does not HEAD current object keys, retains confirmed legacy missing labels and never exposes paths', async () => {
    const result = await caller().list({ limit: 3 });
    expect(result.items.map((item) => item.availability)).toEqual([
      'unknown',
      'unavailable',
      'unknown',
    ]);
    expect(result.items.map((item) => item.fileId)).toEqual(['file_0', 'file_1', 'file_2']);
    expect(JSON.stringify(result)).not.toContain('storagePath');
    expect(fixture.storage.stat.mock.calls.map((call) => call[0])).not.toContain(
      'usr_owner/input/file_present/a.png',
    );
  });
  it('keeps pagination based on metadata rows when a legacy file has no bytes', async () => {
    const result = await caller().list({ limit: 2 });
    expect(result.items.map((item) => item.fileId)).toEqual(['file_0', 'file_1']);
    expect(result.items[1]?.availability).toBe('unavailable');
    expect(result.nextCursor).toBe(99);
  });
  it('serves 50 current keys without waiting for storage, including an unavailable storage service', async () => {
    fixture.storage.stat = vi.fn(() => {
      throw new Error('Storage must not be consulted');
    });
    const result = await caller(
      rows(Array.from({ length: 50 }, (_, i) => `usr_owner/input/file_${i}/a.png`)),
    ).list({ limit: 50 });
    expect(result.items).toHaveLength(50);
    expect(result.items.every((item) => item.availability === 'unknown')).toBe(true);
    expect(fixture.storage.stat).not.toHaveBeenCalled();
  });
  it('reuses legacy missing evidence briefly, isolates owners, and rechecks after expiry', async () => {
    vi.useFakeTimers();
    const files = rows(['/tmp/holaday-files/usr_owner/input/file_missing/a.png']);
    expect((await caller(files).list()).items[0]?.availability).toBe('unavailable');
    fixture.storage.stat.mockImplementation(async () => ({ sizeBytes: 1 }));
    expect((await caller(files).list()).items[0]?.availability).toBe('unavailable');
    expect((await caller(files, 'usr_other').list()).items[0]?.availability).toBe('available');
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await caller(files).list()).items[0]?.availability).toBe('available');
  });
  it('bounds concurrent requests across lists and returns unknown within 500ms when HEAD never settles', async () => {
    // Storage is intentionally stalled; the response must not wait for all old objects.
    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    fixture.storage.stat = vi.fn(
      () =>
        new Promise((resolve) => {
          peak = Math.max(peak, ++active);
          pending.push(() => {
            --active;
            resolve({ sizeBytes: 1 });
          });
        }),
    );
    const files = rows(
      Array.from({ length: 50 }, (_, i) => `/tmp/holaday-files/usr_owner/input/file_${i}/a.png`),
    );
    const start = performance.now();
    const pages = await Promise.all([
      caller(files).list({ limit: 50 }),
      caller(files).list({ limit: 50 }),
    ]);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(peak).toBeLessThanOrEqual(5);
    expect(pages.every((page) => page.items.every((item) => item.availability === 'unknown'))).toBe(
      true,
    );
    // Requests ignoring cancellation still occupy their slots: no hidden fan-out on refresh.
    expect(
      (await caller(files).list({ limit: 50 })).items.every(
        (item) => item.availability === 'unknown',
      ),
    ).toBe(true);
    expect(peak).toBeLessThanOrEqual(5);
    for (const resolve of pending) resolve();
  });
  it('does not convert permission errors into permanent missing evidence', async () => {
    const files = rows(['/tmp/holaday-files/usr_owner/input/file_denied/a.png']);
    expect((await caller(files).list()).items[0]?.availability).toBe('unknown');
    fixture.storage.stat.mockImplementation(async () => ({ sizeBytes: 1 }));
    expect((await caller(files).list()).items[0]?.availability).toBe('available');
  });
  it('reports inactive metadata as unavailable without a storage request', async () => {
    const files = rows();
    // biome-ignore lint/style/noNonNullAssertion: The default fixture creates three rows.
    files[0]!.status = 'expired';
    expect(
      await __filesRouterInternals.libraryAvailability(
        fixture.storage as never,
        files,
        'usr_owner',
      ),
    ).toEqual(['unavailable', 'unavailable', 'unknown']);
  });
});

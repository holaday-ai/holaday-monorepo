import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { FileService } from './file-service.js';
import type { StorageProvider } from './storage-provider.js';

function harness(initial: Record<string, unknown> | null, storageExists = true) {
  let row = initial;
  const update = vi.fn((values: Record<string, unknown>) => {
    row = row ? { ...row, ...values } : row;
    return Promise.resolve([{ affectedRows: row ? 1 : 0 }]);
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
      }),
    }),
    update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => update(values) }) }),
  } as unknown as DB;
  const storage = {
    stat: vi.fn(async () =>
      storageExists ? { sizeBytes: Number(row?.sizeBytes ?? 0), contentType: 'image/png' } : null,
    ),
  } as unknown as StorageProvider;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  return {
    service: new FileService(db, logger, storage),
    update,
    getRow: () => row,
  };
}

function outputRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    externalId: 'file_output',
    userId: 7,
    taskId: 9,
    kind: 'output',
    filename: 'result.png',
    mimetype: 'image/png',
    sizeBytes: 123,
    storagePath: 'usr/output/file_output/result.png',
    status: 'active',
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe('saveOutputToLibraryForUser', () => {
  it('reclassifies one readable owned output without copying storage', async () => {
    const { service, update, getRow } = harness(outputRow());

    await expect(service.saveOutputToLibraryForUser('file_output', 7)).resolves.toBe(true);

    expect(update).toHaveBeenCalledWith({ kind: 'input', expiresAt: null });
    expect(getRow()).toMatchObject({ kind: 'input', expiresAt: null });
  });

  it('is idempotent for an existing readable library input', async () => {
    const { service, update } = harness(outputRow({ kind: 'input', expiresAt: null }));

    await expect(service.saveOutputToLibraryForUser('file_output', 7)).resolves.toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign owner', outputRow({ userId: 8 }), true],
    ['expired output', outputRow({ expiresAt: new Date(Date.now() - 60_000) }), true],
    ['deleted object', outputRow(), false],
    ['temporary handoff', outputRow({ kind: 'temp' }), true],
    ['missing row', null, true],
  ])('rejects %s without mutating the row', async (_label, row, storageExists) => {
    const { service, update } = harness(row, storageExists);

    await expect(service.saveOutputToLibraryForUser('file_output', 7)).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

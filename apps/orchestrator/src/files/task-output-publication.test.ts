import { rm } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserTaskOutputs } from '../agent/browser-tools/browser-task-output.js';
import { browserOutputFixture } from './testing/browser-output-fixture.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const input = {
  userIdInternal: 7,
  userExternalId: 'usr_alice',
  taskIdInternal: 9,
  filename: 'screenshot.jpg',
  mimetype: 'image/jpeg',
  buffer: Buffer.from([255, 216, 255, 217]),
  requireLiveTask: true as const,
};

it('refuses a local cancellation before the task terminal row has been committed', async () => {
  const f = await browserOutputFixture();
  roots.push(f.root);
  let current = true;
  const put = f.storage.put.bind(f.storage);
  let path = '';
  vi.spyOn(f.storage, 'put').mockImplementation(async (args) => {
    const stored = await put(args);
    path = stored.storagePath;
    current = false;
    return stored;
  });
  await expect(f.service.storeOutput({ ...input, canPublish: () => current })).rejects.toThrow();
  expect(f.taskRecords[0]!.status).toBe('executing');
  expect(f.records).toEqual([]);
  expect(await f.storage.get(path)).toBeNull();
});

it('carries the cloud cancellation guard through generation into the real storage boundary', async () => {
  const f = await browserOutputFixture();
  roots.push(f.root);
  const abort = new AbortController();
  let drained!: () => void;
  const finished = new Promise<void>((resolve) => {
    drained = resolve;
  });
  const put = f.storage.put.bind(f.storage);
  vi.spyOn(f.storage, 'put').mockImplementation(async (args) => {
    const stored = await put(args);
    abort.abort();
    return stored;
  });
  const outputs = new BrowserTaskOutputs({
    formats: ['csv'],
    signal: abort.signal,
    current: async () => !abort.signal.aborted,
    store: async ({ filename, canPublish }) => {
      try {
        const row = await f.service.storeOutput({ ...input, filename, canPublish });
        return {
          fileId: row.externalId,
          filename,
          size: row.sizeBytes,
          downloadUrl: `/api/files/${row.externalId}/download`,
        };
      } finally {
        drained();
      }
    },
  });
  expect(
    await outputs.create({ filename: 'result.csv', format: 'csv', content: 'a,1' }),
  ).toMatchObject({ ok: false });
  // The runner can stop before its uninterruptible storage callback drains.
  await finished;
  expect(f.records).toEqual([]);
});

it.each(['cancelled', 'paused', 'completed'])(
  'does not publish after task becomes %s during storage',
  async (status) => {
    const f = await browserOutputFixture();
    roots.push(f.root);
    const put = f.storage.put.bind(f.storage);
    let path = '';
    let externalId = '';
    vi.spyOn(f.storage, 'put').mockImplementation(async (args) => {
      const stored = await put(args);
      path = stored.storagePath;
      externalId = args.fileExternalId;
      f.taskRecords[0]!.status = status;
      return stored;
    });
    await expect(f.service.storeOutput(input)).rejects.toThrow();
    expect(f.records).toEqual([]);
    expect(await f.storage.get(path)).toBeNull();
    expect(await f.service.loadForUser(externalId, 7)).toBeNull();
  },
);

it.each(['owner closed', 'task changed owner'])('refuses %s at publication', async (change) => {
  const f = await browserOutputFixture();
  roots.push(f.root);
  const put = f.storage.put.bind(f.storage);
  vi.spyOn(f.storage, 'put').mockImplementation(async (args) => {
    const stored = await put(args);
    if (change === 'owner closed') f.faults.ownerStatus = 'closing';
    else f.taskRecords[0]!.userId = 8;
    return stored;
  });
  await expect(f.service.storeOutput(input)).rejects.toThrow();
  expect(f.records).toEqual([]);
});

it('recovers a committed output after the transaction receipt is lost', async () => {
  const f = await browserOutputFixture();
  roots.push(f.root);
  f.faults.insert = 'after';
  const row = await f.service.storeOutput(input);
  expect(f.records).toHaveLength(1);
  expect((await f.service.loadForUser(row.externalId, 7))?.buffer).toEqual(input.buffer);
});

it('retains the committed bytes when the file index read is uncertain', async () => {
  const f = await browserOutputFixture();
  roots.push(f.root);
  f.faults.read = true;
  await expect(f.service.storeOutput(input)).rejects.toThrow('browser_file_save_unconfirmed');
  expect(f.records).toHaveLength(1);
  f.faults.read = false;
  expect((await f.service.loadForUser(String(f.records[0]!.externalId), 7))?.buffer).toEqual(
    input.buffer,
  );
});

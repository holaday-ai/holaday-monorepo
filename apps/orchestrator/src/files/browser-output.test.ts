/** Actual Chromium Download -> stream verifier -> FileService -> real local bytes. SQL is doubled. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { pino } from 'pino';
import { type Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { persistBrowserDownload } from '../agent/browser-tools/browser-download.js';
import type { DB } from '../db/client.js';
import { taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { FileService, outputFileTtlMs } from './file-service.js';
import { LocalStorageProvider } from './storage-provider.js';

const logger = pino({ level: 'silent' });
const SOURCE = {
  version: 1 as const,
  kind: 'personal_home' as const,
  sessionId: 'bhs_usr_alice',
  instanceId: '9f76fe69-c29e-400e-ac94-5c223646c48a',
  origin: 'https://fixture.test',
  taskId: null as string | null,
};
const PAYLOAD = Buffer.from('item,count\nalpha,2\n');
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex');
let browser: Browser;
const roots: string[] = [];
beforeAll(async () => {
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ba-browser-files-'));
  roots.push(root);
  const records: Array<Record<string, unknown>> = [];
  const faults = {
    insert: 'none' as 'none' | 'before' | 'after' | 'unknown',
    read: false,
    reorder: false,
    ownerStatus: 'active',
  };
  const dialect = new MySqlDialect();
  function matches(row: Record<string, unknown>, query: SQL) {
    const compiled = dialect.sqlToQuery(query);
    const columns = [...compiled.sql.matchAll(/`\w+`\.`(\w+)`\s*=\s*\?/g)];
    if (columns.length !== compiled.params.length) throw new Error('Unsupported fixture predicate');
    return columns.every((match, i) => {
      const name = match[1]!.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return row[name] === compiled.params[i];
    });
  }
  const db = {
    insert: (table: unknown) => ({
      values: async (data: Record<string, unknown>) => {
        if (table !== taskFiles) throw new Error('Unexpected insert table');
        if (faults.insert === 'before')
          throw Object.assign(new Error('synthetic DB insert rejected'), {
            code: 'ER_NO_REFERENCED_ROW_2',
          });
        if (faults.insert === 'unknown') throw new Error('synthetic write outcome unknown');
        if (faults.reorder && data.browserSource) {
          data = {
            ...data,
            browserSource: Object.fromEntries(
              Object.entries(data.browserSource).sort(([a], [b]) => a.localeCompare(b)),
            ),
          };
        }
        records.push({ id: records.length + 1, status: 'active', createdAt: new Date(), ...data });
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: (query: SQL) => ({
          limit: (count: number) => {
            const result = Promise.resolve().then(() => {
              if (table === taskFiles && faults.read)
                throw new Error('synthetic DB read unavailable');
              const rows =
                table === taskFiles
                  ? records
                  : table === users
                    ? [
                        { id: 7, externalId: 'usr_alice', status: faults.ownerStatus },
                        { id: 8, externalId: 'usr_bob', status: 'active' },
                      ]
                    : table === tasks
                      ? [
                          { id: 9, externalId: 'tsk_alice', userId: 7 },
                          { id: 10, externalId: 'tsk_bob', userId: 8 },
                        ]
                      : (() => {
                          throw new Error('Unexpected select table');
                        })();
              return rows.filter((row) => matches(row, query)).slice(0, count);
            });
            return Object.assign(result, {
              for: (mode: string) => {
                if (mode !== 'update') throw new Error('Unexpected fixture lock');
                return result;
              },
            });
          },
        }),
      }),
    }),
    transaction: async (change: (tx: DB) => Promise<unknown>) => {
      const result = await change(db);
      if (faults.insert === 'after') throw new Error('synthetic transaction receipt lost');
      return result;
    },
  } as unknown as DB;
  const storage = new LocalStorageProvider(root, logger);
  return { service: new FileService(db, logger, storage), records, faults, storage, root };
}
function input(source = SOURCE) {
  return {
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    source,
    filename: 'report.csv',
    mimetype: 'text/csv',
    buffer: PAYLOAD,
  };
}

describe('Personal Home file bytes and provenance', () => {
  it('persists an actual downloaded CSV without inventing a task, and reloads its exact bytes', async () => {
    const f = await fixture();
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const page = await context.newPage();
      await page.route('https://fixture.test/**', (route) =>
        route.fulfill(
          route.request().url().endsWith('/report.csv')
            ? {
                contentType: 'text/csv',
                headers: { 'content-disposition': 'attachment; filename="report.csv"' },
                body: PAYLOAD,
              }
            : {
                contentType: 'text/html',
                body: '<a id="export" href="/report.csv">Export CSV</a>',
              },
        ),
      );
      await page.goto('https://fixture.test/');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#export').click(),
      ]);
      const before = Date.now();
      const receipt = await persistBrowserDownload(download, async ({ filename, buffer }) => {
        const row = await f.service.storeBrowserOutput({ ...input(), filename, buffer });
        return {
          fileId: row.externalId,
          filename: row.filename,
          sizeBytes: row.sizeBytes,
          sha256: row.browserSource!.sha256,
          downloadUrl: `/api/files/${row.externalId}/download`,
        };
      });
      expect(receipt.sha256).toBe(DIGEST);
      expect(f.records).toHaveLength(1);
      const row = f.records[0]!;
      expect(row.taskId).toBeNull();
      expect(row.browserSource).toEqual({ ...SOURCE, sha256: DIGEST });
      expect((row.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(before + outputFileTtlMs());
      const loaded = await f.service.loadForUser(receipt.fileId, 7);
      expect(loaded?.buffer.toString()).toBe('item,count\nalpha,2\n');
      expect(loaded?.buffer.equals(PAYLOAD)).toBe(true);
      expect(await f.service.loadForUser(receipt.fileId, 8)).toBeNull();
      expect(JSON.stringify(row.browserSource)).not.toContain('report.csv');
    } finally {
      await context.close();
    }
  });

  it('links a lent Home output to the real owned task and preserves the Home instance origin', async () => {
    const f = await fixture();
    const row = await f.service.storeBrowserOutput(input({ ...SOURCE, taskId: 'tsk_alice' }));
    expect(row.taskId).toBe(9);
    expect(row.browserSource).toEqual({ ...SOURCE, taskId: 'tsk_alice', sha256: DIGEST });
    expect((await f.service.loadForUser(row.externalId, 7))?.buffer.equals(PAYLOAD)).toBe(true);
  });

  it.each([
    ['foreign task', { ...SOURCE, taskId: 'tsk_bob' }],
    ['missing task', { ...SOURCE, taskId: 'tsk_missing' }],
    ['foreign session', { ...SOURCE, sessionId: 'bhs_usr_bob' }],
    ['sensitive URL path', { ...SOURCE, origin: 'https://fixture.test/export?token=SYNTHETIC' }],
    ['credentials in URL', { ...SOURCE, origin: 'https://user:SYNTHETIC@fixture.test' }],
    ['invalid instance', { ...SOURCE, instanceId: 'not-an-instance' }],
  ])('rejects %s before creating a file', async (_label, source) => {
    const f = await fixture();
    await expect(f.service.storeBrowserOutput(input(source))).rejects.toThrow();
    expect(f.records).toEqual([]);
    await expect(readFile(join(f.root, 'usr_alice'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a mismatched internal account and empty content', async () => {
    const f = await fixture();
    await expect(f.service.storeBrowserOutput({ ...input(), userIdInternal: 8 })).rejects.toThrow();
    await expect(
      f.service.storeBrowserOutput({ ...input(), buffer: Buffer.alloc(0) }),
    ).rejects.toThrow();
    expect(f.records).toEqual([]);
  });

  it('reconciles a lost insertion receipt against the original committed file', async () => {
    const f = await fixture();
    f.faults.insert = 'after';
    const row = await f.service.storeBrowserOutput(input());
    expect(f.records).toHaveLength(1);
    expect(row.externalId).toBe(f.records[0]!.externalId);
    expect((await f.service.loadForUser(row.externalId, 7))?.buffer.equals(PAYLOAD)).toBe(true);
  });

  it('refuses a download for an account already closing', async () => {
    const f = await fixture();
    f.faults.ownerStatus = 'closure_processing';
    await expect(f.service.storeBrowserOutput(input())).rejects.toThrow();
    expect(f.records).toEqual([]);
    await expect(readFile(join(f.root, 'usr_alice'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not insert a late file after account closure starts during storage', async () => {
    const f = await fixture();
    const paths: string[] = [];
    const put = f.storage.put.bind(f.storage);
    vi.spyOn(f.storage, 'put').mockImplementation(async (data) => {
      const result = await put(data);
      paths.push(result.storagePath);
      f.faults.ownerStatus = 'closure_processing';
      return result;
    });
    await expect(f.service.storeBrowserOutput(input())).rejects.toThrow();
    expect(f.records).toEqual([]);
    await expect(readFile(paths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recognizes committed provenance regardless of JSON object member order', async () => {
    const f = await fixture();
    f.faults.reorder = true;
    const row = await f.service.storeBrowserOutput(input());
    expect(row.browserSource).toEqual({ ...SOURCE, sha256: DIGEST });
    expect((await f.service.loadForUser(row.externalId, 7))?.buffer.equals(PAYLOAD)).toBe(true);
  });

  it('keeps bytes when the write is uncertain even if an immediate read finds no row', async () => {
    const f = await fixture();
    const paths: string[] = [];
    const put = f.storage.put.bind(f.storage);
    vi.spyOn(f.storage, 'put').mockImplementation(async (data) => {
      const result = await put(data);
      paths.push(result.storagePath);
      return result;
    });
    f.faults.insert = 'unknown';
    await expect(f.service.storeBrowserOutput(input())).rejects.toThrow(
      'browser_file_save_unconfirmed',
    );
    expect(f.records).toEqual([]);
    expect((await readFile(paths[0]!)).equals(PAYLOAD)).toBe(true);
  });

  it('does not publish a saved receipt when the backing bytes differ from the download', async () => {
    const f = await fixture();
    const put = f.storage.put.bind(f.storage);
    vi.spyOn(f.storage, 'put').mockImplementation(async (data) => {
      const result = await put(data);
      await writeFile(result.storagePath, Buffer.from('changed before save receipt'));
      return result;
    });
    await expect(f.service.storeBrowserOutput(input())).rejects.toThrow(
      'browser_file_save_unconfirmed',
    );
    expect(f.records).toHaveLength(1);
    expect(await f.service.loadForUser(f.records[0]!.externalId as string, 7)).toBeNull();
  });

  it('refuses oversized content before creating storage or a file row', async () => {
    const f = await fixture();
    await expect(
      f.service.storeBrowserOutput({ ...input(), buffer: Buffer.alloc(50 * 1024 * 1024 + 1) }),
    ).rejects.toThrow('browser_file_size_invalid');
    expect(f.records).toEqual([]);
    await expect(readFile(join(f.root, 'usr_alice'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not delete possibly committed bytes when both insertion and its read receipt are unknown', async () => {
    const f = await fixture();
    f.faults.insert = 'after';
    f.faults.read = true;
    await expect(f.service.storeBrowserOutput(input())).rejects.toThrow(
      'browser_file_save_unconfirmed',
    );
    expect(f.records).toHaveLength(1);
    expect((await readFile(f.records[0]!.storagePath as string)).equals(PAYLOAD)).toBe(true);
    f.faults.read = false;
    expect(
      (await f.service.loadForUser(f.records[0]!.externalId as string, 7))?.buffer.equals(PAYLOAD),
    ).toBe(true);
  });

  it('compensates a definitively rejected insert without publishing a file', async () => {
    const f = await fixture();
    const paths: string[] = [];
    const put = f.storage.put.bind(f.storage);
    vi.spyOn(f.storage, 'put').mockImplementation(async (data) => {
      const result = await put(data);
      paths.push(result.storagePath);
      return result;
    });
    f.faults.insert = 'before';
    await expect(f.service.storeBrowserOutput(input())).rejects.toThrow();
    expect(f.records).toEqual([]);
    expect(paths).toHaveLength(1);
    await expect(readFile(paths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an expired, missing or corrupt saved file at the actual read boundary', async () => {
    const f = await fixture();
    const row = await f.service.storeBrowserOutput(input());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T20:00:00Z'));
    f.records[0]!.expiresAt = new Date('2026-11-16T20:00:00Z');
    expect(await f.service.loadForUser(row.externalId, 7)).toBeNull();
    vi.useRealTimers();
    f.records[0]!.expiresAt = new Date(Date.now() + 60_000);
    await writeFile(row.storagePath, Buffer.from('tampered bytes'));
    expect(await f.service.loadForUser(row.externalId, 7)).toBeNull();
    expect(await f.service.isReadableForUser(row.externalId, 7)).toBe(false);
    expect(await f.service.getScopedPreviewForUser(row.externalId, 7)).toBeNull();
    expect(await f.service.loadMany([row.externalId], 7)).toEqual([]);
    await unlink(row.storagePath);
    expect(await f.service.loadForUser(row.externalId, 7)).toBeNull();
  });
});

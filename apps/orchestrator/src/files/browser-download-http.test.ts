import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import express from 'express';
import { type Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { persistTaskBrowserDownload } from '../agent/browser-tools/browser-download.js';
import { signAccessToken } from '../auth/jwt.js';
import type { DB } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { createHttpApp } from '../http.js';
import { createBrowserTaskFileScope } from './browser-task-file-scope.js';
import * as storage from './storage-provider.js';
import { browserOutputFixture } from './testing/browser-output-fixture.js';

const boundary = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock('../db/client.js', () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (!boundary.current) throw new Error('No synthetic HTTP database installed');
        const value = Reflect.get(boundary.current, key);
        return typeof value === 'function' ? value.bind(boundary.current) : value;
      },
    },
  ),
  pool: { end: async () => {} },
}));

const bytes = Buffer.from('sku,qty\nORIGINAL-HTTP-731,31\n');
const digest = createHash('sha256').update(bytes).digest('hex');
let browser: Browser;
let website: Server;
let site: string;
let requests = 0;
const servers: Server[] = [];
const roots: string[] = [];

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test HTTP address');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
beforeAll(async () => {
  browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  website = createServer((request, response) => {
    if (request.url === '/original?ticket=SYNTHETIC-731') {
      requests++;
      response.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="report.csv"',
      });
      response.end(bytes);
    } else {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<a id="export" href="/original?ticket=SYNTHETIC-731">Export report</a>');
    }
  });
  site = await listen(website);
});
afterEach(async () => {
  for (const server of servers.splice(0)) await close(server);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  boundary.current = null;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await browser?.close();
  if (website) await close(website);
});

async function fixture() {
  const f = await browserOutputFixture();
  roots.push(f.root);
  const database = new Proxy(f.db, {
    get(target, key) {
      if (key !== 'select') return Reflect.get(target, key);
      return (...args: Parameters<DB['select']>) => {
        const query = Reflect.apply(target.select, target, args);
        return {
          from(table: unknown) {
            const from = query.from(table as never);
            if (table !== users) return from;
            return {
              where(condition: Parameters<typeof from.where>[0]) {
                const filtered = from.where(condition);
                return {
                  async limit(count: number) {
                    const rows = await filtered.limit(count);
                    return rows.map((row: Record<string, unknown>) => ({
                      ...row,
                      authVersion: 0,
                      plan: 'pro',
                    }));
                  },
                };
              },
            };
          },
        };
      };
    },
  });
  boundary.current = database;
  vi.spyOn(storage, 'getSharedStorageProvider').mockReturnValue(f.storage);
  // The production reverse proxy provides /api; route and bearer middleware
  // are the real createHttpApp implementations, not rewritten test handlers.
  const gateway = express().use('/api', createHttpApp({ planner: {} as never }));
  const server = createServer(gateway);
  servers.push(server);
  const origin = await listen(server);
  const alice = await signAccessToken({ sub: 'usr_alice', plan: 'pro' });
  const bob = await signAccessToken({ sub: 'usr_bob', plan: 'pro' });
  return { ...f, origin, alice, bob };
}

async function savedTaskDownload(f: Awaited<ReturnType<typeof fixture>>) {
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    await page.goto(site);
    const before = requests;
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#export').click(),
    ]);
    const receipt = await persistTaskBrowserDownload(
      download,
      f,
      async ({ filename, buffer, sha256, source }) => {
        if (!source) throw new Error('Original task source missing');
        const row = await f.service.storeTaskBrowserOutput({
          userIdInternal: 7,
          userExternalId: 'usr_alice',
          source: { version: 1, kind: 'task_download', ...source },
          filename,
          buffer,
          mimetype: 'text/csv',
        });
        return {
          fileId: row.externalId,
          filename: row.filename,
          sizeBytes: row.sizeBytes,
          sha256,
          mimetype: row.mimetype,
          expiresAt: row.expiresAt!.toISOString(),
          downloadUrl: `/api/files/${row.externalId}/download`,
        };
      },
      undefined,
      'tsk_alice',
    );
    const scope = createBrowserTaskFileScope({
      db: f.db,
      files: f.service,
      taskId: 'tsk_alice',
      userId: 7,
      origin: 'user',
      inputs: [],
    });
    await scope.admitDownloaded(receipt);
    expect(scope.references()).toHaveLength(1);
    expect(requests - before).toBe(1);
    expect(receipt.sha256).toBe(digest);
    return receipt;
  } finally {
    await context.close();
  }
}
const get = (f: Awaited<ReturnType<typeof fixture>>, url: string, token?: string) =>
  fetch(`${f.origin}${url}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

it('serves original task download bytes only to the active owner through the actual authenticated HTTP route', async () => {
  const f = await fixture();
  const receipt = await savedTaskDownload(f);
  expect(f.records[0]!.browserSource).toEqual({
    version: 1,
    kind: 'task_download',
    taskId: 'tsk_alice',
    origin: site,
    originBasis: 'download_url',
    sha256: digest,
  });
  expect(await f.service.listBrowserOutputsForUser(7)).toEqual([]);
  const response = await get(f, receipt.downloadUrl, f.alice);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get('content-type')).toContain('text/csv');
  expect(response.headers.get('content-disposition')).toContain('attachment;');
  expect(response.headers.get('content-length')).toBe(String(bytes.length));
  expect((await get(f, receipt.downloadUrl)).status).toBe(401);
  expect((await get(f, `${receipt.downloadUrl}?token=${encodeURIComponent(f.alice)}`)).status).toBe(
    401,
  );
  expect((await get(f, receipt.downloadUrl, f.bob)).status).toBe(404);
  f.faults.ownerStatus = 'suspended';
  expect((await get(f, receipt.downloadUrl, f.alice)).status).toBe(401);
  f.faults.ownerStatus = 'active';
  f.records[0]!.expiresAt = new Date(Date.now() - 1);
  expect((await get(f, receipt.downloadUrl, f.alice)).status).toBe(404);
});

it('never serves changed bytes for an original task download whose hash was already delivered', async () => {
  const f = await fixture();
  const receipt = await savedTaskDownload(f);
  const row = f.records[0]!;
  await writeFile(String(row.storagePath), Buffer.alloc(bytes.length, 88));
  const response = await get(f, receipt.downloadUrl, f.alice);
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('XXXXXXXX');
});

it('keeps task download persistence bound to a real owned task and excludes Home-only provenance', async () => {
  const f = await fixture();
  const input = {
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    filename: 'report.csv',
    mimetype: 'text/csv',
    buffer: bytes,
    source: {
      version: 1 as const,
      kind: 'task_download' as const,
      taskId: 'tsk_bob',
      origin: site,
      originBasis: 'download_url' as const,
    },
  };
  await expect(f.service.storeTaskBrowserOutput(input)).rejects.toThrow(
    'browser_file_task_unavailable',
  );
  await expect(
    f.service.storeTaskBrowserOutput({
      ...input,
      source: { ...input.source, taskId: null } as never,
    }),
  ).rejects.toThrow();
  await expect(
    f.service.storeTaskBrowserOutput({
      ...input,
      source: {
        version: 1,
        kind: 'personal_home',
        sessionId: 'bhs_usr_alice',
        instanceId: '11111111-1111-4111-8111-111111111111',
        origin: site,
        taskId: null,
      } as never,
    }),
  ).rejects.toThrow();
  expect(f.records).toEqual([]);
});

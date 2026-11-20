import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { type Download, chromium } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import { persistTaskBrowserDownload } from './browser-download.js';
import { BrowserTaskFileReader, taskFileReadRequest } from './browser-task-file-reader.js';
import { BrowserTaskFiles } from './browser-task-files.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(buffer: Buffer, filename = 'report.csv', mimetype = 'text/csv') {
  const f = await browserOutputFixture();
  roots.push(f.root);
  let active = true;
  const row = await f.service.storeUpload({
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    filename,
    mimetype,
    buffer,
  });
  const scope = new BrowserTaskFiles({
    taskId: 'tsk_alice',
    userId: 7,
    files: f.service,
    active: async () => active,
  });
  scope.admitValidated(await f.service.loadMany([row.externalId], 7));
  return {
    ...f,
    row,
    scope,
    reader: new BrowserTaskFileReader(scope),
    revoke: () => {
      active = false;
    },
  };
}

describe('owned task file reading', () => {
  it.each(['http', 'blob', 'data'] as const)(
    'reads a native download-attribute export from an actual HTTP page (%s) with its exact saved bytes',
    async (kind) => {
      const buffer = Buffer.from('sku,qty\nNATIVE-731,31\n');
      const f = await fixture(Buffer.from('input,1'));
      const server = createServer((req, res) => {
        if (req.url === '/report.csv') {
          res.setHeader('content-type', 'text/csv');
          res.end(buffer);
        } else {
          res.setHeader('content-type', 'text/html');
          res.end(
            kind === 'http'
              ? '<a href="/report.csv" download="report.csv">Export</a>'
              : kind === 'data'
                ? `<a href="data:text/csv;charset=utf-8,${encodeURIComponent(buffer.toString())}" download="report.csv">Export</a>`
                : `<a download="report.csv">Export</a><script>document.querySelector('a').href=URL.createObjectURL(new Blob([${JSON.stringify(buffer.toString())}],{type:'text/csv'}));</script>`,
          );
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const browser = await chromium.launch({
        headless: true,
        args: ['--renderer-process-limit=2'],
      });
      const context = await browser.newContext({ acceptDownloads: true });
      try {
        const page = await context.newPage();
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        await page.goto(origin);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('a').click(),
        ]);
        const receipt = await persistTaskBrowserDownload(
          download,
          page,
          async ({ filename, buffer, sha256 }) => {
            const row = await f.service.storeOutput({
              userIdInternal: 7,
              userExternalId: 'usr_alice',
              taskIdInternal: 9,
              filename,
              mimetype: 'text/csv',
              buffer,
            });
            return {
              fileId: row.externalId,
              filename: row.filename,
              sizeBytes: buffer.length,
              sha256,
              downloadUrl: `/api/files/${row.externalId}/download`,
              mimetype: row.mimetype,
              expiresAt: row.expiresAt!.toISOString(),
            };
          },
          undefined,
          'tsk_alice',
        );
        await f.scope.admitDownloaded(receipt);
        const read = await f.reader.read({ fileId: receipt.fileId });
        expect(Buffer.from(read.text).equals(buffer)).toBe(true);
        expect(read.coverage.complete).toBe(true);
        expect(read.source).toMatchObject({ kind: 'browser_download', origin });
        expect(read.source).toMatchObject({
          originBasis: kind === 'data' ? 'owning_page' : 'download_url',
        });
      } finally {
        await context.close();
        await browser.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    30_000,
  );
  it('reads beyond the former 50k preview through actual storage without silently truncating', async () => {
    const text = `sku,qty\n${'A-100,1\n'.repeat(9000)}TAIL-731,31\n`;
    const f = await fixture(Buffer.from(text));
    const reads = [];
    let offset: number | null = 0;
    do {
      const read = await f.reader.read({ fileId: f.row.externalId, offset });
      reads.push(read);
      offset = read.nextOffset;
    } while (offset !== null);
    expect(reads.map((read) => read.text).join('')).toBe(text);
    expect(reads.at(-1)).toMatchObject({
      range: { totalChars: text.length },
      coverage: { complete: true, readChars: text.length },
      representation: 'utf8_text',
      websiteExportScope: 'not_applicable',
    });
    expect(reads[0]!.sha256).toBe(createHash('sha256').update(text).digest('hex'));
    expect(f.reader.incomplete()).toBe(false);
  });
  it('does not count EOF or overlapping reads as the missing middle; returned metadata cannot mutate host coverage', async () => {
    const text = `${'a'.repeat(20000)}TAIL`;
    const f = await fixture(Buffer.from(text));
    const last = await f.reader.read({ fileId: f.row.externalId, offset: 20000 });
    expect(last.nextOffset).toBeNull();
    expect(last.coverage.complete).toBe(false);
    last.coverage.ranges[0]![0] = 0;
    last.coverage.complete = true;
    const first = await f.reader.read({ fileId: f.row.externalId, offset: 0, maxChars: 10000 });
    expect(first.coverage).toEqual({
      ranges: [
        [0, 10000],
        [20000, 20004],
      ],
      readChars: 10004,
      complete: false,
    });
    const overlap = await f.reader.read({
      fileId: f.row.externalId,
      offset: 5000,
      maxChars: 10000,
    });
    expect(overlap.coverage.readChars).toBe(15004);
    expect(overlap.coverage.complete).toBe(false);
    const gap = await f.reader.read({ fileId: f.row.externalId, offset: 15000, maxChars: 5000 });
    expect(gap.coverage).toEqual({ ranges: [[0, 20004]], readChars: 20004, complete: true });
  });
  it('preserves Unicode pairs across ranges and rejects invalid UTF-8 instead of analyzing replacement bytes', async () => {
    const f = await fixture(Buffer.from('A😀中文B'));
    let read = await f.reader.read({ fileId: f.row.externalId, maxChars: 2 });
    expect(read.text).toBe('A');
    read = await f.reader.read({ fileId: f.row.externalId, offset: read.nextOffset!, maxChars: 1 });
    expect(read.text).toBe('😀');
    expect(
      (await f.reader.read({ fileId: f.row.externalId, offset: read.nextOffset! })).coverage
        .complete,
    ).toBe(true);
    const bad = await fixture(Buffer.from([0xc3, 0x28]));
    await expect(bad.reader.read({ fileId: bad.row.externalId })).rejects.toThrow('文件无法读取');
    expect(bad.reader.incomplete()).toBe(true);
  });
  it('rejects unadmitted owned files and other owners instead of treating account access as a task grant', async () => {
    const f = await fixture(Buffer.from('selected,1'));
    const other = await f.service.storeUpload({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'private.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('private,9'),
    });
    const stranger = await f.service.storeUpload({
      userIdInternal: 8,
      userExternalId: 'usr_bob',
      filename: 'bob.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('bob,8'),
    });
    for (const row of [other, stranger])
      await expect(f.reader.read({ fileId: row.externalId })).rejects.toThrow('不在本任务材料范围');
    expect(f.reader.coverageNote()).not.toContain('private.csv');
  });
  it('rechecks account/task status and immutable contents on each read, including revocation during storage I/O', async () => {
    const f = await fixture(Buffer.from('source,1'));
    await f.reader.read({ fileId: f.row.externalId });
    const load = f.service.loadMany.bind(f.service);
    vi.spyOn(f.service, 'loadMany').mockImplementationOnce(async (...args) => {
      const files = await load(...args);
      f.revoke();
      return files;
    });
    await expect(f.reader.read({ fileId: f.row.externalId })).rejects.toThrow('文件无法读取');
    expect(f.reader.incomplete()).toBe(true);
    const changed = await fixture(Buffer.from('source,1'));
    const changedLoad = changed.service.loadMany.bind(changed.service);
    vi.spyOn(changed.service, 'loadMany').mockImplementationOnce(async (...args) =>
      (await changedLoad(...args)).map((file) => ({ ...file, buffer: Buffer.from('secret,9') })),
    );
    await expect(changed.reader.read({ fileId: changed.row.externalId })).rejects.toThrow(
      '文件无法读取',
    );
    expect(changed.reader.coverageNote()).not.toContain('secret');
  });
  it('will not turn plain output metadata or a file URL into a trusted task download receipt', async () => {
    const f = await fixture(Buffer.from('chosen,1'));
    const buffer = Buffer.from('other,9');
    const row = await f.service.storeOutput({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      taskIdInternal: 9,
      filename: 'other.csv',
      mimetype: 'text/csv',
      buffer,
    });
    const receipt = {
      fileId: row.externalId,
      filename: row.filename,
      sizeBytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      downloadUrl: `/api/files/${row.externalId}/download`,
      mimetype: row.mimetype,
      expiresAt: row.expiresAt!.toISOString(),
    };
    await expect(f.scope.admitDownloaded(receipt)).rejects.toThrow('不属于当前任务');
    await expect(f.reader.read({ fileId: row.externalId })).rejects.toThrow('不在本任务材料范围');
  });
  it('admits only the original saved receipt into its original task, exposing source origin without private URL components', async () => {
    const f = await fixture(Buffer.from('input,1'));
    const buffer = Buffer.from('download,731');
    const owner = {};
    const download = {
      createReadStream: async () => Readable.from(buffer),
      failure: async () => null,
      suggestedFilename: () => 'export.csv',
      delete: async () => {},
      url: () => 'https://reports.example/private/export.csv?token=private#private',
    } as unknown as Download;
    const receipt = await persistTaskBrowserDownload(
      download,
      owner,
      async ({ filename, buffer, sha256 }) => {
        const row = await f.service.storeOutput({
          userIdInternal: 7,
          userExternalId: 'usr_alice',
          taskIdInternal: 9,
          filename,
          mimetype: 'text/csv',
          buffer,
        });
        return {
          fileId: row.externalId,
          filename: row.filename,
          sizeBytes: buffer.length,
          sha256,
          downloadUrl: `/api/files/${row.externalId}/download`,
          mimetype: row.mimetype,
          expiresAt: row.expiresAt!.toISOString(),
        };
      },
      undefined,
      'tsk_alice',
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    await expect(f.scope.admitDownloaded(JSON.parse(JSON.stringify(receipt)))).rejects.toThrow(
      '不属于当前任务',
    );
    const otherTask = new BrowserTaskFiles({
      taskId: 'tsk_other',
      userId: 7,
      files: f.service,
      active: async () => true,
    });
    await expect(otherTask.admitDownloaded(receipt)).rejects.toThrow('不属于当前任务');
    await f.scope.admitDownloaded(receipt);
    const read = await f.reader.read({ fileId: receipt.fileId });
    expect(read.text).toBe('download,731');
    expect(read.source).toMatchObject({
      kind: 'browser_download',
      origin: 'https://reports.example',
      originBasis: 'download_url',
    });
    expect(read.websiteExportScope).toBe('not_verified');
    expect(JSON.stringify(read)).not.toContain('private');
  });
  it.each([
    { fileId: '/tmp/private' },
    { fileId: 'https://example.com/private.csv' },
    { fileId: 'file', offset: -1 },
    { fileId: 'file', maxChars: 16001 },
    { fileId: 'file', path: '/tmp/private' },
    { fileId: 'file', offset: 1.5 },
  ])('rejects path/URL/oversized or malformed read requests: %j', (input) => {
    expect(() => taskFileReadRequest(input)).toThrow('参数无效');
  });
  it('fails closed for binary/image content and never calls it a complete text analysis', async () => {
    for (const [filename, mimetype, buffer] of [
      ['payload.bin', 'application/octet-stream', Buffer.from([0, 1, 2])],
      ['chart.png', 'image/png', Buffer.from('not an image')],
    ] as const) {
      const f = await fixture(buffer, filename, mimetype);
      await expect(f.reader.read({ fileId: f.row.externalId })).rejects.toThrow('文件无法读取');
      expect(f.reader.incomplete()).toBe(true);
    }
  });
});

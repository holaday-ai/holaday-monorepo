import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import { BrowserTaskFiles } from './browser-task-files.js';
import { type BrowserUploadFile, PreparedBrowserUpload } from './browser-upload-target.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

const TEXT = 'sku,qty\nA-731,31\n';
const file: BrowserUploadFile = {
  fileId: 'file_input',
  name: 'report.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(TEXT),
};
const HTML =
  '<!doctype html><form action="/upload" method="post"><label>Report <input id="file" name="report" type="file" accept=".csv,text/csv"></label></form><script>document.querySelector("input").onchange=async function(){const f=this.files[0];await fetch("/upload",{method:"POST",body:f});this.value="";}</script>';

describe('owned uploads over an actual CDP connection', () => {
  let chrome: Browser;
  let browser: Browser;
  let origin: string;
  const received: Buffer[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks));
      response.end('received');
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(request.url === '/outer' ? '<iframe src="/inner"></iframe>' : HTML);
  });
  beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    chrome = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${port}`, '--renderer-process-limit=2'],
    });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
    await chrome?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('delivers owned task bytes through the existing executor only after host approval', async () => {
    received.length = 0;
    const f = await browserOutputFixture();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const row = await f.service.storeUpload({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        filename: file.name,
        mimetype: file.mimeType,
        buffer: file.buffer,
      });
      const scope = new BrowserTaskFiles({
        taskId: 'tsk_alice',
        userId: 7,
        files: f.service,
        active: async () => true,
      });
      scope.admitValidated(await f.service.loadMany([row.externalId], 7));
      await page.goto(origin);
      const tools = createPlaywrightUnifiedExecutor(page, {
        resolveUploads: (ids) => scope.resolve('tsk_alice', ids),
      });
      try {
        const snapshot = await tools.execute({ tool: 'snapshot' });
        const ref = snapshot.text.match(/button "Report" \[ref=(e\d+)\]/)?.[1];
        expect(ref).toBeTruthy();
        const action = { tool: 'upload' as const, ref: ref!, fileIds: [row.externalId] };
        const prepared = await tools.prepareUpload(action);
        expect(prepared.description).toMatchObject({
          origin,
          formOrigin: origin,
          name: 'report',
          files: [{ fileId: row.externalId, name: file.name, sizeBytes: file.buffer.length }],
        });
        expect(received).toEqual([]);
        prepared.approve();
        const receipt = await tools.execute(action);
        expect(receipt).toMatchObject({ ok: true, upload: { status: 'handed_to_page' } });
        expect(receipt.text).not.toContain('已上传');
        await vi.waitFor(() => expect(received).toHaveLength(1));
        expect(received[0]).toEqual(file.buffer);
        // The site clears the input after an automatic upload; that is not evidence to resend.
        await vi.waitFor(async () => expect(await page.locator('#file').inputValue()).toBe(''));
        expect((await tools.execute(action)).ok).toBe(false);
        expect(received).toHaveLength(1);
      } finally {
        tools.dispose();
      }
    } finally {
      await context.close();
      await rm(f.root, { recursive: true, force: true });
    }
  });
  it('honors the actual input file type restriction before approval', async () => {
    received.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(origin);
      await expect(
        PreparedBrowserUpload.capture(page.locator('#file'), [file.fileId], async () => [
          { ...file, name: 'picture.png', mimeType: 'image/png' },
        ]),
      ).rejects.toThrow('类型');
      expect(received).toEqual([]);
    } finally {
      await context.close();
    }
  });
  it('does not let an older slow preparation replace a newer approved target', async () => {
    received.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    try {
      await page.goto(origin);
      const tools = createPlaywrightUnifiedExecutor(page, {
        resolveUploads: async () => {
          if (++calls === 1) await hold;
          return [file];
        },
      });
      try {
        const snapshot = await tools.execute({ tool: 'snapshot' });
        const ref = snapshot.text.match(/button "Report" \[ref=(e\d+)\]/)![1]!;
        const first = { tool: 'upload' as const, ref, fileIds: [file.fileId] };
        const second = { ...first };
        const slow = tools.prepareUpload(first);
        await vi.waitFor(() => expect(calls).toBe(1));
        const newer = await tools.prepareUpload(second);
        newer.approve();
        release();
        await expect(slow).rejects.toThrow('失效');
        expect((await tools.execute(second)).ok).toBe(true);
        await vi.waitFor(() => expect(received).toHaveLength(1));
        expect(received[0]).toEqual(file.buffer);
      } finally {
        release();
        tools.dispose();
      }
    } finally {
      await context.close();
    }
  });
  it('blocks new preparations after the executor loses a transfer receipt', async () => {
    received.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(origin);
      const tools = createPlaywrightUnifiedExecutor(page, { resolveUploads: async () => [file] });
      try {
        const snapshot = await tools.execute({ tool: 'snapshot' });
        const ref = snapshot.text.match(/button "Report" \[ref=(e\d+)\]/)![1]!;
        const action = { tool: 'upload' as const, ref, fileIds: [file.fileId] };
        const prepared = await tools.prepareUpload(action);
        const deliver = prepared.deliver.bind(prepared);
        vi.spyOn(prepared, 'deliver').mockImplementation(async () => ({
          ...(await deliver()),
          status: 'unknown',
        }));
        prepared.approve();
        expect((await tools.execute(action)).ok).toBe(false);
        await vi.waitFor(() => expect(received).toHaveLength(1));
        await expect(tools.prepareUpload({ ...action })).rejects.toThrow('未知');
        expect(received).toHaveLength(1);
      } finally {
        tools.dispose();
      }
    } finally {
      vi.restoreAllMocks();
      await context.close();
    }
  });
  it.each(['replace', 'navigate', 'form', 'accept'])(
    'rejects a target changed while reading bytes (%s)',
    async (change) => {
      received.length = 0;
      const context = await browser.newContext();
      const page = await context.newPage();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reading = false;
      try {
        await page.goto(origin);
        const preparing = PreparedBrowserUpload.capture(
          page.locator('#file'),
          [file.fileId],
          async () => {
            reading = true;
            await gate;
            return [file];
          },
        );
        await vi.waitFor(() => expect(reading).toBe(true));
        if (change === 'navigate') await page.goto(`${origin}/other`);
        else
          await page.evaluate((change) => {
            const input = document.querySelector('input')!;
            if (change === 'replace') input.replaceWith(input.cloneNode(true));
            if (change === 'form') input.form!.action = '/different-receiver';
            if (change === 'accept') input.accept = '.png';
          }, change);
        release();
        await expect(preparing).rejects.toThrow();
        expect(received).toEqual([]);
      } finally {
        release();
        await context.close();
      }
    },
  );
  it('rejects an iframe navigation after approval without handing files to its replacement', async () => {
    received.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/outer`);
      const prepared = await PreparedBrowserUpload.capture(
        page.frameLocator('iframe').locator('#file'),
        [file.fileId],
        async () => [file],
      );
      try {
        prepared.approve();
        await page.frames()[1]!.goto(`${origin}/other`);
        await expect(prepared.deliver()).rejects.toThrow();
        expect(received).toEqual([]);
      } finally {
        await prepared.dispose();
      }
    } finally {
      await context.close();
    }
  });
  it.each(['inactive', 'changed'])(
    'rechecks admitted material after waiting for approval (%s)',
    async (reason) => {
      received.length = 0;
      let active = true;
      const f = await browserOutputFixture();
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const row = await f.service.storeUpload({
          userIdInternal: 7,
          userExternalId: 'usr_alice',
          filename: file.name,
          mimetype: file.mimeType,
          buffer: file.buffer,
        });
        const scope = new BrowserTaskFiles({
          taskId: 'tsk_alice',
          userId: 7,
          files: f.service,
          active: async () => active,
        });
        scope.admitValidated(await f.service.loadMany([row.externalId], 7));
        await page.goto(origin);
        const prepared = await PreparedBrowserUpload.capture(
          page.locator('#file'),
          [row.externalId],
          (ids) => scope.resolve('tsk_alice', ids),
        );
        try {
          if (reason === 'inactive') active = false;
          else await writeFile(row.storagePath, 'modified');
          prepared.approve();
          await expect(prepared.deliver()).rejects.toThrow();
          expect(received).toEqual([]);
        } finally {
          await prepared.dispose();
        }
      } finally {
        await context.close();
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );
  it('reports a lost native receipt as unknown and never sends that prepared transfer twice', async () => {
    received.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(origin);
      const locator = page.locator('#file');
      const handle = (await locator.elementHandle())!;
      const original = handle.setInputFiles.bind(handle);
      vi.spyOn(locator, 'elementHandle').mockResolvedValue(handle);
      vi.spyOn(handle, 'setInputFiles').mockImplementation(async (files, options) => {
        await original(files, options);
        throw new Error('synthetic lost CDP response');
      });
      const prepared = await PreparedBrowserUpload.capture(locator, [file.fileId], async () => [
        file,
      ]);
      try {
        prepared.approve();
        expect((await prepared.deliver()).status).toBe('unknown');
        await vi.waitFor(() => expect(received).toHaveLength(1));
        expect((await prepared.deliver()).status).toBe('unknown');
        expect(received).toHaveLength(1);
      } finally {
        await prepared.dispose();
      }
    } finally {
      vi.restoreAllMocks();
      await context.close();
    }
  });
});

describe('a task scope over actual stored files', () => {
  it('rejects another task, other owned files and other owners; accepts later explicitly admitted input', async () => {
    const f = await browserOutputFixture();
    try {
      const row = await f.service.storeUpload({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        filename: file.name,
        mimetype: file.mimeType,
        buffer: file.buffer,
      });
      const later = await f.service.storeUpload({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        filename: 'later.csv',
        mimetype: file.mimeType,
        buffer: Buffer.from('later,17\n'),
      });
      const scope = new BrowserTaskFiles({
        taskId: 'tsk_alice',
        userId: 7,
        files: f.service,
        active: async () => true,
      });
      scope.admitValidated(await f.service.loadMany([row.externalId], 7));
      await expect(scope.resolve('tsk_bob', [row.externalId])).rejects.toThrow();
      await expect(scope.resolve('tsk_alice', [later.externalId])).rejects.toThrow();
      const other = new BrowserTaskFiles({
        taskId: 'tsk_bob',
        userId: 8,
        files: f.service,
        active: async () => true,
      });
      const awaitedFiles = await f.service.loadMany([row.externalId], 7);
      expect(() => other.admitValidated(awaitedFiles)).toThrow();
      scope.admitValidated(await f.service.loadMany([later.externalId], 7));
      expect((await scope.resolve('tsk_alice', [later.externalId]))[0]!.buffer.toString()).toBe(
        'later,17\n',
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
  it('rechecks active status and immutable bytes instead of using an earlier attachment receipt', async () => {
    const f = await browserOutputFixture();
    let active = true;
    try {
      const row = await f.service.storeUpload({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        filename: file.name,
        mimetype: file.mimeType,
        buffer: file.buffer,
      });
      const scope = new BrowserTaskFiles({
        taskId: 'tsk_alice',
        userId: 7,
        files: f.service,
        active: async () => active,
      });
      scope.admitValidated(await f.service.loadMany([row.externalId], 7));
      const real = f.service.loadMany.bind(f.service);
      const read = vi.spyOn(f.service, 'loadMany').mockImplementation(async (...args) => {
        const loaded = await real(...args);
        active = false;
        return loaded;
      });
      await expect(scope.resolve('tsk_alice', [row.externalId])).rejects.toThrow('不可用');
      read.mockRestore();
      active = true;
      await writeFile(row.storagePath, 'changed');
      await expect(scope.resolve('tsk_alice', [row.externalId])).rejects.toThrow('变化');
    } finally {
      vi.restoreAllMocks();
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

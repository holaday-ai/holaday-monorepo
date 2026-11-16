import { type EventEmitter, once } from 'node:events';
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
  it.each([false, true])(
    'uses the actual native chooser target (detached=%s), without guessing a hidden input',
    async (detached) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${origin}/chooser?token=private-chooser-token`);
      await page.setContent(`<button id="choose">Choose report</button><p id="received"></p>
        <script>document.querySelector('button').onclick=()=>{const input=document.createElement('input');
        input.type='file'; input.accept='.csv'; input.style.display='none';
        ${detached ? '' : 'document.body.append(input);'}
        input.onchange=async()=>{document.querySelector('p').textContent=await input.files[0].text()};input.click()};</script>`);
      const tools = createPlaywrightUnifiedExecutor(page, { resolveUploads: async () => [file] });
      try {
        const snapshot = await tools.execute({ tool: 'snapshot' });
        const ref = snapshot.text.match(/button "Choose report" \[ref=(e\d+)\]/)![1]!;
        const clicked = await tools.execute({ tool: 'click', ref });
        expect(clicked.fileChooser?.id).toMatch(/^chooser_[a-f0-9-]{36}$/);
        expect(clicked.text).not.toContain('private-chooser-token');
        expect((page as unknown as EventEmitter).listenerCount('filechooser')).toBe(0);
        const action = {
          tool: 'upload' as const,
          chooserId: clicked.fileChooser!.id,
          fileIds: [file.fileId],
        };
        const prepared = await tools.prepareUpload(action);
        expect(prepared.description).toMatchObject({ origin, accept: '.csv', multiple: false });
        expect((await tools.execute({ ...action })).ok).toBe(false);
        // A mismatching action object consumed this preparation, so open another real chooser.
        const next = await tools.execute({ tool: 'click', ref });
        const approvedAction = { ...action, chooserId: next.fileChooser!.id };
        const approved = await tools.prepareUpload(approvedAction);
        approved.approve();
        expect((await tools.execute(approvedAction)).upload?.status).toBe('handed_to_page');
        await vi.waitFor(async () =>
          expect(await page.locator('#received').textContent()).toBe(TEXT),
        );
        await expect(tools.prepareUpload(approvedAction)).rejects.toThrow();
      } finally {
        tools.dispose();
        await context.close();
      }
    },
  );
  it.each(['reload', 'change', 'new-chooser'] as const)(
    'invalidates an earlier chooser after %s before reading any task bytes',
    async (change) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(origin);
      await page.setContent(
        '<input hidden type="file" id="file"><button onclick="document.querySelector(\'input\').click()">Choose</button>',
      );
      const resolve = vi.fn(async () => [file]);
      const tools = createPlaywrightUnifiedExecutor(page, { resolveUploads: resolve });
      try {
        const snapshot = await tools.execute({ tool: 'snapshot' });
        const ref = snapshot.text.match(/button "Choose" \[ref=(e\d+)\]/)![1]!;
        const first = await tools.execute({ tool: 'click', ref });
        expect(first.fileChooser?.id).toBeTruthy();
        if (change === 'reload') await page.reload();
        if (change === 'change')
          await page.locator('#file').evaluate((el: HTMLInputElement) => {
            el.accept = '.png';
          });
        if (change === 'new-chooser') await tools.execute({ tool: 'click', ref });
        await expect(
          tools.prepareUpload({
            tool: 'upload',
            chooserId: first.fileChooser!.id,
            fileIds: [file.fileId],
          }),
        ).rejects.toThrow();
        expect(resolve).not.toHaveBeenCalled();
      } finally {
        tools.dispose();
        await context.close();
      }
    },
  );
  it('never installs chooser interception on unrelated pages or when task files are disabled', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const other = await context.newPage();
    const tools = createPlaywrightUnifiedExecutor(page);
    try {
      await page.goto(origin);
      await page.setContent(
        '<input hidden type="file"><button onclick="document.querySelector(\'input\').click()">Choose</button>',
      );
      const click = vi.spyOn(page, 'on');
      const snapshot = await tools.execute({ tool: 'snapshot' });
      const ref = snapshot.text.match(/button "Choose" \[ref=(e\d+)\]/)![1]!;
      expect((await tools.execute({ tool: 'click', ref })).fileChooser).toBeUndefined();
      expect(click.mock.calls.some(([event]) => String(event) === 'filechooser')).toBe(false);
      expect((other as unknown as EventEmitter).listenerCount('filechooser')).toBe(0);
    } finally {
      tools.dispose();
      await context.close();
    }
  });
  it('invalidates the original chooser actor receipt before resolving any attachment', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    await page.setContent(
      '<input type="file" hidden><button onclick="document.querySelector(\'input\').click()">Choose</button>',
    );
    let current = true;
    const resolve = vi.fn(async () => [file]);
    const tools = createPlaywrightUnifiedExecutor(page, {
      resolveUploads: resolve,
      captureFileChooserGuard: () => () => current,
    });
    try {
      const snapshot = await tools.execute({ tool: 'snapshot' });
      const ref = snapshot.text.match(/button "Choose" \[ref=(e\d+)\]/)![1]!;
      const result = await tools.execute({ tool: 'click', ref });
      current = false;
      await expect(
        tools.prepareUpload({
          tool: 'upload',
          chooserId: result.fileChooser!.id,
          fileIds: [file.fileId],
        }),
      ).rejects.toThrow();
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      tools.dispose();
      await context.close();
    }
  });
  it('keeps a real iframe chooser bound to that frame and its host-issued observation context', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/outer`);
    const frame = page.frames()[1]!;
    await frame.setContent(
      '<input hidden type="file"><button onclick="document.querySelector(\'input\').click()">Choose</button><p></p><script>document.querySelector("input").onchange=async function(){document.querySelector("p").textContent=await this.files[0].text()}</script>',
    );
    const resolve = vi.fn(async () => [file]);
    const tools = createPlaywrightUnifiedExecutor(page, {
      resolveUploads: resolve,
      observationV2: true,
    });
    try {
      const metadata = await tools.observation!.metadata(frame);
      const snapshot = await tools.execute({ tool: 'snapshot', ...metadata });
      const observed = JSON.parse(snapshot.text) as { tree: string };
      const ref = observed.tree.match(/button "Choose" \[ref=((?:f\d+)?e\d+)\]/)?.[1];
      expect(ref, snapshot.text).toBeTruthy();
      const opened = await tools.execute({ tool: 'click', ref: ref!, ...metadata });
      expect(opened.fileChooser, JSON.stringify({ snapshot, opened })).toMatchObject({
        frameId: metadata.frameId,
        tabId: metadata.tabId,
        origin,
      });
      const action = {
        tool: 'upload' as const,
        chooserId: opened.fileChooser!.id,
        fileIds: [file.fileId],
        frameId: metadata.frameId,
        tabId: metadata.tabId,
      };
      await expect(tools.prepareUpload({ ...action, frameId: undefined })).rejects.toThrow();
      expect(resolve).not.toHaveBeenCalled();
      const prepared = await tools.prepareUpload(action);
      prepared.approve();
      expect((await tools.execute(action)).upload?.status).toBe('handed_to_page');
      await vi.waitFor(async () => expect(await frame.locator('p').textContent()).toBe(TEXT));
    } finally {
      tools.dispose();
      await context.close();
    }
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

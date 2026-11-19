import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverAction } from '../../../../../packages/browser-driver/src/driver.js';
import * as downloadSources from '../../../../../packages/browser-driver/src/native-download-sources.js';
import type { NativeDownloadEvent } from '../../../../../packages/browser-driver/src/native-download.js';
import { SelectedTargetResolver } from '../../../../../packages/browser-driver/src/selected-target.js';

let browser: Browser;
let page: Page;
let cdp: CDPSession;
let origin: string;
let exportOrigin: string;
let live: boolean;
const content = 'sku,qty\nORIGINAL-731,31\n';
const bytes = Buffer.from(content);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const requests: Array<{ method: string; body: string }> = [];
const resolvers: SelectedTargetResolver[] = [];
const server = createServer(async (request, response) => {
  if (request.url === '/human-other') {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<a download="human.csv" href="data:text/csv,HUMAN-PRIVATE-731">My other file</a>',
    );
    return;
  }
  if (request.url?.startsWith('/redirect')) {
    response.writeHead(302, { location: `${exportOrigin}/export` });
    response.end();
    return;
  }
  if (request.url?.startsWith('/export')) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ method: request.method!, body: Buffer.concat(chunks).toString() });
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    response.end(bytes);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<body></body>');
  }
});
const exportServer = createServer((request, response) => {
  requests.push({ method: request.method!, body: '' });
  response.writeHead(200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="report.csv"',
  });
  response.end(bytes);
});
const events = [
  'Page.frameAttached',
  'Page.frameDetached',
  'Page.frameNavigated',
  'Network.requestWillBeSent',
  'Fetch.requestPaused',
  'Page.downloadWillBegin',
  'Page.downloadProgress',
] as const;
const subscribe = (listener: NativeDownloadEvent) => {
  const callbacks = events.map((method) => {
    const callback = (params: Record<string, unknown>) => listener(method, params);
    cdp.on(method as never, callback);
    return { method, callback };
  });
  return () => {
    for (const { method, callback } of callbacks) cdp.off(method as never, callback);
  };
};
const send = (method: string, params?: Record<string, unknown>) =>
  cdp.send(method as never, params as never) as Promise<unknown>;
const resolver = (transport = send) => {
  const value = new SelectedTargetResolver(page as never, 731, [origin], transport, false, {
    subscribe,
  });
  resolvers.push(value);
  return value;
};
const click: DriverAction = {
  kind: 'click',
  selector: {
    scope: { timeoutMs: 2000 },
    selfHeal: false,
    description: 'Export task report',
    strategies: [{ kind: 'css', value: '#export' }],
  },
};
const binding = (target: { token: string; observationRevision: number }) => ({
  token: target.token,
  observationRevision: target.observationRevision,
});
const dataFixture =
  '<a id="export" download="report.csv" href="data:text/csv,sku%2Cqty%0AORIGINAL-731%2C31%0A">Export report</a>';
const blobFixture = `<button id="export">Export report</button><script>window.beforeCreate=window.URL.createObjectURL;document.querySelector('#export').onclick=()=>{document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);const file=new Blob([${JSON.stringify(content)}],{type:'text/csv'});const link=document.createElement('a');link.download='report.csv';link.href=window.URL.createObjectURL(file);link.click();};</script>`;
async function prepare(value: SelectedTargetResolver) {
  await value.observe();
  return binding(await value.describe(click, value.observationRevision));
}
async function capture(value: SelectedTargetResolver) {
  const result = await value.captureDownload(click, await prepare(value), () => live);
  expect(result.status).toBe('captured');
  if (result.status !== 'captured') throw new Error(JSON.stringify(result));
  return result;
}
beforeAll(async () => {
  await new Promise<void>((resolve) => exportServer.listen(0, '127.0.0.1', resolve));
  exportOrigin = `http://localhost:${(exportServer.address() as { port: number }).port}`;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    ...(process.env.HOLADAY_NATIVE_DOWNLOAD_BROWSER_CHANNEL === 'chrome'
      ? { channel: 'chrome' }
      : {}),
    args: ['--renderer-process-limit=2'],
  });
});
beforeEach(async () => {
  live = true;
  requests.length = 0;
  page = await browser.newPage({ acceptDownloads: true });
  await page.goto(origin);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of resolvers.splice(0)) await value.dispose();
  await page.context().close();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => exportServer.close(() => resolve()));
});

describe('original downloads through the bound selected target', () => {
  it("does not attribute a person's download in another same-origin child frame to the root task click", async () => {
    await page.setContent(
      '<iframe src="/human-other"></iframe><button id="export" onclick="document.body.dataset.clicks=\'1\'">Export task report</button>',
    );
    await page.frameLocator('iframe').getByRole('link', { name: 'My other file' }).waitFor();
    const value = resolver();
    const pending = value.captureDownload(click, await prepare(value), () => live);
    await page.waitForFunction(() => document.body.dataset.clicks === '1');
    await page.frameLocator('iframe').getByRole('link', { name: 'My other file' }).click();
    const result = await pending;
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'scope_unavailable',
    });
    expect('downloadId' in result).toBe(false);
  });
  it.each(['new-child', 'existing-child'])(
    'keeps the bound click and immutable file through %s with an injected host export policy',
    async (mode) => {
      // Provider eligibility is tested separately; inject only a local response
      // policy here. Target binding, native input, events and bytes remain real.
      vi.spyOn(downloadSources, 'nativeDownloadResponseSourcesForPage').mockReturnValue({
        patterns: [`${exportOrigin}/export*`],
        accepts: (url) => url === `${exportOrigin}/export`,
      });
      await page.setContent(
        mode === 'new-child'
          ? '<button id="export" onclick="const f=document.createElement(\'iframe\');f.hidden=true;f.src=\'/redirect\';document.body.append(f)">Export report</button>'
          : '<iframe name="target" src="/idle"></iframe><form action="/redirect" target="target"><button id="export">Export report</button></form>',
      );
      if (mode === 'existing-child') await page.frameLocator('iframe').locator('body').waitFor();
      const value = resolver();
      const file = await capture(value);
      expect(
        Buffer.from(await value.readDownloadChunk(file.downloadId, 0, bytes.length, () => live)),
      ).toEqual(bytes);
      expect(file.source).toMatchObject({ origin, originBasis: 'owning_page' });
      expect(requests).toHaveLength(1);
      expect(downloadSources.nativeDownloadResponseSourcesForPage).toHaveBeenCalledWith(page.url());
      value.releaseDownload(file.downloadId);
      await expect(
        value.readDownloadChunk(file.downloadId, 0, bytes.length, () => live),
      ).rejects.toThrow();
    },
  );
  it('does not attribute another native file to the task when the person acts in the task document', async () => {
    await page.setContent(
      `<button id="export">Export report</button><button id="human">My other file</button><script>function makeFile(text,name){const link=document.createElement('a');link.href=window.URL.createObjectURL(new Blob([text],{type:'text/csv'}));link.download=name;link.click();}document.querySelector('#export').onclick=()=>{document.body.dataset.clicks='1';};document.querySelector('#human').onclick=()=>makeFile('HUMAN-PRIVATE-731','human.csv');</script>`,
    );
    const value = resolver();
    const pending = value.captureDownload(click, await prepare(value), () => live);
    await page.waitForFunction(() => document.body.dataset.clicks === '1');
    await page.locator('#human').click();
    const result = await pending;
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'scope_unavailable',
    });
    expect('downloadId' in result).toBe(false);
  });
  it('retains a driver with lost Blob installation and restoration receipts until the actual page closes', async () => {
    await page.setContent(blobFixture);
    let installed = false;
    let restored = false;
    const value = resolver(async (method, params) => {
      const unchanged = () =>
        page.evaluate(
          () =>
            window.URL.createObjectURL ===
            (window as typeof window & { beforeCreate: unknown }).beforeCreate,
        );
      const before = await unchanged();
      const reply = await send(method, params);
      const after = await unchanged();
      if (before && !after) {
        installed = true;
        throw new Error('controlled lost installation reply');
      }
      if (!before && after) {
        restored = true;
        throw new Error('controlled lost restoration reply');
      }
      return reply;
    });
    try {
      await expect(
        value.captureDownload(click, await prepare(value), () => live),
      ).rejects.toMatchObject({
        message: 'download_restore_unconfirmed',
        clickOutcome: 'not_applied',
      });
      expect(installed && restored).toBe(true);
      await expect(value.dispose()).rejects.toThrow('download_restore_unconfirmed');
      expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
    } finally {
      await page.context().close();
    }
    await value.dispose();
  });
  it.each(['data', 'blob', 'post'])(
    'captures real %s bytes through the original verified click',
    async (mode) => {
      await page.setContent(
        mode === 'blob'
          ? blobFixture
          : mode === 'post'
            ? '<form action="/export" method="post"><input type="hidden" name="report" value="731"><button id="export">Export report</button></form>'
            : dataFixture,
      );
      const value = resolver();
      const result = await capture(value);
      expect(result.metadata).toEqual({
        filename: 'report.csv',
        mimeType: 'text/csv',
        sizeBytes: 24,
        sha256,
      });
      expect(
        Buffer.from(await value.readDownloadChunk(result.downloadId, 0, 256 * 1024, () => live)),
      ).toEqual(bytes);
      expect(requests).toEqual(mode === 'post' ? [{ method: 'POST', body: 'report=731' }] : []);
      if (mode === 'blob')
        expect(
          await page.evaluate(
            () =>
              window.URL.createObjectURL ===
              (window as typeof window & { beforeCreate: unknown }).beforeCreate,
          ),
        ).toBe(true);
    },
  );
  it('refuses a replaced link and stale page context before any original request', async () => {
    await page.setContent('<a id="export" href="/export?account=first">Export report</a>');
    const value = resolver();
    const target = await prepare(value);
    await page
      .locator('#export')
      .evaluate((node) => node.setAttribute('href', '/export?account=second'));
    await expect(value.captureDownload(click, target, () => live)).rejects.toThrow(
      /stale_observation|target_changed/,
    );
    expect(requests).toEqual([]);
  });
  it('binds a Blob to its actual same-origin child document', async () => {
    await page.setContent('<iframe></iframe>');
    await page.locator('iframe').evaluate((node, html) => {
      (node as HTMLIFrameElement).srcdoc = html;
    }, blobFixture);
    await page.frameLocator('iframe').locator('#export').waitFor();
    const value = resolver();
    const result = await capture(value);
    expect(
      Buffer.from(await value.readDownloadChunk(result.downloadId, 0, 24, () => live)),
    ).toEqual(bytes);
    expect(await page.frameLocator('iframe').locator('body').getAttribute('data-clicks')).toBe('1');
  });
  it('retains immutable bytes across a new observation but rejects a different resolver and explicit release', async () => {
    await page.setContent(dataFixture);
    const value = resolver();
    const result = await capture(value);
    await page.evaluate(() => document.body.append(document.createElement('span')));
    await value.observe();
    expect(
      Buffer.from(await value.readDownloadChunk(result.downloadId, 0, 24, () => live)),
    ).toEqual(bytes);
    await expect(
      resolver().readDownloadChunk(result.downloadId, 0, 24, () => live),
    ).rejects.toThrow('download_unavailable');
    value.releaseDownload(result.downloadId);
    await expect(value.readDownloadChunk(result.downloadId, 0, 24, () => live)).rejects.toThrow(
      'download_unavailable',
    );
  });
  it('invalidates held bytes on navigation or revoked host ownership', async () => {
    await page.setContent(dataFixture);
    const value = resolver();
    const result = await capture(value);
    live = false;
    await expect(value.readDownloadChunk(result.downloadId, 0, 24, () => live)).rejects.toThrow(
      'download_unavailable',
    );
    live = true;
    await page.goto(`${origin}/replaced`);
    await expect(value.readDownloadChunk(result.downloadId, 0, 24, () => live)).rejects.toThrow(
      'download_unavailable',
    );
  });
  it('does not silently replace an unreleased file with another click', async () => {
    await page.setContent(blobFixture);
    const value = resolver();
    await capture(value);
    const target = await prepare(value);
    await expect(value.captureDownload(click, target, () => live)).rejects.toThrow('browser_busy');
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  });
  it('does not publish a file after the final restoration loses host ownership', async () => {
    await page.setContent(dataFixture);
    const value = resolver(async (method, params) => {
      const result = await send(method, params);
      if (method === 'Fetch.disable') live = false;
      return result;
    });
    expect(await value.captureDownload(click, await prepare(value), () => live)).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'scope_unavailable',
    });
  });
  it('stops subsequent bound input after unconfirmed recovery until real disposal succeeds', async () => {
    await page.setContent(blobFixture);
    let failed = false;
    const value = resolver(async (method, params) => {
      if (method === 'Fetch.disable' && !failed) {
        failed = true;
        throw new Error('controlled restore rejected before dispatch');
      }
      return send(method, params);
    });
    await expect(
      value.captureDownload(click, await prepare(value), () => live),
    ).rejects.toMatchObject({ message: 'download_restore_unconfirmed', clickOutcome: 'applied' });
    await expect(value.observe()).rejects.toThrow('session_unavailable');
    await expect(value.scroll(0, 200)).rejects.toThrow('session_unavailable');
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  });
});

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { captureNativeBlobSources } from '../../../../../packages/browser-driver/src/native-blob-source.js';
import {
  NativeDownloadCaptureController,
  type NativeDownloadEvent,
} from '../../../../../packages/browser-driver/src/native-download.js';

let browser: Browser;
let page: Page;
let cdp: CDPSession;
let origin: string;
let exportOrigin: string;
let frameId: string;
let nodeObjectId: string;
let live: boolean;
let point: { x: number; y: number };
let resumeResponse: (() => void) | undefined;
const controllers: NativeDownloadCaptureController[] = [];
const files: Array<{ dispose(): void }> = [];
const requests: Array<{ method: string; path: string; body: string }> = [];
const redirects: string[] = [];
const observedPaths: string[] = [];
const bytes = Buffer.from('sku,qty\nORIGINAL-731,31\n');
const hash = createHash('sha256').update(bytes).digest('hex');
const server = createServer(async (request, response) => {
  observedPaths.push(request.url!);
  if (request.url?.split('?')[0] === '/download-redirect') {
    redirects.push(request.url);
    response.writeHead(302, { location: `${exportOrigin}/export` });
    response.end();
    return;
  }
  if (request.url?.startsWith('/export')) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      method: request.method!,
      path: request.url,
      body: Buffer.concat(chunks).toString(),
    });
    if (request.url.includes('late-headers'))
      await new Promise((resolve) => setTimeout(resolve, 200));
    if (response.destroyed) return;
    response.setHeader(
      'Content-Type',
      request.url.includes('invalid-mime') ? 'invalid' : 'text/csv',
    );
    response.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    if (request.url.includes('slow')) {
      response.write(bytes.subarray(0, 4));
      await new Promise<void>((resolve) => {
        resumeResponse = resolve;
      });
      if (!response.destroyed) response.end(bytes.subarray(4));
    } else if (request.url.includes('gzip')) {
      response.setHeader('Content-Encoding', 'gzip');
      response.end(gzipSync(bytes));
    } else response.end(bytes);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<body></body>');
  }
});
const exportServer = createServer((request, response) => {
  if (request.url === '/foreign') {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<a download="foreign.csv" href="data:text/csv,FOREIGN-PRIVATE-731">Another origin file</a>',
    );
    return;
  }
  requests.push({ method: request.method!, path: request.url!, body: '' });
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
beforeAll(async () => {
  await new Promise<void>((resolve) => exportServer.listen(0, '127.0.0.1', resolve));
  // Different host as well as port: cover a real cross-site iframe navigation.
  exportOrigin = `http://localhost:${(exportServer.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    ...(process.env.HOLADAY_NATIVE_DOWNLOAD_BROWSER_CHANNEL === 'chrome'
      ? { channel: 'chrome' }
      : {}),
    args: ['--renderer-process-limit=2'],
  });
});
beforeEach(async () => {
  requests.length = 0;
  redirects.length = 0;
  observedPaths.length = 0;
  live = true;
  resumeResponse = undefined;
  page = await browser.newPage({ acceptDownloads: true });
  await page.goto(origin);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
});
afterEach(async () => {
  resumeResponse?.();
  for (const file of files.splice(0)) file.dispose();
  for (const value of controllers.splice(0)) await value.dispose().catch(() => {});
  await page?.context().close();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => exportServer.close(() => resolve()));
});
async function fixture(html: string) {
  await page.setContent(html);
  const document = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector: '#export',
  });
  nodeObjectId = (await cdp.send('DOM.resolveNode', { nodeId })).object.objectId!;
  const box = await page.locator('#export').boundingBox();
  if (!box) throw new Error('fixture target not visible');
  point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
const controller = () => {
  const value = new NativeDownloadCaptureController({ owner: page, send, subscribe });
  controllers.push(value);
  return value;
};
const options = () => ({
  frameId,
  origin,
  current: () => live,
  prepare: async () => {},
  click: () => page.mouse.click(point.x, point.y),
  finalCheck: async () => {},
  captureMs: 500,
  totalMs: 5000,
});

describe('original native download bytes around one owned click', () => {
  it('does not retain a new child frame grant after it commits an ungranted document', async () => {
    // Same site but a different origin: do not rely on an OOPIF swap/detach to
    // retire its inherited blank-document authority.
    const foreign = `${exportOrigin.replace('localhost', '127.0.0.1')}/foreign`;
    await fixture(
      `<button id="export" onclick="const f=document.createElement('iframe');f.src='${foreign}';document.body.append(f)">Export report</button>`,
    );
    const pending = controller().capture({ ...options(), captureMs: 2000 });
    const link = page.frameLocator('iframe').getByRole('link', { name: 'Another origin file' });
    await link.waitFor();
    const downloaded = page.waitForEvent('download');
    await link.click();
    expect((await downloaded).suggestedFilename()).toBe('foreign.csv');
    const result = await pending;
    expect(result).toMatchObject({ status: 'clicked', clickOutcome: 'applied' });
    expect('file' in result).toBe(false);
  });
  it('does not read a response merely because its interception pattern matches', async () => {
    await fixture('<a id="export" href="/download-redirect">Export report</a>');
    const result = await controller().capture({
      ...options(),
      responseSources: {
        patterns: [`${exportOrigin}/export*`],
        accepts: () => false,
      },
    });
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'origin_grant_required',
    });
    expect(requests).toHaveLength(1);
  });
  it('does not read a different origin without a host-owned export policy', async () => {
    await fixture('<a id="export" href="/download-redirect">Export report</a>');
    const result = await controller().capture(options());
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'origin_grant_required',
    });
    expect(requests).toHaveLength(1);
  });
  it('does not attribute an approved response from outside the clicked frame subtree', async () => {
    await fixture('<a id="export" href="/download-redirect">Export report</a>');
    const result = await controller().capture({
      ...options(),
      frameId: 'other-task-frame',
      responseSources: {
        patterns: [`${exportOrigin}/export*`],
        accepts: (url) => url === `${exportOrigin}/export`,
      },
    });
    expect(result).toMatchObject({ status: 'clicked', clickOutcome: 'applied' });
    expect(requests).toHaveLength(1);
  });
  it.each(['redirect', 'new-child', 'existing-child', 'new-child-direct'])(
    'captures one approved export response through %s without another request',
    async (mode) => {
      await fixture(
        mode === 'redirect'
          ? '<a id="export" href="/download-redirect">Export report</a>'
          : mode === 'new-child'
            ? '<button id="export" onclick="const f=document.createElement(\'iframe\');f.hidden=true;f.src=\'/download-redirect\';document.body.append(f)">Export report</button>'
            : mode === 'new-child-direct'
              ? `<button id="export" onclick="const f=document.createElement('iframe');f.hidden=true;f.src='${exportOrigin}/export';document.body.append(f)">Export report</button>`
              : '<iframe name="download-target" src="/idle"></iframe><form action="/download-redirect" target="download-target"><button id="export">Export report</button></form>',
      );
      if (mode === 'existing-child') await page.frameLocator('iframe').locator('body').waitFor();
      const result = await controller().capture({
        ...options(),
        responseSources: {
          patterns: [`${exportOrigin}/export*`],
          accepts: (url: string) => url === `${exportOrigin}/export`,
        },
      });
      expect(result.status, JSON.stringify({ result, observedPaths, redirects, requests })).toBe(
        'captured',
      );
      if (result.status === 'captured') {
        files.push(result.file);
        expect(Buffer.from(result.file.read(0, bytes.length))).toEqual(bytes);
        expect(result.file.source()).toMatchObject({ origin, originBasis: 'owning_page' });
      }
      expect(redirects).toHaveLength(mode === 'new-child-direct' ? 0 : 1);
      expect(requests).toHaveLength(1);
    },
  );
  it('keeps the original owned request when its headers arrive after new-request capture expires', async () => {
    await fixture('<a id="export" href="/export?late-headers">Export report</a>');
    const result = await controller().capture({ ...options(), captureMs: 50, totalMs: 1500 });
    expect(result.status).toBe('captured');
    if (result.status === 'captured') {
      files.push(result.file);
      expect(Buffer.from(result.file.read(0, 24))).toEqual(bytes);
    }
    expect(requests).toHaveLength(1);
  });
  it('waits for the matching native completion after the action capture window ends', async () => {
    await fixture('<a id="export" href="/export">Export report</a>');
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const value = new NativeDownloadCaptureController({
      owner: page,
      send,
      subscribe: (listener) =>
        subscribe((method, params) => {
          if (method === 'Page.downloadProgress' && params.state === 'completed')
            timers.push(setTimeout(() => listener(method, params), 150));
          else listener(method, params);
        }),
    });
    controllers.push(value);
    try {
      const result = await value.capture({ ...options(), captureMs: 50, totalMs: 1000 });
      expect(result.status).toBe('captured');
      if (result.status === 'captured') files.push(result.file);
      expect(requests).toHaveLength(1);
    } finally {
      for (const timer of timers) clearTimeout(timer);
    }
  });
  it('passes a malformed original MIME header without leaving a paused request', async () => {
    await fixture('<a id="export" href="/export?invalid-mime">Export report</a>');
    const result = await controller().capture(options());
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'download_metadata_invalid',
    });
    expect(requests).toHaveLength(1);
    expect(await page.evaluate(() => fetch('/health').then((response) => response.text()))).toBe(
      '<body></body>',
    );
  });
  it('releases untouched ownership if native event subscription fails before installation', async () => {
    await fixture(
      '<a id="export" download="report.csv" href="data:text/csv,sku%2Cqty%0AORIGINAL-731%2C31%0A">Export report</a>',
    );
    const value = new NativeDownloadCaptureController({
      owner: page,
      send,
      subscribe: () => {
        throw new Error('native event source unavailable');
      },
    });
    controllers.push(value);
    await expect(value.capture(options())).rejects.toThrow();
    const result = await controller().capture(options());
    expect(result.status).toBe('captured');
    if (result.status === 'captured') files.push(result.file);
  });
  it('reports a real original-response deadline without replaying the click', async () => {
    await fixture('<a id="export" href="/export?mode=slow">Export report</a>');
    const value = controller();
    try {
      const result = await value.capture({ ...options(), captureMs: 50, totalMs: 200 });
      expect(result).toMatchObject({
        status: 'clicked',
        clickOutcome: 'applied',
        reason: 'download_timeout',
      });
      expect(requests).toHaveLength(1);
      expect(value.stopped).toBe(false);
    } finally {
      resumeResponse?.();
    }
  });
  it('keeps uncertain Fetch recovery owned and passes unrelated requests until confirmed disposal', async () => {
    await fixture(
      '<a id="export" download="report.csv" href="data:text/csv,sku%2Cqty%0AORIGINAL-731%2C31%0A">Export report</a>',
    );
    let failed = false;
    const value = new NativeDownloadCaptureController({
      owner: page,
      subscribe,
      send: async (method, params) => {
        if (method === 'Fetch.disable' && !failed) {
          failed = true;
          throw new Error('synthetic recovery rejected before dispatch');
        }
        return send(method, params);
      },
    });
    controllers.push(value);
    await expect(value.capture(options())).rejects.toMatchObject({
      message: 'download_restore_unconfirmed',
      clickOutcome: 'applied',
    });
    expect(value.stopped).toBe(true);
    await expect(controller().capture(options())).rejects.toMatchObject({
      message: 'browser_busy',
      clickOutcome: 'not_applied',
    });
    expect(await page.evaluate(() => fetch('/health').then((response) => response.text()))).toBe(
      '<body></body>',
    );
    await value.dispose();
  });
  it('does not expose a captured file if ownership changes during final Fetch restoration', async () => {
    await fixture(
      '<a id="export" download="report.csv" href="data:text/csv,sku%2Cqty%0AORIGINAL-731%2C31%0A">Export report</a>',
    );
    const value = new NativeDownloadCaptureController({
      owner: page,
      subscribe,
      send: async (method, params) => {
        const result = await send(method, params);
        if (method === 'Fetch.disable') live = false;
        return result;
      },
    });
    controllers.push(value);
    expect(await value.capture(options())).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'scope_unavailable',
    });
  });
  it('cancels an oversized original response and restores normal network requests', async () => {
    await fixture('<a id="export" href="/export">Export report</a>');
    const result = await controller().capture({ ...options(), maxBytes: 23 });
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'download_too_large',
    });
    expect(requests).toHaveLength(1);
    expect(await page.evaluate(() => fetch('/health').then((response) => response.text()))).toBe(
      '<body></body>',
    );
  });
  it('drains one original response on abort while its stream-close acknowledgement is delayed', async () => {
    await fixture('<a id="export" href="/export?mode=slow">Export report</a>');
    let read!: () => void;
    let closed!: () => void;
    let resume!: () => void;
    const reading = new Promise<void>((resolve) => {
      read = resolve;
    });
    const closing = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const abort = new AbortController();
    let held = false;
    const steps: string[] = [];
    const value = new NativeDownloadCaptureController({
      owner: page,
      subscribe,
      send: async (method, params) => {
        steps.push(`send ${method}`);
        const result = send(method, params);
        if (method === 'IO.read') read();
        const reply = await result;
        steps.push(`reply ${method}`);
        if (method === 'IO.close' && !held) {
          held = true;
          closed();
          await gate;
        }
        return reply;
      },
    });
    controllers.push(value);
    const pending = value.capture({ ...options(), signal: abort.signal });
    const observed = pending.then(
      (result) => ({ result, error: undefined }),
      (error) => ({ result: undefined, error }),
    );
    try {
      await reading;
      abort.abort();
      await closing;
      await new Promise((resolve) => setTimeout(resolve, 50));
      resume();
      let guard: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        observed,
        new Promise<never>((_resolve, reject) => {
          guard = setTimeout(() => {
            console.log('native cancellation diagnostic', JSON.stringify(steps));
            reject(new Error('native cancel did not drain after confirmed commands'));
          }, 1000);
        }),
      ]).finally(() => clearTimeout(guard));
      expect(outcome.error).toBeUndefined();
      expect(outcome.result).toMatchObject({
        status: 'clicked',
        clickOutcome: 'applied',
        reason: 'scope_unavailable',
      });
      expect(value.stopped).toBe(false);
      expect(requests).toHaveLength(1);
      expect(await page.evaluate(() => fetch('/health').then((response) => response.text()))).toBe(
        '<body></body>',
      );
    } finally {
      resume();
      resumeResponse?.();
      const settled = await Promise.race([
        observed.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      if (!settled) await page.context().close();
      await observed;
    }
  });
  it('lets an attachment fetched by the app reach the real Blob without taking its XHR response body', async () => {
    await fixture(
      '<button id="export">Export report</button><script>document.querySelector("#export").onclick=async()=>{const response=await fetch("/export?mode=xhr");const blob=await response.blob();const link=document.createElement("a");link.download="report.csv";link.href=window.URL.createObjectURL(blob);link.click();};</script>',
    );
    const blobs = await captureNativeBlobSources({
      owner: page,
      frameId,
      nodeObjectId,
      origin,
      cdp: send,
      current: () => live,
    });
    const commands: string[] = [];
    const value = new NativeDownloadCaptureController({
      owner: page,
      subscribe,
      send: async (method, params) => {
        commands.push(method);
        return send(method, params);
      },
    });
    controllers.push(value);
    try {
      const native = page.waitForEvent('download').catch(() => null);
      const result = await value.capture({ ...options(), blobs });
      if (result.status !== 'captured') throw new Error(JSON.stringify(result));
      files.push(result.file);
      expect(Buffer.from(result.file.read(0, 24))).toEqual(bytes);
      expect(commands.filter((method) => method === 'Fetch.takeResponseBodyAsStream')).toHaveLength(
        0,
      );
      expect(requests).toHaveLength(1);
      expect(await native).not.toBeNull();
    } finally {
      await blobs.dispose();
    }
  });
  it.each(['get', 'post', 'gzip'])(
    'captures the same original %s response and native completion without a second request',
    async (mode) => {
      await fixture(
        mode === 'post'
          ? '<form action="/export" method="post"><input type="hidden" name="report" value="731"><button id="export">Export report</button></form>'
          : `<a id="export" href="/export?mode=${mode}">Export report</a>`,
      );
      const native = page.waitForEvent('download').catch(() => null);
      const result = await controller().capture(options());
      expect(result.status).toBe('captured');
      if (result.status !== 'captured') throw new Error(JSON.stringify(result));
      files.push(result.file);
      expect(result.file.metadata()).toEqual({
        filename: 'report.csv',
        mimeType: 'text/csv',
        sizeBytes: 24,
        sha256: hash,
      });
      expect(Buffer.from(result.file.read(0, 256 * 1024))).toEqual(bytes);
      expect(result.file.source()).toMatchObject({ origin, originBasis: 'download_url', frameId });
      const download = await native;
      if (!download) throw new Error('actual browser download missing');
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(bytes);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe(mode === 'post' ? 'POST' : 'GET');
      if (mode === 'post') expect(requests[0]?.body).toBe('report=731');
    },
  );
  it('captures the actual native data payload without reading a URL', async () => {
    await fixture(
      '<a id="export" download="report.csv" href="data:text/csv,sku%2Cqty%0AORIGINAL-731%2C31%0A">Export report</a>',
    );
    const native = page.waitForEvent('download').catch(() => null);
    const result = await controller().capture(options());
    if (result.status !== 'captured') throw new Error(JSON.stringify(result));
    files.push(result.file);
    expect(Buffer.from(result.file.read(0, 24))).toEqual(bytes);
    expect(result.file.source()).toMatchObject({ origin, originBasis: 'owning_page', frameId });
    expect(requests).toEqual([]);
    expect(await native).not.toBeNull();
  });
  it('combines the actual dynamic Blob with its native guid after API restoration', async () => {
    await fixture(
      `<button id="export">Export report</button><script>document.querySelector('#export').onclick=()=>{const file=new Blob([${JSON.stringify(bytes.toString())}],{type:'text/csv'});const link=document.createElement('a');link.download='report.csv';link.href=window.URL.createObjectURL(file);link.click();};</script>`,
    );
    const blobs = await captureNativeBlobSources({
      owner: page,
      frameId,
      nodeObjectId,
      origin,
      cdp: send,
      current: () => live,
    });
    try {
      const native = page.waitForEvent('download').catch(() => null);
      const result = await controller().capture({ ...options(), blobs });
      if (result.status !== 'captured') throw new Error(JSON.stringify(result));
      files.push(result.file);
      expect(Buffer.from(result.file.read(0, 24))).toEqual(bytes);
      expect(result.file.metadata().sha256).toBe(hash);
      expect(await native).not.toBeNull();
    } finally {
      await blobs.dispose();
    }
  });
  it('does not dispatch an old click after final target preparation is refused', async () => {
    await fixture(
      '<button id="export" onclick="document.body.dataset.clicks=\'1\'">Export report</button>',
    );
    await expect(
      controller().capture({
        ...options(),
        prepare: async () => {
          throw new Error('target_changed');
        },
      }),
    ).rejects.toMatchObject({
      message: 'download_target_unavailable',
      clickOutcome: 'not_applied',
    });
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
    expect(requests).toEqual([]);
  });
});

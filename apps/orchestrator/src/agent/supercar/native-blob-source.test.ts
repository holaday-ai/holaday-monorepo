import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureNativeBlobSources } from '../../../../../packages/browser-driver/src/native-blob-source.js';

let browser: Browser;
let page: Page;
let cdp: CDPSession;
let origin: string;
const content = 'sku,qty\nORIGINAL-731,31\n';
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<body></body>');
});
const leases: Awaited<ReturnType<typeof captureNativeBlobSources>>[] = [];
const fixture = `<button id="export">Export report</button><script>
  window.originalBlobUrlFunction=window.URL.createObjectURL;
  document.querySelector('#export').onclick=()=>{
    document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
    const blob=new Blob([${JSON.stringify(content)}],{type:'text/csv'});
    const link=document.createElement('a');link.href=window.URL.createObjectURL(blob);
    link.download='report.csv';link.click();
  };
</script>`;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
beforeEach(async () => {
  page = await browser.newPage({ acceptDownloads: true });
  await page.goto(origin);
  await page.setContent(fixture);
  cdp = await page.context().newCDPSession(page);
});
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.dispose().catch(() => {});
  await page?.context().close();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function start(options: Partial<Parameters<typeof captureNativeBlobSources>[0]> = {}) {
  const tree = await cdp.send('Page.getFrameTree');
  const document = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: document.root.nodeId,
    selector: '#export',
  });
  const { object } = await cdp.send('DOM.resolveNode', { nodeId });
  const lease = await captureNativeBlobSources({
    owner: page,
    frameId: tree.frameTree.frame.id,
    nodeObjectId: object.objectId!,
    origin,
    cdp: (method, params) => cdp.send(method as never, params as never) as Promise<unknown>,
    current: () => true,
    ...options,
  });
  leases.push(lease);
  return lease;
}

describe('bounded native Blob sources around one explicit export', () => {
  it('releases native inspection references created during capture', async () => {
    let nestedObject: string | undefined;
    const lease = await start({
      cdp: async (method, params) => {
        const result = (await cdp.send(method as never, params as never)) as {
          result?: Array<{ name: string; value?: { type?: string; objectId?: string } }>;
        };
        if (method === 'Runtime.getProperties' && !nestedObject)
          nestedObject = result.result?.find(
            (property) => property.name === 'prototype' && property.value?.type === 'object',
          )?.value?.objectId;
        return result;
      },
    });
    expect(nestedObject).toBeTypeOf('string');
    await lease.dispose();
    await expect(cdp.send('Runtime.getProperties', { objectId: nestedObject! })).rejects.toThrow();
  });
  it('preserves native MediaSource URL creation without granting it Blob bytes', async () => {
    const lease = await start();
    const url = await page.evaluate(() => window.URL.createObjectURL(new MediaSource()));
    await lease.restore();
    expect(url.startsWith(`blob:${origin}/`)).toBe(true);
    await expect(lease.describe(url)).rejects.toThrow('blob_source_unavailable');
  });
  it('restores the actual website API at the bounded capture deadline', async () => {
    await start({ timeoutMs: 50 });
    await vi.waitFor(
      async () => {
        expect(
          await page.evaluate(
            () =>
              window.URL.createObjectURL ===
              (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
          ),
        ).toBe(true);
      },
      { timeout: 1000, interval: 25 },
    );
  });
  it('rechecks the owner after releasing the actual native read buffer', async () => {
    let reading = false;
    let current = true;
    const lease = await start({
      current: () => current,
      cdp: async (method, params) => {
        const result = await cdp.send(method as never, params as never);
        if (reading && method === 'Runtime.releaseObject') current = false;
        return result;
      },
    });
    const pending = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await pending;
    await lease.restore();
    reading = true;
    await expect(lease.read(download.url(), 0, 24)).rejects.toThrow('scope_unavailable');
  });
  it('keeps admission stopped when installation and recovery acknowledgements are both lost', async () => {
    let installed = false;
    let restored = false;
    await expect(
      start({
        cdp: async (method, params) => {
          const before = await page.evaluate(
            () =>
              window.URL.createObjectURL ===
              (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
          );
          const result = await cdp.send(method as never, params as never);
          const after = await page.evaluate(
            () =>
              window.URL.createObjectURL ===
              (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
          );
          if (before && !after) {
            installed = true;
            throw new Error('synthetic lost installation reply');
          }
          if (!before && after) {
            restored = true;
            throw new Error('synthetic lost recovery reply');
          }
          return result;
        },
      }),
    ).rejects.toThrow('blob_capture_restore_unconfirmed');
    expect(installed && restored).toBe(true);
    await expect(start()).rejects.toThrow('blob_capture_busy');
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('restores the real website API even when the native installation reply is lost', async () => {
    let installed = false;
    await expect(
      start({
        cdp: async (method, params) => {
          const result = await cdp.send(method as never, params as never);
          if (
            !installed &&
            (await page.evaluate(
              () =>
                window.URL.createObjectURL !==
                (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
            ))
          ) {
            installed = true;
            throw new Error('synthetic lost installation reply');
          }
          return result;
        },
      }),
    ).rejects.toThrow();
    expect(installed).toBe(true);
    expect(
      await page.evaluate(
        () =>
          window.URL.createObjectURL ===
          (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
      ),
    ).toBe(true);
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('ignores a website toString spoof when deciding whether the API is native', async () => {
    await page.evaluate(() => {
      const spoof = function createObjectURL() {
        throw new Error('website fake API');
      };
      window.URL.createObjectURL = spoof;
      Function.prototype.toString = () => 'function createObjectURL() { [native code] }';
    });
    await expect(start()).rejects.toThrow('blob_api_unavailable');
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('preserves a competing website API and never calls unconfirmed restoration idle', async () => {
    const lease = await start();
    await page.evaluate(() => {
      window.URL.createObjectURL = () => {
        throw new Error('replacement API');
      };
    });
    await expect(lease.restore()).rejects.toThrow('blob_capture_restore_unconfirmed');
    await expect(start()).rejects.toThrow('blob_capture_busy');
    await expect(lease.describe(`blob:${origin}/unprovided`)).rejects.toThrow('scope_unavailable');
    expect(
      await page.evaluate(() => {
        try {
          window.URL.createObjectURL(new Blob());
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      }),
    ).toBe('replacement API');
  });
  it('stops retaining objects when a website keeps a reference to the temporary wrapper', async () => {
    const lease = await start();
    await page.evaluate(() => {
      (window as unknown as { savedWrapper: unknown }).savedWrapper = window.URL.createObjectURL;
    });
    await lease.restore();
    const url = await page.evaluate(() =>
      (window as unknown as { savedWrapper: (blob: Blob) => string }).savedWrapper(
        new Blob(['later']),
      ),
    );
    await expect(lease.describe(url)).rejects.toThrow('blob_source_unavailable');
    expect(
      await page.evaluate(
        () =>
          window.URL.createObjectURL ===
          (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
      ),
    ).toBe(true);
  });
  it('restores on abort and refuses the old original source', async () => {
    const controller = new AbortController();
    const lease = await start({ signal: controller.signal });
    const pending = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await pending;
    controller.abort();
    await lease.restore();
    await expect(lease.describe(download.url())).rejects.toThrow('scope_unavailable');
    expect(
      await page.evaluate(
        () =>
          window.URL.createObjectURL ===
          (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
      ),
    ).toBe(true);
  });
  it('suppresses bytes if the owner changes after the actual native read', async () => {
    let current = true;
    const lease = await start({
      current: () => current,
      cdp: async (method, params) => {
        const result = await cdp.send(method as never, params as never);
        if (method === 'Runtime.callFunctionOn' && params.awaitPromise === true) current = false;
        return result;
      },
    });
    const pending = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await pending;
    await lease.restore();
    await expect(lease.read(download.url(), 0, 24)).rejects.toThrow('scope_unavailable');
  });
  it.each([23, 24])(
    'keeps the byte budget inclusive at %i bytes without changing the real browser download',
    async (maxBytes) => {
      const lease = await start({ maxBytes });
      const pending = page.waitForEvent('download');
      await page.locator('#export').click();
      const download = await pending;
      await lease.restore();
      if (maxBytes === 24)
        expect(new TextDecoder().decode(await lease.read(download.url(), 0, 24))).toBe(content);
      else await expect(lease.describe(download.url())).rejects.toThrow('blob_source_unavailable');
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe(content);
    },
  );
  it('keeps captures separate and disposes their file references', async () => {
    const first = await start();
    await expect(start()).rejects.toThrow('blob_capture_busy');
    const pending = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await pending;
    await first.restore();
    const second = await start();
    await second.restore();
    await expect(second.describe(download.url())).rejects.toThrow('blob_source_unavailable');
    expect((await first.describe(download.url())).sizeBytes).toBe(24);
    await first.dispose();
    await expect(first.describe(download.url())).rejects.toThrow('scope_unavailable');
  });
  it('refuses a native node from a different actual frame', async () => {
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.srcdoc = '<p>Other frame</p>';
      document.body.append(frame);
    });
    const tree = await cdp.send('Page.getFrameTree');
    const child = tree.frameTree.childFrames![0]!.frame.id;
    await expect(start({ frameId: child })).rejects.toThrow();
    expect(
      await page.evaluate(
        () =>
          window.URL.createObjectURL ===
          (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
      ),
    ).toBe(true);
  });
  it('does not let a page Promise hook substitute bytes for the actual native Blob', async () => {
    const lease = await start();
    const pending = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await pending;
    await lease.restore();
    await page.evaluate(() => {
      const then = Promise.prototype.then;
      const fake = new ArrayBuffer(24);
      Object.defineProperty(Promise.prototype, 'constructor', {
        value: function ForeignPromise() {},
        configurable: true,
      });
      Promise.prototype.then = function (this: Promise<unknown>, resolve, reject) {
        return Reflect.apply(then, this, [() => resolve?.(fake), reject]);
      } as typeof Promise.prototype.then;
    });
    expect(new TextDecoder().decode(await lease.read(download.url(), 0, 24))).toBe(content);
  });
  it('retains the actual native object and reads original chunks after restoring the website API', async () => {
    const lease = await start();
    const nativeDownload = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await nativeDownload;
    await lease.restore();
    expect(
      await page.evaluate(
        () =>
          window.URL.createObjectURL ===
          (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
      ),
    ).toBe(true);
    expect(await lease.describe(download.url())).toEqual({ sizeBytes: 24, mimeType: 'text/csv' });
    const first = await lease.read(download.url(), 0, 7);
    const rest = await lease.read(download.url(), 7, 256 * 1024);
    expect(new TextDecoder().decode(new Uint8Array([...first, ...rest]))).toBe(content);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe(content);
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
  });
  it('refuses cached Blob URLs created before the capture without fetching them', async () => {
    const url = await page.evaluate(() =>
      window.URL.createObjectURL(new Blob(['cached'], { type: 'text/csv' })),
    );
    const lease = await start();
    await lease.restore();
    await expect(lease.describe(url)).rejects.toThrow('blob_source_unavailable');
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('does not install or grant a source after its owner is stopped', async () => {
    await expect(start({ current: () => false })).rejects.toThrow('scope_unavailable');
    expect(
      await page.evaluate(
        () =>
          window.URL.createObjectURL ===
          (window as unknown as { originalBlobUrlFunction: unknown }).originalBlobUrlFunction,
      ),
    ).toBe(true);
  });
  it('does not replace a website custom Blob URL function', async () => {
    await page.evaluate(() => {
      window.URL.createObjectURL = () => {
        throw new Error('website custom API');
      };
    });
    await expect(start()).rejects.toThrow('blob_api_unavailable');
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
    expect(
      await page.evaluate(() => {
        try {
          window.URL.createObjectURL(new Blob());
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      }),
    ).toBe('website custom API');
  });
});

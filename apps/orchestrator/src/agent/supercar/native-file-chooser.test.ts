import type { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureNativeFileChooser } from '../../../../../packages/browser-driver/src/native-file-chooser.js';

let browser: Browser;
// Playwright's public Page declaration omits its runtime EventEmitter inspection.
// Keep this assertion local to the actual SDK object used by these tests.
let page: Page & Pick<EventEmitter, 'listeners' | 'listenerCount'>;
let cdp: CDPSession;
let origin: string;
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<body></body>');
});
const intercept = async (enabled: boolean) => {
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled });
};
const capture = (options: Omit<Parameters<typeof captureNativeFileChooser>[1], 'intercept'>) =>
  captureNativeFileChooser(page as never, { ...options, intercept });
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  page = (await browser.newPage()) as typeof page;
  cdp = await page.context().newCDPSession(page);
});
beforeEach(async () => {
  await page.goto(origin);
});
afterEach(async () => {
  page.removeAllListeners('filechooser');
  await intercept(false);
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const dynamic = (connected: boolean) =>
  `<button id="choose" onclick="const file=document.createElement('input');file.type='file';file.accept='.csv';${connected ? 'document.body.append(file);' : ''}file.onchange=async()=>document.body.dataset.received=await file.files[0].text();file.click()">Choose report</button>`;

describe('temporary native file chooser capture around one owned click', () => {
  it.each(['missing', 'invalid', 'throws'])(
    'refuses capture when runtime listener inspection is %s',
    async (mode) => {
      await page.setContent('<button onclick="document.body.dataset.effect=\'1\'">Run</button>');
      const original = Object.getOwnPropertyDescriptor(page, 'listenerCount');
      Object.defineProperty(page, 'listenerCount', {
        configurable: true,
        value:
          mode === 'missing'
            ? undefined
            : () => {
                if (mode === 'throws') throw new Error('private inspection error');
                return Number.NaN;
              },
      });
      try {
        await expect(
          capture({ click: () => page.locator('button').click(), current: () => true }),
        ).rejects.toMatchObject({
          message: 'chooser_listener_state_unavailable',
          clickOutcome: 'not_applied',
        });
      } finally {
        if (original) Object.defineProperty(page, 'listenerCount', original);
        else Reflect.deleteProperty(page, 'listenerCount');
      }
      expect(page.listenerCount('filechooser')).toBe(0);
      expect(await page.locator('body').getAttribute('data-effect')).toBeNull();
    },
  );
  it('does not disturb a pre-existing native chooser listener', async () => {
    await page.setContent('<button onclick="document.body.dataset.effect=\'1\'">Run</button>');
    const owner = () => {};
    page.on('filechooser', owner);
    await expect(
      capture({ click: () => page.locator('button').click(), current: () => true, timeoutMs: 100 }),
    ).rejects.toMatchObject({ message: 'chooser_capture_busy', clickOutcome: 'not_applied' });
    expect(page.listeners('filechooser')).toEqual([owner]);
    expect(await page.locator('body').getAttribute('data-effect')).toBeNull();
  });
  it('preserves a competing listener and refuses to call interception restored', async () => {
    await page.setContent('<button>Run</button>');
    const other = () => {};
    await expect(
      capture({
        click: async () => {
          await page.locator('button').click();
          page.on('filechooser', other);
        },
        current: () => true,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ message: 'chooser_restore_unconfirmed', clickOutcome: 'applied' });
    expect(page.listeners('filechooser')).toEqual([other]);
  });
  it('rejects an unbounded listener lease before clicking', async () => {
    await page.setContent('<button onclick="document.body.dataset.effect=\'1\'">Run</button>');
    await expect(
      capture({
        click: () => page.locator('button').click(),
        current: () => true,
        timeoutMs: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toMatchObject({ message: 'invalid_chooser_timeout', clickOutcome: 'not_applied' });
    expect(await page.locator('body').getAttribute('data-effect')).toBeNull();
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('keeps an uncertain click outcome after a native effect and lost acknowledgement', async () => {
    await page.setContent('<button onclick="document.body.dataset.effect=\'1\'">Run</button>');
    await expect(
      capture({
        click: async () => {
          await page.locator('button').click();
          throw new Error('private callback details');
        },
        current: () => true,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ message: 'input_outcome_unknown', clickOutcome: 'unknown' });
    expect(await page.locator('body').getAttribute('data-effect')).toBe('1');
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('restores a possibly applied acquisition before returning a pre-click failure', async () => {
    await page.setContent('<button onclick="document.body.dataset.effect=\'1\'">Run</button>');
    await expect(
      captureNativeFileChooser(page as never, {
        click: () => page.locator('button').click(),
        current: () => true,
        intercept: async (enabled) => {
          await intercept(enabled);
          if (enabled) throw new Error('private enable acknowledgement');
        },
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({
      message: 'chooser_interception_unavailable',
      clickOutcome: 'not_applied',
    });
    expect(await page.locator('body').getAttribute('data-effect')).toBeNull();
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('does not choose the first of several native inputs opened by one actual click', async () => {
    await page.setContent(
      "<button onclick=\"for(let i=0;i<3;i++){const file=document.createElement('input');file.type='file';document.body.append(file);file.click()}\">Choose</button>",
    );
    const result = await capture({
      click: () => page.locator('button').click(),
      current: () => true,
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'chooser_ambiguous',
    });
    expect(
      await page
        .locator('input')
        .evaluateAll((nodes) =>
          nodes.every((node) => (node as HTMLInputElement).files?.length === 0),
        ),
    ).toBe(true);
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it.each([true, false])(
    'retains the actual input after releasing interception (connected=%s)',
    async (connected) => {
      await page.setContent(dynamic(connected));
      const result = await capture({
        click: () => page.locator('#choose').click(),
        current: () => true,
        timeoutMs: 1000,
      });
      expect(result.status).toBe('captured');
      expect(page.listenerCount('filechooser')).toBe(0);
      if (result.status !== 'captured') throw new Error('actual chooser missing');
      try {
        expect(result.chooser.page()).toBe(page);
        expect(await result.chooser.element().ownerFrame()).toBe(page.mainFrame());
        expect(
          await result.chooser.element().evaluate((node: HTMLInputElement) => node.files?.length),
        ).toBe(0);
        await result.chooser.setFiles({
          name: 'report.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('sku,qty\nA-731,31\n'),
        });
        await page.waitForFunction(() => document.body.dataset.received === 'sku,qty\nA-731,31\n');
      } finally {
        await result.chooser.element().dispose();
      }
    },
  );
  it('does not start a click or install a lasting listener after scope closes', async () => {
    await page.setContent('<button onclick="document.body.dataset.effect=\'1\'">Run</button>');
    const result = await capture({
      click: () => page.locator('button').click(),
      current: () => false,
      timeoutMs: 100,
    });
    expect(result).toMatchObject({ status: 'not_applied', clickOutcome: 'not_applied' });
    expect(await page.locator('body').getAttribute('data-effect')).toBeNull();
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('preserves applied click evidence when no chooser opens, including a DOM-forged event', async () => {
    await page.setContent(
      "<button onclick=\"document.body.dataset.effect='1';document.dispatchEvent(new Event('filechooser'))\">Run</button>",
    );
    const result = await capture({
      click: () => page.locator('button').click(),
      current: () => true,
      timeoutMs: 150,
    });
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'not_captured',
    });
    expect(await page.locator('body').getAttribute('data-effect')).toBe('1');
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('discards a native chooser when scope closes during interception restoration', async () => {
    await page.setContent(dynamic(true));
    let active = true;
    const result = await captureNativeFileChooser(page as never, {
      click: () => page.locator('#choose').click(),
      current: () => active,
      intercept: async (enabled) => {
        await intercept(enabled);
        if (!enabled) active = false;
      },
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'scope_unavailable',
    });
    expect(page.listenerCount('filechooser')).toBe(0);
    expect(
      await page.locator('input').evaluate((node) => (node as HTMLInputElement).files?.length),
    ).toBe(0);
  });
  it('removes the listener on abort while retaining the real in-flight click until it settles', async () => {
    await page.setContent('<button onclick="document.body.dataset.effect=\'1\'">Run</button>');
    const controller = new AbortController();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    const pending = capture({
      click: async () => {
        await page.locator('button').click();
        entered();
        await resumed;
      },
      current: () => true,
      signal: controller.signal,
      timeoutMs: 2000,
    }).finally(() => {
      settled = true;
    });
    await started;
    try {
      controller.abort();
      await vi.waitFor(() => expect(page.listenerCount('filechooser')).toBe(0));
      expect(settled).toBe(false);
      release();
      expect(await pending).toMatchObject({
        status: 'clicked',
        clickOutcome: 'applied',
        reason: 'scope_unavailable',
      });
      expect(await page.locator('body').getAttribute('data-effect')).toBe('1');
    } finally {
      release();
      await pending;
    }
  });
  it('does not return an upload target when restoring interception is unconfirmed', async () => {
    await page.setContent(dynamic(true));
    const pending = captureNativeFileChooser(page as never, {
      click: () => page.locator('#choose').click(),
      current: () => true,
      intercept: async (enabled) => {
        if (!enabled) throw new Error('private restore details');
        await intercept(true);
      },
      timeoutMs: 1000,
    });
    await expect(pending).rejects.toMatchObject({
      message: 'chooser_restore_unconfirmed',
      clickOutcome: 'applied',
    });
    expect(page.listenerCount('filechooser')).toBe(0);
    expect(
      await page.locator('input').evaluate((node) => (node as HTMLInputElement).files?.length),
    ).toBe(0);
  });
});

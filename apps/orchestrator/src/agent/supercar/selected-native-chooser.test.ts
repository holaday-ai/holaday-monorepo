import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverAction } from '../../../../../packages/browser-driver/src/driver.js';
import { SelectedTargetResolver } from '../../../../../packages/browser-driver/src/selected-target.js';

let browser: Browser;
let page: Page & Pick<EventEmitter, 'listenerCount'>;
let session: CDPSession;
let origin: string;
const resolvers: SelectedTargetResolver[] = [];
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end('<body></body>');
});
const cdp = (method: string, params?: Record<string, unknown>) =>
  session.send(method as never, params as never);
const resolver = (send = cdp) => {
  const value = new SelectedTargetResolver(page as never, 731, [origin], send);
  resolvers.push(value);
  return value;
};
const selector = (value: string) => ({
  scope: { timeoutMs: 2000 },
  selfHeal: false,
  description: 'Choose task report',
  strategies: [{ kind: 'css' as const, value }],
});
const click: DriverAction = { kind: 'click', selector: selector('#choose') };
const binding = (target: { token: string; observationRevision: number }) => ({
  token: target.token,
  observationRevision: target.observationRevision,
});
const bytes = Buffer.from('sku,qty\nA-731,31\n');
const files = [
  {
    fileId: 'file_731',
    name: 'report.csv',
    mimeType: 'text/csv',
    sizeBytes: 17,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
];
const payloads = [{ name: 'report.csv', mimeType: 'text/csv', buffer: bytes }];
const upload = (chooserId: string): DriverAction => ({
  kind: 'upload',
  payload: { chooserId, files },
});
const fixture = (connected = false) =>
  `<button id="choose" type="button" onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);const f=document.createElement('input');f.type='file';f.accept='.csv';${connected ? "f.id='actual';document.body.append(f);" : ''}f.onchange=async()=>{document.body.dataset.changes=String(Number(document.body.dataset.changes||0)+1);document.body.dataset.received=await f.files[0].text()};f.click()">Choose report</button>`;
const open = async (r: SelectedTargetResolver) => {
  await r.observe();
  const target = await r.describe(click, r.observationRevision);
  const result = await r.captureFileChooser(click, binding(target), () => true);
  expect(result.status).toBe('captured');
  if (result.status !== 'captured') throw new Error('actual chooser missing');
  return result.chooserId;
};
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  page = (await browser.newPage()) as typeof page;
  session = await page.context().newCDPSession(page);
});
beforeEach(async () => {
  await page.goto(origin);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const r of resolvers.splice(0)) await r.dispose();
  page.removeAllListeners('filechooser');
  await cdp('Page.setInterceptFileChooserDialog', { enabled: false });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('owned native chooser through the existing selected target resolver', () => {
  it('does not treat an opaque sandboxed srcdoc document as its granted parent origin', async () => {
    await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
    await page.locator('iframe').evaluate((node, html) => {
      (node as HTMLIFrameElement).srcdoc = html;
    }, fixture());
    await page.frameLocator('iframe').locator('#choose').waitFor();
    const r = resolver();
    await r.observe();
    const button = await r.describe(click, r.observationRevision);
    const result = await r.captureFileChooser(click, binding(button), () => true);
    expect(result).toMatchObject({
      status: 'clicked',
      clickOutcome: 'applied',
      reason: 'chooser_unavailable',
    });
    expect(await page.frameLocator('iframe').locator('body').getAttribute('data-clicks')).toBe('1');
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('uses the native utility-world security origin instead of a page-overridden origin property', async () => {
    await page.setContent(fixture());
    await page.evaluate(() =>
      Object.defineProperty(window, 'origin', {
        value: 'https://page-authored.invalid',
        configurable: true,
      }),
    );
    const r = resolver();
    const action = upload(await open(r));
    await r.observe();
    const target = await r.describe(action, r.observationRevision);
    expect(target.origin).toBe(origin);
    expect(target.fileInput?.formOrigin).toBe(origin);
    await r.execute(action, binding(target), payloads, () => true);
    await page.waitForFunction(() => document.body.dataset.received === 'sku,qty\nA-731,31\n');
  });
  it('binds the native input in its actual granted iframe rather than the clicked parent frame', async () => {
    await page.setContent(
      '<button id="choose" type="button" onclick="frames[0].document.querySelector(\'button\').click()">Choose report</button><iframe></iframe>',
    );
    await page.locator('iframe').evaluate(
      (node, html) => {
        (node as HTMLIFrameElement).srcdoc = html;
      },
      fixture().replace('id="choose"', 'id="child-choose"'),
    );
    await page.waitForFunction(() => frames[0]?.document.querySelector('button'));
    const r = resolver();
    await r.observe();
    const button = await r.describe(click, r.observationRevision);
    const captured = await r.captureFileChooser(click, binding(button), () => true);
    expect(captured.status).toBe('captured');
    if (captured.status !== 'captured') throw new Error('actual child chooser missing');
    await r.observe();
    const action = upload(captured.chooserId);
    const target = await r.describe(action, r.observationRevision);
    expect(target.frameId).not.toBe(button.frameId);
    expect(target.origin).toBe(origin);
    await r.execute(action, binding(target), payloads, () => true);
    await page.waitForFunction(
      () => frames[0]!.document.body.dataset.received === 'sku,qty\nA-731,31\n',
    );
    expect(await page.evaluate(() => frames[0]!.document.body.dataset.changes)).toBe('1');
    expect(await page.locator('body').getAttribute('data-received')).toBeNull();
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('retains the same native input through repeated descriptions while the host checks confirmation', async () => {
    await page.setContent(fixture());
    const r = resolver();
    const action = upload(await open(r));
    await r.observe();
    const first = await r.describe(action, r.observationRevision);
    const final = await r.describe(action, r.observationRevision);
    expect(final.elementId).toBe(first.elementId);
    await r.execute(action, binding(final), payloads, () => true);
    await page.waitForFunction(() => document.body.dataset.received === 'sku,qty\nA-731,31\n');
    expect(await page.locator('body').getAttribute('data-changes')).toBe('1');
  });
  it('expires a retained chooser without selecting files', async () => {
    await page.setContent(fixture());
    const r = resolver();
    const action = upload(await open(r));
    const expired = Date.now() + 120_001;
    vi.spyOn(Date, 'now').mockReturnValue(expired);
    await r.observe();
    await expect(r.describe(action, r.observationRevision)).rejects.toThrow(
      'file_target_forbidden',
    );
    expect(await page.locator('body').getAttribute('data-received')).toBeNull();
    expect(page.listenerCount('filechooser')).toBe(0);
  });
  it('rechecks the chooser lease at final dispatch after asynchronous file and target validation', async () => {
    await page.setContent(fixture());
    const r = resolver();
    const action = upload(await open(r));
    await r.observe();
    const target = await r.describe(action, r.observationRevision);
    const expired = Date.now() + 120_001;
    await expect(
      r.execute(action, binding(target), payloads, () => {
        vi.spyOn(Date, 'now').mockReturnValue(expired);
        return true;
      }),
    ).rejects.toThrow('file_target_forbidden');
    expect(await page.locator('body').getAttribute('data-received')).toBeNull();
    expect(await page.locator('body').getAttribute('data-changes')).toBeNull();
  });
  it('keeps only the latest captured native input and never falls back for the previous id', async () => {
    await page.setContent(fixture());
    const r = resolver();
    const previous = await open(r);
    const current = await open(r);
    await r.observe();
    await expect(r.describe(upload(previous), r.observationRevision)).rejects.toThrow(
      'file_target_forbidden',
    );
    const action = upload(current);
    const target = await r.describe(action, r.observationRevision);
    await r.execute(action, binding(target), payloads, () => true);
    await page.waitForFunction(() => document.body.dataset.received === 'sku,qty\nA-731,31\n');
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('2');
    expect(await page.locator('body').getAttribute('data-changes')).toBe('1');
  });
  it.each([false, true])(
    'uploads to the captured actual input without a guessed selector (connected=%s)',
    async (connected) => {
      await page.setContent(fixture(connected));
      const r = resolver();
      const chooserId = await open(r);
      expect(page.listenerCount('filechooser')).toBe(0);
      expect(await page.locator('body').getAttribute('data-received')).toBeNull();
      await r.observe();
      const action = upload(chooserId);
      const target = await r.describe(action, r.observationRevision);
      expect(target.fileInput).toMatchObject({
        accept: '.csv',
        selectedCount: 0,
        formOrigin: origin,
      });
      await r.execute(action, binding(target), payloads, () => true);
      await page.waitForFunction(() => document.body.dataset.received === 'sku,qty\nA-731,31\n');
      expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
      expect(await page.locator('body').getAttribute('data-changes')).toBe('1');
      await r.observe();
      await expect(r.describe(action, r.observationRevision)).rejects.toThrow(
        'file_target_forbidden',
      );
    },
  );
  it.each(['replace', 'history', 'cancel'] as const)(
    'rechecks %s after interception enables and never dispatches a stale click',
    async (change) => {
      await page.setContent(fixture(true));
      let allowed = true;
      const r = resolver(async (method, params) => {
        const result = await cdp(method, params);
        if (method === 'Page.setInterceptFileChooserDialog' && params?.enabled) {
          if (change === 'cancel') allowed = false;
          else
            await page.evaluate((kind) => {
              if (kind === 'replace') {
                const old = document.querySelector('#choose')!;
                old.replaceWith(old.cloneNode(true));
              } else history.pushState({}, '', '/checkout?private_ticket=731');
            }, change);
        }
        return result;
      });
      await r.observe();
      const target = await r.describe(click, r.observationRevision);
      const pending = r.captureFileChooser(click, binding(target), () => allowed);
      if (change === 'cancel') expect(await pending).toMatchObject({ status: 'not_applied' });
      else await expect(pending).rejects.toMatchObject({ clickOutcome: 'not_applied' });
      expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
      expect(page.listenerCount('filechooser')).toBe(0);
    },
  );
  it.each(['replace', 'metadata', 'history'] as const)(
    'refuses captured input %s during file confirmation instead of resolving another input',
    async (change) => {
      await page.setContent(fixture(true));
      const r = resolver();
      const chooserId = await open(r);
      await r.observe();
      const action = upload(chooserId);
      const target = await r.describe(action, r.observationRevision);
      await page.evaluate((kind) => {
        const f = document.querySelector<HTMLInputElement>('#actual')!;
        if (kind === 'replace') f.replaceWith(f.cloneNode());
        else if (kind === 'metadata') f.accept = '.pdf';
        else history.pushState({}, '', '/receive?different_ticket=731');
      }, change);
      await expect(r.execute(action, binding(target), payloads, () => true)).rejects.toThrow();
      expect(await page.locator('body').getAttribute('data-received')).toBeNull();
      expect(
        await page.locator('#actual').evaluate((el) => (el as HTMLInputElement).files?.length),
      ).toBe(0);
    },
  );
  it('does not carry a native chooser across a document replacement or a resolver/session', async () => {
    await page.setContent(fixture());
    const r = resolver();
    const chooserId = await open(r);
    const other = resolver();
    await other.observe();
    await expect(other.describe(upload(chooserId), other.observationRevision)).rejects.toThrow(
      'file_target_forbidden',
    );
    await page.goto(`${origin}/replacement`);
    await r.observe();
    await expect(r.describe(upload(chooserId), r.observationRevision)).rejects.toThrow(
      'file_target_forbidden',
    );
    expect(await page.locator('body').getAttribute('data-received')).toBeNull();
  });
});

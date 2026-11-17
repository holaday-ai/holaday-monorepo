/// <reference path="../../../../../packages/browser-driver/node_modules/@types/chrome/index.d.ts" />
import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import {
  type SelectedChromeUploadCommand,
  USER_BROWSER_PROTOCOL,
  selectedChromeSessionCommandSchema,
} from '@holaday/shared-types';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaywrightCrxAdapter } from '../../../../../packages/browser-driver/src/crx-adapter.js';
import {
  SelectedChromeSession,
  type SessionReply,
} from '../../../../extension/src/background/selected-chrome-session.js';

const boundary = vi.hoisted(() => ({ get: vi.fn(), files: new Map<string, Uint8Array>() }));
// Only the CRX connection and its public virtual filesystem are substituted.
// Adapter, resolver, session, file stager and browser effects all run for real.
vi.mock('../../../../../packages/browser-driver/node_modules/playwright-crx', () => ({
  crx: {
    get: boundary.get,
    fs: {
      writeFileSync: (path: string, bytes: Uint8Array) => {
        if (boundary.files.has(path)) throw new Error('existing virtual file');
        boundary.files.set(path, Uint8Array.from(bytes));
      },
      readFileSync: (path: string) => {
        const bytes = boundary.files.get(path);
        if (!bytes) throw new Error('missing virtual file');
        return Buffer.from(bytes);
      },
      unlinkSync: (path: string) => {
        boundary.files.delete(path);
      },
    },
  },
}));
const chooserCapability = 'task_file_chooser_v1';
const uploadCapability = 'task_file_upload_v1';
const token = '22222222-2222-4222-8222-222222222222';
const selector = {
  description: 'Choose report',
  strategies: [{ kind: 'css' as const, value: '#choose' }],
  scope: { timeoutMs: 2000 },
  selfHeal: false,
};
const action = { kind: 'click' as const, selector };
const binding = { token, observationRevision: 1 };
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
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<body></body>');
});
let browser: Browser;
let page: Page & Pick<EventEmitter, 'listenerCount'>;
let cdp: CDPSession;
let origin: string;
let send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
const sessions: SelectedChromeSession[] = [];
const auxiliaryPages: Page[] = [];
const ok = (reply: SessionReply) => {
  if (!reply.ok) throw new Error(reply.error);
  return reply;
};
const parsedUpload = (input: unknown) =>
  selectedChromeSessionCommandSchema.parse(input) as SelectedChromeUploadCommand;
const fixture =
  "<button id=\"choose\" type=\"button\" onclick=\"document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);const file=document.createElement('input');file.type='file';file.accept='.csv';file.onchange=async()=>{document.body.dataset.changes='1';document.body.dataset.received=await file.files[0].text()};file.click()\">Choose report</button>";
const harness = async (enabled = true) => {
  let owner = 'alice';
  const actual: { driver?: PlaywrightCrxAdapter } = {};
  const session = new SelectedChromeSession({
    owner: () => owner,
    newTab: async (url) => {
      const created = await browser.newPage();
      auxiliaryPages.push(created);
      await created.goto(url);
      throw new Error('fixture stops after actual native tab creation');
    },
    makeDriver: (tabId, options) => {
      const driver = new PlaywrightCrxAdapter({
        attachToTabId: tabId,
        allowedOrigins: options?.origins,
        userBrowserRoutingV2: options?.v2,
      });
      actual.driver = driver;
      return driver;
    },
  });
  sessions.push(session);
  const opened = ok(
    await session.open({
      taskId: 'task-a',
      tabId: 731,
      validate: async () => {},
      protocol: {
        ...USER_BROWSER_PROTOCOL,
        capabilities: [
          ...USER_BROWSER_PROTOCOL.capabilities,
          uploadCapability,
          ...(enabled ? [chooserCapability] : []),
        ],
      },
      grantedOrigins: [origin],
    }),
  );
  const described = ok(await session.describe('task-a', opened.sessionId, action, 1));
  if (!actual.driver) throw new Error('actual driver missing');
  return {
    session,
    opened,
    driver: actual.driver,
    setOwner: (next: string) => {
      owner = next;
    },
    command: {
      op: 'chooser_open' as const,
      sessionId: opened.sessionId,
      action,
      binding: {
        token: described.target!.token,
        observationRevision: described.target!.observationRevision,
      },
    },
  };
};
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  page = (await browser.newPage()) as typeof page;
  cdp = await page.context().newCDPSession(page);
});
beforeEach(async () => {
  await page.goto(origin);
  await page.setContent(fixture);
  send = (method, params) => cdp.send(method as never, params as never);
  boundary.get.mockResolvedValue({
    on: () => {},
    off: () => {},
    attach: async () => page,
    detach: async () => {},
  });
  vi.stubGlobal('chrome', {
    debugger: {
      sendCommand: async (_target: unknown, method: string, params?: Record<string, unknown>) =>
        send(method, params),
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const session of sessions.splice(0)) await session.stopTask('task-a');
  for (const created of auxiliaryPages.splice(0)) await created.close();
  page.removeAllListeners('filechooser');
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
  vi.unstubAllGlobals();
  boundary.files.clear();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('optional native chooser session protocol with actual adapter and browser', () => {
  it('preserves a real obscured target refusal without claiming native input uncertainty', async () => {
    const h = await harness();
    await page.locator('body').evaluate((body) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:white';
      body.append(overlay);
    });
    ok(await h.session.observe('task-a', h.opened.sessionId));
    const read = await h.session.describe('task-a', h.opened.sessionId, action, 2);
    expect(read).toMatchObject({ ok: false, error: 'target_obscured' });
    expect(await h.session.openChooser('task-a', h.command)).toMatchObject({
      ok: false,
      error: 'target_binding_required',
      actionOutcome: 'not_applied',
    });
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('keeps a real CSS hit-test obstruction before native dispatch as not applied', async () => {
    const h = await harness();
    await page.addStyleTag({
      content: '#shield{position:fixed;inset:0;z-index:999;pointer-events:none;background:white}',
    });
    await page.locator('body').evaluate((body) => {
      const overlay = document.createElement('div');
      overlay.id = 'shield';
      body.append(overlay);
    });
    ok(await h.session.observe('task-a', h.opened.sessionId));
    const described = ok(await h.session.describe('task-a', h.opened.sessionId, action, 2));
    await page.evaluate(() => {
      const sheet = Array.from(document.styleSheets).find((sheet) =>
        Array.from(sheet.cssRules).some(
          (rule) => (rule as CSSStyleRule).selectorText === '#shield',
        ),
      )!;
      (sheet.cssRules[0] as CSSStyleRule).style.pointerEvents = 'auto';
    });
    const result = await h.session.execute('task-a', h.opened.sessionId, action, {
      token: described.target!.token,
      observationRevision: 2,
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'target_obscured',
      actionOutcome: 'not_applied',
    });
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('does not return an old owner chooser capability when identity changes during the final real observation', async () => {
    const h = await harness();
    const observe = h.driver.observeCurrentPage.bind(h.driver);
    vi.spyOn(h.driver, 'observeCurrentPage').mockImplementationOnce(async () => {
      const result = await observe();
      h.setOwner('bob');
      return result;
    });
    const result = await h.session.openChooser('task-a', h.command);
    expect(result).toMatchObject({ ok: false, error: 'session_stopped', actionOutcome: 'applied' });
    expect('chooserState' in result).toBe(false);
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
    expect(await page.locator('body').getAttribute('data-received')).toBeNull();
  });
  it('accepts only a bound click and one upload target channel', () => {
    const command = { op: 'chooser_open', sessionId: token, action, binding };
    expect(selectedChromeSessionCommandSchema.safeParse(command).success).toBe(true);
    expect(
      selectedChromeSessionCommandSchema.safeParse({ ...command, binding: undefined }).success,
    ).toBe(false);
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        ...command,
        action: { kind: 'key', payload: { key: 'Enter' } },
      }).success,
    ).toBe(false);
    const upload = {
      op: 'upload_describe',
      sessionId: token,
      observationRevision: 1,
      action: { kind: 'upload', payload: { files, chooserId: token } },
    };
    expect(selectedChromeSessionCommandSchema.safeParse(upload).success).toBe(true);
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        ...upload,
        action: { ...upload.action, selector },
      }).success,
    ).toBe(false);
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        ...upload,
        action: { kind: 'upload', payload: { files } },
      }).success,
    ).toBe(false);
  });
  it('negotiates a separate chooser capability and delivers staged bytes to the original native input', async () => {
    const h = await harness();
    expect(h.opened.protocol?.capabilities).toContain(chooserCapability);
    const captured = ok(await h.session.openChooser('task-a', h.command));
    expect(captured.chooserState?.status).toBe('captured');
    if (captured.chooserState?.status !== 'captured') throw new Error('native chooser missing');
    expect(captured.actionOutcome).toBe('applied');
    expect(page.listenerCount('filechooser')).toBe(0);
    const upload = {
      kind: 'upload',
      payload: { files, chooserId: captured.chooserState.chooserId },
    };
    const revision = (captured.observation as { observationRevision: number }).observationRevision;
    const described = ok(
      await h.session.upload(
        'task-a',
        parsedUpload({
          op: 'upload_describe',
          sessionId: h.opened.sessionId,
          action: upload,
          observationRevision: revision,
        }),
      ),
    );
    const begun = ok(
      await h.session.upload(
        'task-a',
        parsedUpload({
          op: 'upload_begin',
          sessionId: h.opened.sessionId,
          action: upload,
          binding: { token: described.target!.token, observationRevision: revision },
        }),
      ),
    );
    if (begun.uploadState?.phase !== 'begun') throw new Error('native staging missing');
    const transferId = begun.uploadState.transferId;
    ok(
      await h.session.upload(
        'task-a',
        parsedUpload({
          op: 'upload_chunk',
          sessionId: h.opened.sessionId,
          transferId,
          fileIndex: 0,
          offset: 0,
          data: bytes.toString('base64'),
        }),
      ),
    );
    const completed = ok(
      await h.session.upload(
        'task-a',
        parsedUpload({ op: 'upload_commit', sessionId: h.opened.sessionId, transferId }),
      ),
    );
    expect(completed.uploadState).toMatchObject({
      phase: 'finished',
      receipt: { status: 'handed_to_page' },
    });
    await page.waitForFunction(() => document.body.dataset.received === 'sku,qty\nA-731,31\n');
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
    expect(await page.locator('body').getAttribute('data-changes')).toBe('1');
    expect(boundary.files.size).toBe(0);
  });
  it('keeps legacy upload negotiation from authorizing a chooser id or file-button click', async () => {
    const h = await harness(false);
    expect(h.opened.protocol?.capabilities).not.toContain(chooserCapability);
    expect(await h.session.openChooser('task-a', h.command)).toMatchObject({
      ok: false,
      error: 'capability_missing',
      actionOutcome: 'not_applied',
    });
    expect(
      await h.session.upload(
        'task-a',
        parsedUpload({
          op: 'upload_describe',
          sessionId: h.opened.sessionId,
          action: { kind: 'upload', payload: { files, chooserId: token } },
          observationRevision: 1,
        }),
      ),
    ).toMatchObject({ ok: false, error: 'capability_missing' });
    expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
  });
  it('synchronously aborts chooser interception on stop while acquisition acknowledgement still drains', async () => {
    const h = await harness();
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      resume = resolve;
    });
    send = async (method, params) => {
      const result = await cdp.send(method as never, params as never);
      if (method === 'Page.setInterceptFileChooserDialog' && params?.enabled) {
        entered();
        await released;
      }
      return result;
    };
    const pending = h.session.openChooser('task-a', h.command);
    await started;
    try {
      h.session.stopUploadAdmission('task-a');
      await vi.waitFor(() => expect(page.listenerCount('filechooser')).toBe(0));
      resume();
      expect(await pending).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
      expect(await page.locator('body').getAttribute('data-clicks')).toBeNull();
    } finally {
      resume();
      await pending;
    }
  });
  it('retains applied click evidence but stops further input when restoring interception is unconfirmed', async () => {
    const h = await harness();
    send = async (method, params) => {
      if (method === 'Page.setInterceptFileChooserDialog' && params?.enabled === false)
        throw new Error('private restore acknowledgement');
      return cdp.send(method as never, params as never);
    };
    expect(await h.session.openChooser('task-a', h.command)).toMatchObject({
      ok: false,
      error: 'chooser_restore_unconfirmed',
      actionOutcome: 'applied',
    });
    expect(
      await h.session.execute('task-a', h.opened.sessionId, action, h.command.binding),
    ).toMatchObject({ ok: false, actionOutcome: 'unknown' });
    const pagesBefore = browser.contexts().flatMap((context) => context.pages()).length;
    const nextTab = await h.session.tabs('task-a', h.opened.sessionId, {
      operation: 'new',
      url: origin,
    });
    expect(browser.contexts().flatMap((context) => context.pages()).length).toBe(pagesBefore);
    expect(nextTab).toMatchObject({
      ok: false,
      error: 'input_outcome_unknown',
      actionOutcome: 'unknown',
    });
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
    expect(await page.locator('body').getAttribute('data-received')).toBeNull();
  });
  it('does not repeat an actual native click whose acknowledgement was lost', async () => {
    const h = await harness();
    const original = page.mouse.click.bind(page.mouse);
    vi.spyOn(page.mouse, 'click').mockImplementationOnce(async (x, y, options) => {
      await original(x, y, options);
      throw new Error('private native ack');
    });
    expect(await h.session.openChooser('task-a', h.command)).toMatchObject({
      ok: false,
      error: 'input_outcome_unknown',
      actionOutcome: 'unknown',
    });
    expect(await h.session.openChooser('task-a', h.command)).toMatchObject({
      ok: false,
      actionOutcome: 'unknown',
    });
    expect(await page.locator('body').getAttribute('data-clicks')).toBe('1');
    expect(await page.locator('body').getAttribute('data-received')).toBeNull();
  });
});

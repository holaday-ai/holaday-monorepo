import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaywrightCrxAdapter } from './crx-adapter.js';
import { DRIVER_ERRORS } from './driver.js';

const crxBoundary = vi.hoisted(() => ({
  start: vi.fn<() => Promise<unknown>>(),
  get: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('playwright-crx', () => ({
  crx: { start: crxBoundary.start, get: crxBoundary.get },
}));

function createCrxBoundary(
  overrides: {
    url?: string;
    title?: string;
    bodyText?: string;
    ariaSnapshot?: string;
  } = {},
) {
  type AttachedListener = (data: { page: unknown; tabId: number }) => void;
  const attachedListeners = new Set<AttachedListener>();
  const actionLocator = {
    first: vi.fn(),
    waitFor: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
  };
  actionLocator.first.mockReturnValue(actionLocator);

  const bodyLocator = {
    innerText: vi.fn(async () => overrides.bodyText ?? 'Selected tab body'),
    ariaSnapshot: vi.fn(async () => overrides.ariaSnapshot ?? '- heading "Selected tab"'),
  };
  const page = {
    isClosed: vi.fn(() => false),
    url: vi.fn(() => overrides.url ?? 'https://allowed.example/private/path?token=secret'),
    title: vi.fn(async () => overrides.title ?? 'Selected tab'),
    locator: vi.fn((selector: string) => (selector === 'body' ? bodyLocator : actionLocator)),
    getByRole: vi.fn(() => actionLocator),
    goto: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    bringToFront: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    keyboard: {
      press: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
    },
  };
  const app = {
    on: vi.fn((event: string, listener: AttachedListener) => {
      if (event === 'attached') attachedListeners.add(listener);
    }),
    off: vi.fn((event: string, listener: AttachedListener) => {
      if (event === 'attached') attachedListeners.delete(listener);
    }),
    attach: vi.fn(async (_tabId: number) => page),
    newPage: vi.fn(async () => page),
    detach: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  let started = false;
  crxBoundary.get.mockImplementation(async () => (started ? app : undefined));
  crxBoundary.start.mockImplementation(async () => {
    if (started) throw new Error('crxApplication is already started');
    started = true;
    return app;
  });
  return {
    actionLocator,
    app,
    bodyLocator,
    page,
    emitAttached: (tabId: number, attachedPage: unknown = page) => {
      for (const listener of attachedListeners) listener({ page: attachedPage, tabId });
    },
    attachedListenerCount: () => attachedListeners.size,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlaywrightCrxAdapter selected-tab bridge', () => {
  it('rejects attach without a constructor tab id before starting CRX', async () => {
    const adapter = new PlaywrightCrxAdapter();

    const result = await adapter.attachExistingTab();

    expect(result).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.NOT_ATTACHED },
    });
    expect(crxBoundary.start).not.toHaveBeenCalled();
  });

  it('returns an explicit attach error without falling back to a new page', async () => {
    const { app, page } = createCrxBoundary();
    app.attach.mockRejectedValueOnce(new Error('debugger denied'));
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });

    const result = await adapter.attachExistingTab();

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: DRIVER_ERRORS.NOT_ATTACHED,
        message: expect.stringContaining('debugger denied'),
      },
    });
    expect(app.attach).toHaveBeenCalledWith(42);
    expect(app.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('reuses the same live attachment instead of attaching twice', async () => {
    const { app, page } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter({
      attachToTabId: 42,
      allowedOrigins: ['allowed.example'],
    });

    expect(await adapter.attachExistingTab()).toEqual({ status: 'ok', data: { tabId: 42 } });
    expect(await adapter.attachExistingTab()).toEqual({ status: 'ok', data: { tabId: 42 } });

    expect(app.attach).toHaveBeenCalledTimes(1);
    expect(page.goto).not.toHaveBeenCalled();
    expect(app.newPage).not.toHaveBeenCalled();
  });

  it('reuses the singleton CRX application for a later selected adapter', async () => {
    const { app } = createCrxBoundary();
    const first = new PlaywrightCrxAdapter({ attachToTabId: 41 });
    const second = new PlaywrightCrxAdapter({ attachToTabId: 42 });

    expect(await first.attachExistingTab()).toEqual({ status: 'ok', data: { tabId: 41 } });
    await first.dispose();
    expect(await second.attachExistingTab()).toEqual({ status: 'ok', data: { tabId: 42 } });

    expect(crxBoundary.get).toHaveBeenCalledTimes(2);
    expect(crxBoundary.start).toHaveBeenCalledTimes(1);
    expect(app.attach.mock.calls.map(([tabId]) => tabId)).toEqual([41, 42]);
    expect(app.close).not.toHaveBeenCalled();
  });

  it('preserves the legacy adapter start and application-close lifecycle', async () => {
    const { app } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter();

    await adapter.execute({ kind: 'goto', payload: { url: 'https://allowed.example/' } });
    await adapter.dispose();

    expect(crxBoundary.get).toHaveBeenCalledTimes(1);
    expect(crxBoundary.start).toHaveBeenCalledTimes(1);
    expect(app.newPage).toHaveBeenCalledTimes(1);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('reuses the selected-session singleton when legacy execution resumes after close', async () => {
    const { app } = createCrxBoundary();
    const selected = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    expect(await selected.attachExistingTab()).toMatchObject({ status: 'ok' });
    await selected.dispose();

    const legacy = new PlaywrightCrxAdapter();
    expect(
      await legacy.execute({ kind: 'goto', payload: { url: 'https://allowed.example/' } }),
    ).toMatchObject({ status: 'ok' });
    await legacy.dispose();

    expect(crxBoundary.start).toHaveBeenCalledTimes(1);
    expect(crxBoundary.get).toHaveBeenCalledTimes(2);
    expect(app.attach).toHaveBeenCalledWith(42);
    expect(app.detach).toHaveBeenCalledTimes(1);
    expect(app.newPage).toHaveBeenCalledTimes(1);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('uses the existing resilient selector for the first click without navigation', async () => {
    const { actionLocator, app, page } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter({
      attachToTabId: 42,
      allowedOrigins: ['allowed.example'],
    });
    await adapter.attachExistingTab();

    const result = await adapter.execute({
      kind: 'click',
      selector: {
        description: 'Continue',
        strategies: [{ kind: 'role', role: 'button', name: 'Continue' }],
        scope: { timeoutMs: 5_000 },
        selfHeal: true,
      },
    });

    expect(result).toEqual({ status: 'ok', data: { clicked: 'Continue' } });
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Continue', exact: false });
    expect(actionLocator.waitFor).toHaveBeenCalledWith({ state: 'attached', timeout: 2_000 });
    expect(actionLocator.click).toHaveBeenCalledWith({ timeout: 5_000 });
    expect(app.attach).toHaveBeenCalledTimes(1);
    expect(app.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.reload).not.toHaveBeenCalled();
    expect(page.bringToFront).not.toHaveBeenCalled();
  });

  it('returns a wait timeout when every resilient selector strategy fails', async () => {
    const { actionLocator } = createCrxBoundary();
    actionLocator.waitFor.mockRejectedValue(new Error('Timeout 2000ms exceeded'));
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();

    const result = await adapter.execute({
      kind: 'wait',
      selector: {
        description: 'Missing status',
        strategies: [{ kind: 'role', role: 'status', name: 'Ready' }],
        scope: { timeoutMs: 5_000 },
        selfHeal: true,
      },
    });

    expect(result).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.WAIT_TIMEOUT },
    });
  });

  it('rejects a selected tab whose current origin is not allowed', async () => {
    const { app, page } = createCrxBoundary({ url: 'https://blocked.example/private' });
    const adapter = new PlaywrightCrxAdapter({
      attachToTabId: 42,
      allowedOrigins: ['allowed.example'],
    });

    const result = await adapter.attachExistingTab();

    expect(result).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.ORIGIN_BLOCKED },
    });
    expect(app.detach).toHaveBeenCalledWith(page);
    expect(app.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('keeps the non-goto origin guard after a selected tab changes origin', async () => {
    const { actionLocator, page } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter({
      attachToTabId: 42,
      allowedOrigins: ['allowed.example'],
    });
    await adapter.attachExistingTab();
    page.url.mockReturnValue('https://blocked.example/redirected');

    const result = await adapter.execute({
      kind: 'click',
      selector: {
        description: 'Continue',
        strategies: [{ kind: 'role', role: 'button', name: 'Continue' }],
        scope: { timeoutMs: 5_000 },
        selfHeal: true,
      },
    });

    expect(result).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.ORIGIN_BLOCKED },
    });
    expect(actionLocator.click).not.toHaveBeenCalled();
  });

  it('returns an error when observation is requested before attachment', async () => {
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });

    const result = await adapter.observeCurrentPage();

    expect(result).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.NOT_ATTACHED },
    });
    expect(crxBoundary.start).not.toHaveBeenCalled();
  });

  it('does not reattach or select another page after the selected tab closes', async () => {
    const { app, page } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();
    page.isClosed.mockReturnValue(true);

    const result = await adapter.observeCurrentPage();

    expect(result).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.NOT_ATTACHED },
    });
    expect(app.attach).toHaveBeenCalledTimes(1);
    expect(app.newPage).not.toHaveBeenCalled();
  });

  it('ignores attached events for tabs not owned by the selected adapter', async () => {
    const { emitAttached } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();

    emitAttached(99, { unrelated: true });
    const result = await adapter.observeCurrentPage();

    expect(result).toMatchObject({ status: 'ok', data: { tabId: 42 } });
  });

  it('returns only the origin and caps every structured observation field', async () => {
    const { bodyLocator, page } = createCrxBoundary({
      title: 't'.repeat(600),
      bodyText: 'b'.repeat(8_500),
      ariaSnapshot: 'a'.repeat(16_500),
    });
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();

    const result = await adapter.observeCurrentPage();

    expect(result).toEqual({
      status: 'ok',
      data: {
        tabId: 42,
        origin: 'https://allowed.example',
        title: 't'.repeat(512),
        bodyText: 'b'.repeat(8_000),
        ariaSnapshot: 'a'.repeat(16_000),
        truncated: true,
      },
    });
    expect(page.locator).toHaveBeenCalledWith('body');
    expect(bodyLocator.innerText).toHaveBeenCalledWith({ timeout: 5_000 });
    expect(bodyLocator.ariaSnapshot).toHaveBeenCalledWith({ timeout: 5_000 });
    expect(JSON.stringify(result)).not.toContain('/private/path');
    expect(JSON.stringify(result)).not.toContain('token=secret');
  });

  it('returns an error instead of empty success when observation fails', async () => {
    const { bodyLocator } = createCrxBoundary();
    bodyLocator.ariaSnapshot.mockRejectedValueOnce(new Error('snapshot unavailable'));
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();

    const result = await adapter.observeCurrentPage();

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: DRIVER_ERRORS.EXTRACT_FAILED,
        message: expect.stringContaining('snapshot unavailable'),
      },
    });
  });

  it('rejects an observation when the raw URL changes at the same origin', async () => {
    const { page } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();
    page.url
      .mockReturnValueOnce('https://allowed.example/projects/one')
      .mockReturnValue('https://allowed.example/projects/two');

    const result = await adapter.observeCurrentPage();

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: DRIVER_ERRORS.EXTRACT_FAILED,
        message: expect.stringContaining('URL changed during observation'),
      },
    });
    expect(result.data).toBeUndefined();
  });

  it.each(['about:blank', 'file:///private/report.html'])(
    'rejects non-HTTP(S) observation metadata for %s',
    async (url) => {
      createCrxBoundary({ url });
      const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
      expect(await adapter.attachExistingTab()).toMatchObject({ status: 'ok' });

      const result = await adapter.observeCurrentPage();

      expect(result).toMatchObject({
        status: 'error',
        error: { code: DRIVER_ERRORS.EXTRACT_FAILED },
      });
      expect(result.data).toBeUndefined();
    },
  );

  it('detaches only the selected page on dispose and never closes the user tab', async () => {
    const { app, attachedListenerCount, page } = createCrxBoundary();
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();
    expect(attachedListenerCount()).toBe(1);

    await adapter.dispose();

    expect(app.detach).toHaveBeenCalledTimes(1);
    expect(app.detach).toHaveBeenCalledWith(page);
    expect(app.close).not.toHaveBeenCalled();
    expect(page.close).not.toHaveBeenCalled();
    expect(attachedListenerCount()).toBe(0);
    expect(app.off).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected page handle fail-closed so a failed detach can be retried', async () => {
    const { app, attachedListenerCount, page } = createCrxBoundary();
    app.detach.mockRejectedValueOnce(new Error('debugger detach busy'));
    const adapter = new PlaywrightCrxAdapter({ attachToTabId: 42 });
    await adapter.attachExistingTab();

    await expect(adapter.dispose()).rejects.toThrow('debugger detach busy');
    expect(attachedListenerCount()).toBe(0);
    expect(await adapter.observeCurrentPage()).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.NOT_ATTACHED },
    });
    expect(await adapter.execute({ kind: 'wait' })).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.NOT_ATTACHED },
    });
    expect(await adapter.attachExistingTab()).toMatchObject({
      status: 'error',
      error: { code: DRIVER_ERRORS.NOT_ATTACHED },
    });

    await adapter.dispose();

    expect(app.detach).toHaveBeenCalledTimes(2);
    expect(app.detach).toHaveBeenNthCalledWith(1, page);
    expect(app.detach).toHaveBeenNthCalledWith(2, page);
    expect(app.close).not.toHaveBeenCalled();
    expect(page.close).not.toHaveBeenCalled();
  });
});

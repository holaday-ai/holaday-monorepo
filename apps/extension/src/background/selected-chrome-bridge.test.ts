import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserExecutionOwnership } from './browser-execution-ownership.js';
import { createSelectedChromeBridge } from './selected-chrome-bridge.js';
import { createSelectedChromeTransport } from './selected-chrome-transport.js';
import { listReadableTabs, resetTabSelectionsForTests } from './selected-tab-read.js';

const native = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn(),
  owner: 'owner-a',
}));
vi.mock('playwright-crx', () => ({ crx: { start: native.start, get: native.get } }));
vi.mock('./ws-client.js', () => ({ getCurrentWsToken: () => native.owner }));

function browserBoundary() {
  let url = 'https://work.example/private/path?token=not-for-metadata';
  let saved = false;
  const control = {
    first: vi.fn(),
    waitFor: vi.fn(async () => {}),
    click: vi.fn(async () => {
      saved = true;
    }),
  };
  control.first.mockReturnValue(control);
  const page = {
    isClosed: () => false,
    url: () => url,
    title: async () => 'Projects',
    // Sensitive-field scan used by observation redaction (no secrets here).
    evaluate: async () => [],
    locator: () => ({
      innerText: async () => (saved ? 'Saved' : 'Draft'),
      ariaSnapshot: async () => (saved ? '- status "Saved"' : '- button "Save"'),
    }),
    getByRole: vi.fn(() => control),
    goto: vi.fn(),
    close: vi.fn(),
  };
  const app = {
    on: vi.fn(),
    off: vi.fn(),
    removeListener: vi.fn(),
    attach: vi.fn(async () => page),
    detach: vi.fn(async () => {}),
    newPage: vi.fn(),
    close: vi.fn(),
  };
  native.get.mockResolvedValue(undefined);
  native.start.mockResolvedValue(app);
  const tabs = {
    query: vi.fn(async () => [{ id: 42, url, title: 'Projects', active: false }]),
    get: vi.fn(async () => ({ id: 42, url })),
  };
  vi.stubGlobal('chrome', {
    tabs,
    scripting: {
      executeScript: vi.fn(async () => [
        { result: { url, title: 'Projects', bodyText: 'Draft', truncated: false } },
      ]),
    },
  });
  return {
    app,
    page,
    control,
    tabs,
    changePage: () => {
      url = 'https://work.example/other';
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.owner = 'owner-a';
  resetTabSelectionsForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selected Chrome bridge with native adapter and real selection/session logic', () => {
  it('opens a second session using the existing native application after scoped close', async () => {
    const b = browserBoundary();
    native.start.mockImplementation(async () => {
      native.get.mockResolvedValue(b.app);
      return b.app;
    });
    const selection = (await listReadableTabs()).tabs[0];
    if (!selection) throw new Error('missing tab');
    const target = {
      tabId: selection.tabId,
      selectionId: selection.selectionId,
      expectedUrl: selection.url,
    };
    const bridge = createSelectedChromeBridge();
    const first = await bridge.open('task-a', target);
    if (!first.ok) throw new Error('first attach failed');
    expect(await bridge.close('task-a', first.sessionId)).toEqual({ ok: true });
    const second = await bridge.open('task-b', target);
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) throw new Error('second attach failed');
    await bridge.close('task-b', second.sessionId);
    expect(native.start).toHaveBeenCalledTimes(1);
    expect(b.app.attach).toHaveBeenCalledTimes(2);
    expect(b.app.detach).toHaveBeenCalledTimes(2);
    expect(b.app.close).not.toHaveBeenCalled();
  });

  it('rejects a selection changed while native attachment is in flight', async () => {
    const b = browserBoundary();
    b.app.attach.mockImplementation(async () => {
      b.changePage();
      return b.page;
    });
    const selection = (await listReadableTabs()).tabs[0];
    if (!selection) throw new Error('missing tab');
    const bridge = createSelectedChromeBridge();
    expect(
      await bridge.open('task-a', {
        tabId: selection.tabId,
        selectionId: selection.selectionId,
        expectedUrl: selection.url,
      }),
    ).toMatchObject({ ok: false, error: 'target_changed' });
    expect(b.app.detach).toHaveBeenCalledWith(b.page);
    expect(b.control.click).not.toHaveBeenCalled();
  });
  it('runs selected transport through the real bridge, session and native adapter', async () => {
    const b = browserBoundary();
    const selection = (await listReadableTabs()).tabs[0];
    if (!selection) throw new Error('missing tab');
    const bridge = createSelectedChromeBridge();
    const ownership = createBrowserExecutionOwnership();
    const transport = createSelectedChromeTransport({
      bridge,
      ownership,
      prepareLegacy: async () => {},
      currentOwner: () => native.owner,
    });
    const opened = await transport.handle('task-a', {
      op: 'open',
      target: {
        tabId: selection.tabId,
        selectionId: selection.selectionId,
        expectedUrl: selection.url,
      },
    });
    expect(opened).toMatchObject({
      ok: true,
      observation: { tabId: 42, bodyText: 'Draft', origin: 'https://work.example' },
    });
    if (!opened.ok || !('sessionId' in opened)) throw new Error('attach failed');
    await expect(ownership.runLegacy(async () => {})).rejects.toMatchObject({
      code: 'browser_busy',
    });
    const result = await transport.handle('task-a', {
      op: 'act',
      sessionId: opened.sessionId,
      action: {
        kind: 'click',
        selector: {
          description: 'Save',
          strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
          scope: { timeoutMs: 5000 },
          selfHeal: false,
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      actionOutcome: 'applied',
      observation: { bodyText: 'Saved', ariaSnapshot: '- status "Saved"' },
    });
    expect(b.app.attach).toHaveBeenCalledWith(42);
    expect(b.control.click).toHaveBeenCalledTimes(1);
    expect(b.page.goto).not.toHaveBeenCalled();
    expect(b.app.newPage).not.toHaveBeenCalled();
    expect(JSON.stringify(opened)).not.toContain('not-for-metadata');
    expect(await transport.handle('task-a', { op: 'close', sessionId: opened.sessionId })).toEqual({
      ok: true,
      closed: true,
    });
    await expect(ownership.runLegacy(async () => 'released')).resolves.toBe('released');
    expect(b.app.detach).toHaveBeenCalledWith(b.page);
    expect(b.page.close).not.toHaveBeenCalled();
    expect(b.app.close).not.toHaveBeenCalled();
  });

  it('rejects a tab changed since selection before native attachment', async () => {
    const b = browserBoundary();
    const selection = (await listReadableTabs()).tabs[0];
    if (!selection) throw new Error('missing tab');
    b.changePage();
    const bridge = createSelectedChromeBridge();
    expect(
      await bridge.open('task-a', {
        tabId: 42,
        selectionId: selection.selectionId,
        expectedUrl: selection.url,
      }),
    ).toMatchObject({ ok: false, error: 'target_changed' });
    expect(b.app.attach).not.toHaveBeenCalled();
  });
});

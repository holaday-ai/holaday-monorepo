import { parseServerMessage } from '@holaday/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetExtensionToolInFlightForTests,
  configureExtensionToolRuntime,
  handleExtensionToolCall,
} from './extension-tools.js';
import { getCurrentWsToken, send } from './ws-client.js';

vi.mock('./ws-client.js', () => ({
  getCurrentWsToken: vi.fn(() => null),
  send: vi.fn(() => true),
}));

const target = {
  tabId: 42,
  expectedUrl: 'https://work.example/projects',
  selectionId: undefined as string | undefined,
};
type ReadInjection = {
  target: { tabId: number };
  func: (url: string, max: number) => { url: string; title: string; bodyText: string };
  args: [string, number];
};
async function installBrowser() {
  const chromeMock = {
    tabs: {
      query: vi.fn(async () => [
        { id: 9, url: 'https://unrelated.example/', title: 'Other', active: true },
        { id: 42, url: target.expectedUrl, title: 'Projects', active: false },
        { id: 99, url: 'chrome://settings/', title: 'Settings' },
      ]),
      get: vi.fn(async () => ({ id: 42, url: target.expectedUrl, title: 'Projects' })),
      update: vi.fn(),
      create: vi.fn(),
    },
    windows: { update: vi.fn() },
    scripting: {
      executeScript: vi.fn(async (_injection: ReadInjection) => [
        {
          result: {
            url: target.expectedUrl,
            title: 'Projects',
            bodyText: 'Signed-in project list',
          },
        },
      ]),
    },
  };
  vi.stubGlobal('chrome', chromeMock);
  const reply = await call('tabs');
  if (reply?.type !== 'client.extension.tool_result') throw new Error('missing discovery');
  target.selectionId = (
    reply.result as { tabs: Array<{ tabId: number; selectionId?: string }> }
  ).tabs.find((tab) => tab.tabId === 42)?.selectionId;
  vi.clearAllMocks();
  return chromeMock;
}

async function call(kind: string, args?: unknown) {
  const parsed = parseServerMessage(
    JSON.stringify({
      type: 'server.extension.tool_call',
      taskId: 'task-selected',
      requestId: crypto.randomUUID(),
      kind,
      args,
      timeoutMs: 3000,
    }),
  );
  expect(parsed.success, 'tool must survive the actual wire schema').toBe(true);
  if (!parsed.success || parsed.data.type !== 'server.extension.tool_call')
    throw new Error('bad wire');
  await handleExtensionToolCall(parsed.data);
  return vi.mocked(send).mock.calls.at(-1)?.[0];
}

afterEach(() => {
  _resetExtensionToolInFlightForTests();
  vi.mocked(getCurrentWsToken).mockReturnValue(null);
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('selected Chrome tab read transport', () => {
  it('advertises session execution only when the transport is wired', async () => {
    await installBrowser();
    expect(await call('tabs')).toMatchObject({ result: { selectedSessionVersion: 0 } });
    configureExtensionToolRuntime({
      transport: {
        handle: async () => ({ ok: false, error: 'session_unavailable' }),
        stopTask: async () => {},
      },
      runLegacy: (run) => run(),
    });
    expect(await call('tabs')).toMatchObject({ result: { selectedSessionVersion: 1 } });
    expect(await call('read', { target })).toMatchObject({ result: { selectedSessionVersion: 1 } });
  });
  it('does not export signed query strings, nested redirects or path credentials', async () => {
    const browser = await installBrowser();
    browser.tabs.query.mockResolvedValue([
      {
        id: 42,
        active: false,
        title: 'Report',
        url: 'https://work.example/private/path-secret?sig=signature-secret&redirect=https%3A%2F%2Fother.example%2F%3Ftoken%3Dnested-secret',
      },
    ]);
    const reply = await call('tabs');
    expect(reply).toMatchObject({ ok: true, result: { tabs: [{ url: 'https://work.example' }] } });
    expect(JSON.stringify(reply)).not.toMatch(/path-secret|signature-secret|nested-secret/);
  });

  it('rejects a selection that expires while extraction is pending', async () => {
    vi.useFakeTimers();
    const browser = await installBrowser();
    vi.advanceTimersByTime(10 * 60 * 1000 - 100);
    browser.scripting.executeScript.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return [
        { result: { url: target.expectedUrl, title: 'Expired', bodyText: 'expired content' } },
      ];
    });
    const pending = call('read', { target });
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'target_changed' } });
  });
  it('rejects a fragment-only navigation that is invisible in the sanitized URL', async () => {
    const browser = await installBrowser();
    const url = `${target.expectedUrl}#/other-project`;
    browser.tabs.get.mockResolvedValue({ id: 42, url, title: 'Other project' });
    browser.scripting.executeScript.mockResolvedValue([
      { result: { url, title: 'Other project', bodyText: 'Wrong project' } },
    ]);
    expect(await call('read', { target })).toMatchObject({
      ok: false,
      error: { code: 'target_changed' },
    });
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('expires a page selection rather than silently using a much later document', async () => {
    vi.useFakeTimers();
    const browser = await installBrowser();
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(await call('read', { target })).toMatchObject({
      ok: false,
      error: { code: 'target_changed' },
    });
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not reuse a page selection after the extension account changes', async () => {
    const browser = await installBrowser();
    vi.mocked(getCurrentWsToken).mockReturnValue('another-owner');
    expect(await call('read', { target })).toMatchObject({
      ok: false,
      error: { code: 'target_changed' },
    });
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('caps discovery at 100 web tabs and marks the list incomplete', async () => {
    const browser = await installBrowser();
    browser.tabs.query.mockResolvedValue(
      Array.from({ length: 101 }, (_, id) => ({
        id,
        url: `https://work.example/${id}`,
        title: 'Tab',
        active: false,
      })),
    );
    const reply = await call('tabs');
    expect(reply).toMatchObject({ ok: true, result: { truncated: true } });
    if (reply?.type !== 'client.extension.tool_result') throw new Error('missing result');
    expect((reply.result as { tabs: unknown[] }).tabs).toHaveLength(100);
  });

  it('rejects targeted legacy navigation rather than changing the active tab', async () => {
    const browser = await installBrowser();
    expect(await call('navigate', { target, url: 'https://example.com/' })).toMatchObject({
      ok: false,
      error: { code: 'target_unsupported' },
    });
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.tabs.query).not.toHaveBeenCalled();
  });

  it('executes a bounded isolated-world reader and checks URL before accessing body', async () => {
    const browser = await installBrowser();
    await call('read', { target });
    const injection = browser.scripting.executeScript.mock.calls[0]?.[0];
    if (!injection) throw new Error('missing injection');
    expect(injection).toMatchObject({ world: 'ISOLATED', args: [target.expectedUrl, 8000] });
    vi.stubGlobal('location', { href: target.expectedUrl });
    const readBody = vi.fn(() => ({ innerText: 'x'.repeat(10000) }));
    vi.stubGlobal('document', {
      title: 'Current title',
      get body() {
        return readBody();
      },
    });
    expect(injection.func(...injection.args)).toEqual({
      url: target.expectedUrl,
      title: 'Current title',
      bodyText: 'x'.repeat(8000),
      truncated: true,
    });
    readBody.mockClear();
    vi.stubGlobal('location', { href: 'https://other.example/' });
    expect(injection.func(...injection.args).bodyText).toBe('');
    expect(readBody).not.toHaveBeenCalled();
  });

  it('does not report success if Chrome returns no document result', async () => {
    const browser = await installBrowser();
    browser.scripting.executeScript.mockResolvedValue([]);
    expect(await call('read', { target })).toMatchObject({
      ok: false,
      error: { code: 'read_unavailable' },
    });
  });

  it('lists only web tabs, with credentials and sensitive URL components removed', async () => {
    const browser = await installBrowser();
    browser.tabs.query.mockResolvedValue([
      {
        id: 42,
        url: 'https://name:password@work.example/projects?token=secret&q=hello#private',
        title: 'Projects',
        active: false,
      },
      { id: 99, url: 'chrome://settings/', title: 'Settings', active: true },
    ]);
    const reply = await call('tabs');
    expect(reply).toMatchObject({
      ok: true,
      result: {
        tabs: [
          {
            tabId: 42,
            url: 'https://work.example',
            title: 'Projects',
            active: false,
          },
        ],
        truncated: false,
      },
    });
    expect(JSON.stringify(reply)).not.toMatch(/password|secret|private/);
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('reads the selected background tab without navigating, creating or focusing a tab', async () => {
    const browser = await installBrowser();
    expect(await call('read', { target })).toMatchObject({
      ok: true,
      result: { tabId: 42, finalUrl: 'https://work.example', bodyText: 'Signed-in project list' },
    });
    expect(browser.tabs.get).toHaveBeenCalledWith(42);
    expect(browser.scripting.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 42 },
    });
    expect(browser.tabs.query).not.toHaveBeenCalled();
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
  });

  it('rejects a missing explicit target instead of reading the active tab', async () => {
    const browser = await installBrowser();
    expect(await call('read')).toMatchObject({ ok: false, error: { code: 'target_required' } });
    expect(browser.tabs.query).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not read a selected tab that has navigated elsewhere', async () => {
    const browser = await installBrowser();
    browser.tabs.get.mockResolvedValue({ id: 42, url: 'https://other.example/', title: 'Other' });
    expect(await call('read', { target })).toMatchObject({
      ok: false,
      error: { code: 'target_changed' },
    });
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('discards content if the document navigates between selection and extraction', async () => {
    const browser = await installBrowser();
    browser.scripting.executeScript.mockResolvedValue([
      {
        result: {
          url: 'https://other.example/',
          title: 'Other',
          bodyText: 'DO NOT RETURN THIS CONTENT',
        },
      },
    ]);
    const reply = await call('read', { target });
    expect(reply).toMatchObject({ ok: false, error: { code: 'target_changed' } });
    expect(JSON.stringify(reply)).not.toContain('DO NOT RETURN');
  });

  it('reports a closed target instead of falling back to another tab', async () => {
    const browser = await installBrowser();
    browser.tabs.get.mockRejectedValue(new Error('No tab with id: 42.'));
    expect(await call('read', { target })).toMatchObject({
      ok: false,
      error: { code: 'target_closed' },
    });
    expect(browser.tabs.query).not.toHaveBeenCalled();
  });

  it('reports missing permissions without returning a successful empty read', async () => {
    const browser = await installBrowser();
    browser.scripting.executeScript.mockRejectedValue(new Error('Missing host permission'));
    expect(await call('read', { target })).toMatchObject({
      ok: false,
      error: { code: 'host_permission' },
    });
  });

  it('bounds content and returns a sanitized final URL', async () => {
    const browser = await installBrowser();
    browser.tabs.get.mockResolvedValue({
      id: 42,
      url: `${target.expectedUrl}?token=secret`,
      title: 'Projects',
    });
    browser.tabs.query.mockResolvedValue([
      { id: 42, url: `${target.expectedUrl}?token=secret`, title: 'Projects', active: false },
    ]);
    const discovery = await call('tabs');
    if (discovery?.type !== 'client.extension.tool_result') throw new Error('missing discovery');
    target.selectionId = (
      discovery.result as { tabs: Array<{ selectionId: string }> }
    ).tabs[0]?.selectionId;
    browser.scripting.executeScript.mockResolvedValue([
      {
        result: {
          url: `${target.expectedUrl}?token=secret`,
          title: 'x'.repeat(2000),
          bodyText: 'y'.repeat(20000),
        },
      },
    ]);
    const reply = await call('read', { target });
    expect(reply).toMatchObject({
      ok: true,
      result: { finalUrl: 'https://work.example', truncated: true },
    });
    if (reply?.type !== 'client.extension.tool_result') throw new Error('missing result');
    const result = reply.result as { title: string; bodyText: string };
    expect(result.title.length).toBeLessThanOrEqual(512);
    expect(result.bodyText.length).toBeLessThanOrEqual(8128);
    expect(JSON.stringify(reply)).not.toContain('secret');
  });
});

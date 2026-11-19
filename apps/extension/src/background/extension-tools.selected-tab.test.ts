import { parseServerMessage } from '@holaday/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetExtensionToolInFlightForTests,
  configureExtensionToolRuntime,
  handleExtensionToolCall,
} from './extension-tools.js';
import { prepareIndependentTaskTab } from './selected-tab-read.js';
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

async function call(kind: string, args?: unknown, timeoutMs = 3000) {
  const parsed = parseServerMessage(
    JSON.stringify({
      type: 'server.extension.tool_call',
      taskId: 'task-selected',
      requestId: crypto.randomUUID(),
      kind,
      args,
      timeoutMs,
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
  it('advertises a stable opaque browser-session identity without persisting source URL or token', async () => {
    const browser = await installBrowser();
    const stored: Record<string, unknown> = {};
    Object.assign(browser, {
      storage: {
        session: {
          get: async (key: string) => ({ [key]: stored[key] }),
          set: async (values: Record<string, unknown>) => {
            Object.assign(stored, values);
          },
        },
      },
    });
    configureExtensionToolRuntime({
      transport: { handle: async () => ({ ok: false, error: 'unused' }), stopTask: async () => {} },
      runLegacy: (run) => run(),
    });
    const first = await call('tabs');
    const second = await call('tabs');
    expect(first).toMatchObject({
      result: {
        launchBrowserSessionId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        userBrowserProtocol: { capabilities: expect.arrayContaining(['task_launch_recovery_v1']) },
      },
    });
    expect(
      (second as { result: { launchBrowserSessionId: string } }).result.launchBrowserSessionId,
    ).toBe((first as { result: { launchBrowserSessionId: string } }).result.launchBrowserSessionId);
    expect(JSON.stringify(stored)).not.toContain('work.example');
    expect(JSON.stringify(stored)).not.toContain('token');
  });
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

describe('background task tab preparation', () => {
  const preparationId = '4488c303-9880-44d9-885e-51e13755933b';
  async function readyBrowser() {
    vi.mocked(getCurrentWsToken).mockReturnValue('owner-a');
    const browser = await installBrowser();
    configureExtensionToolRuntime({
      transport: {
        handle: async () => ({ ok: false, error: 'session_unavailable' }),
        stopTask: async () => {},
      },
      runLegacy: (run) => run(),
    });
    browser.tabs.create.mockResolvedValue({
      id: 73,
      url: target.expectedUrl,
      title: 'Projects',
      active: false,
    });
    browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
      id: args[0] as number,
      url: target.expectedUrl,
      title: 'Projects',
      active: args[0] === 9,
    }));
    return browser;
  }
  it('creates a separate inactive task tab without reading or focusing the source page', async () => {
    const browser = await readyBrowser();
    const reply = await call('task_tab', { target, preparationId });
    expect(reply).toMatchObject({
      ok: true,
      result: { taskTabCreated: true, tabId: 73, url: 'https://work.example' },
    });
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: target.expectedUrl, active: false });
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
    expect(
      reply?.type === 'client.extension.tool_result' &&
        (reply.result as { selectionId: string }).selectionId,
    ).toEqual(expect.any(String));
  });
  it('deduplicates retries even when a new wire request id is used', async () => {
    const browser = await readyBrowser();
    const first = await call('task_tab', { target, preparationId });
    const second = await call('task_tab', { target, preparationId });
    expect(first).toMatchObject({ ok: true });
    expect(second?.type === 'client.extension.tool_result' && second.result).toEqual(
      first?.type === 'client.extension.tool_result' && first.result,
    );
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
  });
  function preparedTarget() {
    const selectionId = target.selectionId;
    if (!selectionId) throw new Error('selection missing');
    return { ...target, selectionId };
  }
  it('observes a slow prepared tab again under the same preparation without creating another', async () => {
    vi.useFakeTimers();
    const browser = await readyBrowser();
    let loading = true;
    browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
      id: args[0] as number,
      url: target.expectedUrl,
      title: 'Projects',
      ...(args[0] === 73 && loading ? { status: 'loading', pendingUrl: target.expectedUrl } : {}),
    }));
    const id = '58731392-fb39-48c0-9ea9-7431395567a1';
    const first = prepareIndependentTaskTab(preparedTarget(), id);
    const failed = expect(first).rejects.toThrow('task_tab_not_ready');
    await vi.advanceTimersByTimeAsync(8100);
    await failed;
    loading = false;

    const [retry, concurrent] = await Promise.all([
      prepareIndependentTaskTab(preparedTarget(), id),
      prepareIndependentTaskTab(preparedTarget(), id),
    ]);
    expect(retry).toMatchObject({ taskTabCreated: true, tabId: 73, url: 'https://work.example' });
    expect(concurrent).toEqual(retry);
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('does not reuse a timed-out prepared page after it leaves the authorized origin', async () => {
    vi.useFakeTimers();
    const browser = await readyBrowser();
    let loading = true;
    browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
      id: args[0] as number,
      url: args[0] === 73 && !loading ? 'https://other.example/' : target.expectedUrl,
      title: 'Projects',
      ...(args[0] === 73 && loading ? { status: 'loading' } : {}),
    }));
    const id = '58731392-fb39-48c0-9ea9-7431395567a2';
    const failed = expect(prepareIndependentTaskTab(preparedTarget(), id)).rejects.toThrow(
      'task_tab_not_ready',
    );
    await vi.advanceTimersByTimeAsync(8100);
    await failed;
    loading = false;
    await expect(prepareIndependentTaskTab(preparedTarget(), id)).rejects.toThrow(
      'origin_grant_required',
    );
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
    expect(browser.tabs.update).not.toHaveBeenCalled();
  });
  it('returns the recovered page through a new wire request with the original preparation id', async () => {
    vi.useFakeTimers();
    const browser = await readyBrowser();
    let loading = true;
    browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
      id: args[0] as number,
      url: target.expectedUrl,
      title: 'Projects',
      ...(args[0] === 73 && loading ? { status: 'loading' } : {}),
    }));
    const args = {
      target: preparedTarget(),
      preparationId: '58731392-fb39-48c0-9ea9-7431395567a6',
    };
    const first = call('task_tab', args, 15000);
    await vi.advanceTimersByTimeAsync(8100);
    expect(await first).toMatchObject({ ok: false });
    loading = false;
    expect(await call('task_tab', args, 15000)).toMatchObject({
      ok: true,
      result: { taskTabCreated: true, tabId: 73, url: 'https://work.example' },
    });
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('observes a known page again after its metadata request times out', async () => {
    vi.useFakeTimers();
    const browser = await readyBrowser();
    browser.tabs.get
      .mockImplementationOnce(async () => ({
        id: 42,
        url: target.expectedUrl,
        title: 'Projects',
      }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const id = '58731392-fb39-48c0-9ea9-7431395567a7';
    const failed = expect(prepareIndependentTaskTab(preparedTarget(), id)).rejects.toThrow(
      'extension_tool_timeout',
    );
    await vi.advanceTimersByTimeAsync(1600);
    await failed;
    expect(await prepareIndependentTaskTab(preparedTarget(), id)).toMatchObject({ tabId: 73 });
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('retains an uncertain create failure instead of invoking create again', async () => {
    const browser = await readyBrowser();
    browser.tabs.create.mockRejectedValue(new Error('extension_tool_timeout'));
    const id = '58731392-fb39-48c0-9ea9-7431395567a8';
    await expect(prepareIndependentTaskTab(preparedTarget(), id)).rejects.toThrow(
      'extension_tool_timeout',
    );
    await expect(prepareIndependentTaskTab(preparedTarget(), id)).rejects.toThrow(
      'extension_tool_timeout',
    );
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('does not expire an uncertain creation when another preparation cleans up old entries', async () => {
    vi.useFakeTimers();
    const browser = await readyBrowser();
    const bound = preparedTarget();
    browser.tabs.create.mockRejectedValueOnce(new Error('extension_tool_timeout'));
    const id = '58731392-fb39-48c0-9ea9-7431395567a9';
    await expect(prepareIndependentTaskTab(bound, id)).rejects.toThrow('extension_tool_timeout');
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const discovered = await call('tabs');
    const source = (
      discovered as { result: { tabs: Array<{ tabId: number; selectionId: string }> } }
    ).result.tabs.find((tab) => tab.tabId === 42)!;
    await prepareIndependentTaskTab(
      { ...target, selectionId: source.selectionId },
      '58731392-fb39-48c0-9ea9-7431395567aa',
    );
    await expect(prepareIndependentTaskTab(bound, id)).rejects.toThrow('extension_tool_timeout');
    expect(browser.tabs.create).toHaveBeenCalledTimes(2);
  });
  it('rechecks the owner after a delayed prepared-page observation', async () => {
    vi.useFakeTimers();
    const browser = await readyBrowser();
    let loading = true;
    browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
      id: args[0] as number,
      url: target.expectedUrl,
      title: 'Projects',
      ...(args[0] === 73 && loading ? { status: 'loading' } : {}),
    }));
    const id = '58731392-fb39-48c0-9ea9-7431395567a3';
    const failed = expect(prepareIndependentTaskTab(preparedTarget(), id)).rejects.toThrow(
      'task_tab_not_ready',
    );
    await vi.advanceTimersByTimeAsync(8100);
    await failed;
    loading = false;
    let finish!: (tab: { id: number; url: string; title: string }) => void;
    browser.tabs.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const retried = expect(prepareIndependentTaskTab(preparedTarget(), id)).rejects.toThrow(
      'target_changed',
    );
    vi.mocked(getCurrentWsToken).mockReturnValue('owner-b');
    finish({ id: 73, url: target.expectedUrl, title: 'Projects' });
    await retried;
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
    expect(browser.tabs.update).not.toHaveBeenCalled();
  });
  it('retains an unresolved created page while another preparation expires its selection', async () => {
    vi.useFakeTimers();
    const browser = await readyBrowser();
    const bound = preparedTarget();
    let loading = true;
    browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
      id: args[0] as number,
      url: target.expectedUrl,
      title: 'Projects',
      ...(args[0] === 73 && loading ? { status: 'loading' } : {}),
    }));
    const id = '58731392-fb39-48c0-9ea9-7431395567a4';
    const failed = expect(prepareIndependentTaskTab(bound, id)).rejects.toThrow(
      'task_tab_not_ready',
    );
    await vi.advanceTimersByTimeAsync(8100);
    await failed;
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const discovered = await call('tabs');
    const source = (
      discovered as { result: { tabs: Array<{ tabId: number; selectionId: string }> } }
    ).result.tabs.find((tab) => tab.tabId === 42)!;
    browser.tabs.create.mockResolvedValue({ id: 74, url: target.expectedUrl, title: 'Other task' });
    await prepareIndependentTaskTab(
      { ...target, selectionId: source.selectionId },
      '58731392-fb39-48c0-9ea9-7431395567a5',
    );
    loading = false;
    expect(await prepareIndependentTaskTab(bound, id)).toMatchObject({ tabId: 73 });
    expect(browser.tabs.create).toHaveBeenCalledTimes(2);
    expect(browser.tabs.update).not.toHaveBeenCalled();
  });
  it('rejects an owner switch before opening another tab', async () => {
    const browser = await readyBrowser();
    vi.mocked(getCurrentWsToken).mockReturnValue('owner-b');
    expect(await call('task_tab', { target, preparationId })).toMatchObject({ ok: false });
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });
});

it('keeps a signed start URL local while exporting only an opaque prepared selection', async () => {
  vi.mocked(getCurrentWsToken).mockReturnValue('owner-a');
  const browser = await installBrowser();
  const raw = 'https://work.example/private/signed-path?token=fixture-secret&sig=opaque-value';
  browser.tabs.query.mockResolvedValue([{ id: 42, url: raw, title: 'Report', active: false }]);
  browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
    id: args[0] as number,
    url: raw,
    title: 'Report',
  }));
  browser.tabs.create.mockResolvedValue({ id: 73, url: raw, title: 'Report' });
  configureExtensionToolRuntime({
    transport: {
      handle: async () => ({ ok: false, error: 'session_unavailable' }),
      stopTask: async () => {},
    },
    runLegacy: (run) => run(),
  });
  const discovered = await call('tabs');
  const source = (discovered as { result: { tabs: Array<{ tabId: number; selectionId: string }> } })
    .result.tabs[0];
  if (!source) throw new Error('source tab missing');
  const reply = await call('task_tab', {
    target: {
      tabId: source.tabId,
      selectionId: source.selectionId,
      expectedUrl: 'https://work.example',
    },
    preparationId: '7450cc61-6ab3-421a-8241-f267c418fd3f',
  });
  expect(reply).toMatchObject({ ok: true, result: { tabId: 73, url: 'https://work.example' } });
  expect(browser.tabs.create).toHaveBeenCalledWith({ url: raw, active: false });
  expect(JSON.stringify(reply)).not.toContain('fixture-secret');
  expect(JSON.stringify(reply)).not.toContain('signed-path');
  expect(browser.scripting.executeScript).not.toHaveBeenCalled();
});

it('shares an in-flight preparation rather than opening a second tab on retry', async () => {
  vi.mocked(getCurrentWsToken).mockReturnValue('owner-a');
  const browser = await installBrowser();
  let finish!: (tab: { id: number; url: string }) => void;
  browser.tabs.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  browser.tabs.get.mockImplementation(async (...args: unknown[]) => ({
    id: args[0] as number,
    url: target.expectedUrl,
    title: 'Projects',
  }));
  if (!target.selectionId) throw new Error('selection missing');
  const boundTarget = { ...target, selectionId: target.selectionId };
  const first = prepareIndependentTaskTab(boundTarget, '72cc2a5e-75e1-4484-adcc-60a7a7e9696b');
  await vi.waitFor(() => expect(browser.tabs.create).toHaveBeenCalledTimes(1));
  const retry = prepareIndependentTaskTab(boundTarget, '72cc2a5e-75e1-4484-adcc-60a7a7e9696b');
  finish({ id: 73, url: target.expectedUrl });
  expect(await retry).toEqual(await first);
  expect(browser.tabs.create).toHaveBeenCalledTimes(1);
});

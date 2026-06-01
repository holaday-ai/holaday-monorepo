import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@holaday/shared-types';
import {
  _resetExtensionToolInFlightForTests,
  extensionToolErrorPayload,
  getActiveTabForExtensionTool,
  handleExtensionToolCall,
  normalizeScreenshotCaptureDataUrl,
  normalizeNavigateUrl,
  waitForTabComplete,
} from './extension-tools.js';
import { getCurrentWsToken, send } from './ws-client.js';

vi.mock('./ws-client.js', () => ({
  getCurrentWsToken: vi.fn(() => null),
  send: vi.fn(() => true),
}));

type TabListener = (id: number, info: chrome.tabs.TabChangeInfo) => void;
type TabRemovedListener = (id: number) => void;
type TabStatus = 'loading' | 'complete' | 'unloaded';

function installChromeTabsMock(initialStatus: TabStatus = 'loading'): {
  listeners: Set<TabListener>;
  removedListeners: Set<TabRemovedListener>;
  rejectGetWith: (err: unknown) => void;
  setStatus: (next: TabStatus) => void;
} {
  const listeners = new Set<TabListener>();
  const removedListeners = new Set<TabRemovedListener>();
  let status = initialStatus;
  let getError: unknown = null;
  globalThis.chrome = {
    tabs: {
      get: vi.fn(async () => {
        if (getError) throw getError;
        return { id: 1, status } as chrome.tabs.Tab;
      }),
      onUpdated: {
        addListener: vi.fn((listener: TabListener) => {
          listeners.add(listener);
        }),
        removeListener: vi.fn((listener: TabListener) => {
          listeners.delete(listener);
        }),
      },
      onRemoved: {
        addListener: vi.fn((listener: TabRemovedListener) => {
          removedListeners.add(listener);
        }),
        removeListener: vi.fn((listener: TabRemovedListener) => {
          removedListeners.delete(listener);
        }),
      },
    },
  } as unknown as typeof chrome;
  return {
    listeners,
    removedListeners,
    rejectGetWith(err) {
      getError = err;
    },
    setStatus(next) {
      status = next;
    },
  };
}

afterEach(() => {
  _resetExtensionToolInFlightForTests();
  vi.mocked(getCurrentWsToken).mockReturnValue(null);
  vi.mocked(send).mockReset();
  vi.mocked(send).mockReturnValue(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('waitForTabComplete', () => {
  it('resolves immediately when the tab already reached complete', async () => {
    const mock = installChromeTabsMock('complete');

    await expect(waitForTabComplete(1, 25_000)).resolves.toBeUndefined();

    expect(mock.listeners.size).toBe(0);
    expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledTimes(1);
  });

  it('resolves from the onUpdated complete event', async () => {
    const mock = installChromeTabsMock('loading');
    const pending = waitForTabComplete(1, 25_000);
    await Promise.resolve();

    mock.setStatus('complete');
    for (const listener of mock.listeners) {
      listener(1, { status: 'complete' });
    }

    await expect(pending).resolves.toBeUndefined();
    expect(mock.listeners.size).toBe(0);
  });

  it('does not accept the old complete page before a new navigation starts', async () => {
    vi.useFakeTimers();
    const mock = installChromeTabsMock('complete');
    const pending = waitForTabComplete(1, 25_000, {
      previousUrl: 'https://old.example/page',
      targetUrl: 'https://new.example/page',
    });
    await Promise.resolve();

    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    for (const listener of mock.listeners) {
      listener(1, { status: 'loading', url: 'https://new.example/page' });
      listener(1, { status: 'complete', url: 'https://new.example/page' });
    }

    await expect(pending).resolves.toBeUndefined();
  });

  it('still accepts already-complete tabs when navigating to the same url', async () => {
    installChromeTabsMock('complete');

    await expect(
      waitForTabComplete(1, 25_000, {
        previousUrl: 'https://example.com/page#old',
        targetUrl: 'https://example.com/page#new',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects immediately when the tab is closed during navigation', async () => {
    const mock = installChromeTabsMock('loading');
    const pending = waitForTabComplete(1, 25_000);
    await Promise.resolve();

    for (const listener of mock.removedListeners) {
      listener(1);
    }

    await expect(pending).rejects.toThrow('tab_closed');
    expect(mock.listeners.size).toBe(0);
    expect(mock.removedListeners.size).toBe(0);
  });

  it('rejects when the tab lookup reports the tab is gone', async () => {
    const mock = installChromeTabsMock('loading');
    mock.rejectGetWith(new Error('No tab with id: 1.'));

    await expect(waitForTabComplete(1, 25_000)).rejects.toThrow('tab_closed');
    expect(mock.listeners.size).toBe(0);
    expect(mock.removedListeners.size).toBe(0);
  });

  it('rejects when the tab never reaches complete', async () => {
    vi.useFakeTimers();
    installChromeTabsMock('loading');
    const pending = waitForTabComplete(1, 25_000);
    await Promise.resolve();

    vi.advanceTimersByTime(25_000);

    await expect(pending).rejects.toThrow('navigate_timeout');
  });
});

describe('extensionToolErrorPayload', () => {
  it('keeps common extension failures actionable and classified', () => {
    expect(extensionToolErrorPayload(new Error('bad_url'))).toEqual({
      message: '导航地址无效，请检查后重试',
      code: 'bad_args',
    });
    expect(extensionToolErrorPayload(new Error('no_active_tab'))).toEqual({
      message: '浏览器当前没有活动标签页',
      code: 'no_active_tab',
    });
    expect(extensionToolErrorPayload(new Error('navigate_timeout'))).toEqual({
      message: '页面响应超时，请保持标签页打开后重试',
      code: 'timeout',
    });
    expect(
      extensionToolErrorPayload(
        new Error('Cannot access contents of url "https://example.com/". Extension manifest must request permission.'),
      ),
    ).toEqual({
      message: '扩展没有这个网站的访问权限，请检查浏览器扩展权限后重试',
      code: 'host_permission',
    });
    expect(
      extensionToolErrorPayload(new Error('Cannot access a chrome-extension:// URL')),
    ).toEqual({
      message: '扩展没有这个网站的访问权限，请检查浏览器扩展权限后重试',
      code: 'host_permission',
    });
    expect(extensionToolErrorPayload(new Error('Requires activeTab permission'))).toEqual({
      message: '扩展没有这个网站的访问权限，请检查浏览器扩展权限后重试',
      code: 'host_permission',
    });
    expect(extensionToolErrorPayload(new Error('Cannot access a file:// URL'))).toEqual({
      message: '扩展没有这个网站的访问权限，请检查浏览器扩展权限后重试',
      code: 'host_permission',
    });
    expect(
      extensionToolErrorPayload(new Error('The extensions gallery cannot be scripted.')),
    ).toEqual({
      message: '扩展没有这个网站的访问权限，请检查浏览器扩展权限后重试',
      code: 'host_permission',
    });
    expect(extensionToolErrorPayload(new Error('No tab with id: 123.'))).toEqual({
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    });
    expect(extensionToolErrorPayload(new Error('Frame with ID 0 was removed.'))).toEqual({
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    });
    expect(extensionToolErrorPayload(new Error('Execution context was destroyed'))).toEqual({
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    });
    expect(extensionToolErrorPayload(new Error('Frame was detached'))).toEqual({
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    });
    expect(extensionToolErrorPayload(new Error('Debugger is not attached to the tab'))).toEqual({
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    });
    expect(extensionToolErrorPayload(new Error('Target detached'))).toEqual({
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    });
    expect(extensionToolErrorPayload(new Error('screenshot_too_large'))).toEqual({
      message: '截图过大，浏览器已停止发送该帧，请缩小窗口或重试',
      code: 'screenshot_too_large',
    });
    expect(extensionToolErrorPayload(new Error('screenshot_empty'))).toEqual({
      message: '浏览器没有返回有效截图，请确认页面可见后重试',
      code: 'screenshot_unavailable',
    });
  });

  it('hides unknown raw error details', () => {
    const payload = extensionToolErrorPayload(new Error('x'.repeat(300)));

    expect(payload).toEqual({
      message: '浏览器操作失败，请稍后重试',
      code: 'exec_error',
    });
  });
});

describe('normalizeScreenshotCaptureDataUrl', () => {
  it('strips data-url prefixes before returning base64 payloads', () => {
    expect(normalizeScreenshotCaptureDataUrl('data:image/jpeg;base64,AA==')).toEqual({
      imageBase64: 'AA==',
      width: 0,
      height: 0,
    });
  });

  it('rejects oversized screenshot payloads before sending tool_result frames', () => {
    expect(() => normalizeScreenshotCaptureDataUrl('x'.repeat(2_000_001))).toThrow(
      'screenshot_too_large',
    );
  });

  it('rejects empty or non-image screenshot payloads', () => {
    expect(() => normalizeScreenshotCaptureDataUrl('data:image/jpeg;base64,')).toThrow(
      'screenshot_empty',
    );
    expect(() => normalizeScreenshotCaptureDataUrl('data:text/plain;base64,AA==')).toThrow(
      'screenshot_invalid',
    );
  });
});

describe('normalizeNavigateUrl', () => {
  it('accepts http and https urls after trimming', () => {
    expect(normalizeNavigateUrl(' https://example.com/path ')).toBe('https://example.com/path');
    expect(normalizeNavigateUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects empty, malformed, internal, and oversized urls', () => {
    expect(() => normalizeNavigateUrl('')).toThrow('bad_url');
    expect(() => normalizeNavigateUrl('not a url')).toThrow('bad_url');
    expect(() => normalizeNavigateUrl('chrome://extensions')).toThrow('bad_url');
    expect(() => normalizeNavigateUrl(`https://example.com/${'a'.repeat(2050)}`)).toThrow(
      'bad_url',
    );
  });
});

describe('getActiveTabForExtensionTool', () => {
  it('continues to fallback tab queries after a transient rejection', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('current window unavailable'))
      .mockResolvedValueOnce([{ id: 12, url: 'https://holaday.ai/app' }]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabForExtensionTool()).resolves.toMatchObject({
      id: 12,
      url: 'https://holaday.ai/app',
    });
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
  });

  it('continues to fallback tab queries after a stuck query times out', async () => {
    vi.useFakeTimers();
    const query = vi
      .fn()
      .mockReturnValueOnce(new Promise<chrome.tabs.Tab[]>(() => undefined))
      .mockResolvedValueOnce([{ id: 12, url: 'https://holaday.ai/app' }]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    const pending = getActiveTabForExtensionTool();
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toMatchObject({
      id: 12,
      url: 'https://holaday.ai/app',
    });
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
  });

  it('prefers a normal web page over an internal Chrome page when both are visible', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1, url: 'chrome://extensions/' }])
      .mockResolvedValueOnce([{ id: 2, url: 'https://holaday.ai/app' }])
      .mockResolvedValueOnce([]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabForExtensionTool()).resolves.toMatchObject({
      id: 2,
      url: 'https://holaday.ai/app',
    });
  });

  it('does not return an internal Chrome page as an actionable tab', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1, url: 'chrome://extensions/' }])
      .mockResolvedValueOnce([{ id: 2, url: 'chrome-extension://abc/popup.html' }])
      .mockResolvedValueOnce([]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabForExtensionTool()).resolves.toBeNull();
  });
});

describe('handleExtensionToolCall', () => {
  it('ignores duplicate in-flight request ids instead of executing twice', async () => {
    vi.mocked(send).mockClear();
    let resolveUpdate: () => void = () => {
      throw new Error('update promise was not created');
    };
    const update = vi.fn(
      () =>
        new Promise<chrome.tabs.Tab>((resolve) => {
          resolveUpdate = () => resolve({ id: 2, url: 'https://example.com/' } as chrome.tabs.Tab);
        }),
    );
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'https://holaday.ai/app' }]),
        update,
        get: vi.fn(async () => ({ id: 2, status: 'complete', url: 'https://example.com/' })),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        onRemoved: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(async () => [{ result: 'hello' }]),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_duplicate_tool_call',
      requestId: 'req_duplicate_tool_call',
      kind: 'navigate',
      args: { url: 'https://example.com/', waitMs: 0 },
      timeoutMs: 30_000,
    };

    const first = handleExtensionToolCall(call);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await handleExtensionToolCall(call);

    expect(update).toHaveBeenCalledTimes(1);
    resolveUpdate();
    await first;

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('replays completed duplicate request ids without executing twice', async () => {
    vi.mocked(send).mockClear();
    const update = vi.fn(async () => ({ id: 2, url: 'https://example.com/' }) as chrome.tabs.Tab);
    const executeScript = vi.fn(async () => [{ result: 'hello' }]);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'https://holaday.ai/app' }]),
        update,
        get: vi.fn(async () => ({ id: 2, status: 'complete', url: 'https://example.com/' })),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        onRemoved: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript,
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_replay_tool_call',
      requestId: 'req_replay_tool_call',
      kind: 'navigate',
      args: { url: 'https://example.com/', waitMs: 0 },
      timeoutMs: 30_000,
    };

    await handleExtensionToolCall(call);
    await handleExtensionToolCall(call);

    expect(update).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(send).mock.calls[1]?.[0]).toMatchObject({
      type: 'client.extension.tool_result',
      taskId: 'tsk_replay_tool_call',
      requestId: 'req_replay_tool_call',
      ok: true,
      result: {
        finalUrl: 'https://example.com/',
        title: '',
        bodyText: 'hello',
      },
    });
  });

  it('does not treat the same request id on another task as a duplicate', async () => {
    vi.mocked(send).mockClear();
    const captureVisibleTab = vi
      .fn()
      .mockResolvedValueOnce('data:image/jpeg;base64,AA==')
      .mockResolvedValueOnce('data:image/jpeg;base64,BB==');
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, windowId: 1, url: 'https://holaday.ai/app' }]),
        captureVisibleTab,
      },
    } as unknown as typeof chrome;

    const baseCall: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_a',
      requestId: 'req_shared',
      kind: 'screenshot',
      args: {},
      timeoutMs: 30_000,
    };

    await handleExtensionToolCall(baseCall);
    await handleExtensionToolCall({ ...baseCall, taskId: 'tsk_b' });

    expect(captureVisibleTab).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(send).mock.calls[0]?.[0]).toMatchObject({
      taskId: 'tsk_a',
      requestId: 'req_shared',
      ok: true,
      result: { imageBase64: 'AA==' },
    });
    expect(vi.mocked(send).mock.calls[1]?.[0]).toMatchObject({
      taskId: 'tsk_b',
      requestId: 'req_shared',
      ok: true,
      result: { imageBase64: 'BB==' },
    });
  });

  it('returns the navigated page metadata when body text extraction hangs', async () => {
    vi.useFakeTimers();
    vi.mocked(send).mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const update = vi.fn(async () => ({ id: 2, url: 'https://example.com/' }) as chrome.tabs.Tab);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'https://holaday.ai/app' }]),
        update,
        get: vi.fn(async () => ({
          id: 2,
          status: 'complete',
          url: 'https://example.com/',
          title: 'Example',
        })),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        onRemoved: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(() => new Promise(() => undefined)),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_body_text_timeout',
      requestId: 'req_body_text_timeout',
      kind: 'navigate',
      args: { url: 'https://example.com/', waitMs: 0 },
      timeoutMs: 30_000,
    };

    const pending = handleExtensionToolCall(call);
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;

    expect(warn).toHaveBeenCalledWith('[holaday] extension navigate body text read timed out');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'client.extension.tool_result',
        taskId: 'tsk_body_text_timeout',
        requestId: 'req_body_text_timeout',
        ok: true,
        result: {
          finalUrl: 'https://example.com/',
          title: 'Example',
          bodyText: '',
        },
      }),
    );
  });

  it('caps navigate settle wait to the tool call budget', async () => {
    vi.useFakeTimers();
    vi.mocked(send).mockClear();
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'https://holaday.ai/app' }]),
        update: vi.fn(async () => ({ id: 2, url: 'https://example.com/' }) as chrome.tabs.Tab),
        get: vi.fn(async () => ({
          id: 2,
          status: 'complete',
          url: 'https://example.com/',
          title: 'Example',
        })),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        onRemoved: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(async () => [{ result: 'hello' }]),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_wait_budget',
      requestId: 'req_wait_budget',
      kind: 'navigate',
      args: { url: 'https://example.com/', waitMs: 10_000 },
      timeoutMs: 2_000,
    };

    const pending = handleExtensionToolCall(call);
    await vi.advanceTimersByTimeAsync(250);
    await pending;

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'client.extension.tool_result',
        taskId: 'tsk_wait_budget',
        requestId: 'req_wait_budget',
        ok: true,
        result: expect.objectContaining({ bodyText: 'hello' }),
      }),
    );
  });

  it('clips body text inside the page before sending the tool result', async () => {
    vi.mocked(send).mockClear();
    let bodyTextCap = 0;
    const update = vi.fn(async () => ({ id: 2, url: 'https://example.com/' }) as chrome.tabs.Tab);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, url: 'https://holaday.ai/app' }]),
        update,
        get: vi.fn(async () => ({
          id: 2,
          status: 'complete',
          url: 'https://example.com/',
          title: 'Example',
        })),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        onRemoved: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(async ({ args }) => {
          bodyTextCap = args?.[0] as number;
          return [{ result: `${'x'.repeat(bodyTextCap)}\n…(已截断，原文 9000 字)` }];
        }),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_body_text_cap',
      requestId: 'req_body_text_cap',
      kind: 'navigate',
      args: { url: 'https://example.com/', waitMs: 0 },
      timeoutMs: 30_000,
    };

    await handleExtensionToolCall(call);

    expect(bodyTextCap).toBe(8000);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'client.extension.tool_result',
        ok: true,
        result: expect.objectContaining({
          bodyText: `${'x'.repeat(8000)}\n…(已截断，原文 9000 字)`,
        }),
      }),
    );
  });

  it('returns a timeout when screenshot capture hangs', async () => {
    vi.useFakeTimers();
    vi.mocked(send).mockClear();
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, windowId: 1, url: 'https://holaday.ai/app' }]),
        captureVisibleTab: vi.fn(() => new Promise<string>(() => undefined)),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_screenshot_timeout',
      requestId: 'req_screenshot_timeout',
      kind: 'screenshot',
      args: {},
      timeoutMs: 30_000,
    };

    const pending = handleExtensionToolCall(call);
    await vi.advanceTimersByTimeAsync(8_000);
    await pending;

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'client.extension.tool_result',
        taskId: 'tsk_screenshot_timeout',
        requestId: 'req_screenshot_timeout',
        ok: false,
        error: {
          message: '页面响应超时，请保持标签页打开后重试',
          code: 'timeout',
        },
      }),
    );
  });

  it('retries screenshots with lower quality when the first capture is too large', async () => {
    vi.mocked(send).mockClear();
    const captureVisibleTab = vi
      .fn()
      .mockResolvedValueOnce(`data:image/jpeg;base64,${'x'.repeat(2_000_001)}`)
      .mockResolvedValueOnce('data:image/jpeg;base64,AA==');
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, windowId: 1, url: 'https://holaday.ai/app' }]),
        captureVisibleTab,
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_screenshot_retry',
      requestId: 'req_screenshot_retry',
      kind: 'screenshot',
      args: {},
      timeoutMs: 30_000,
    };

    await handleExtensionToolCall(call);

    expect(captureVisibleTab).toHaveBeenNthCalledWith(1, 1, {
      format: 'jpeg',
      quality: 50,
    });
    expect(captureVisibleTab).toHaveBeenNthCalledWith(2, 1, {
      format: 'jpeg',
      quality: 35,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'client.extension.tool_result',
        taskId: 'tsk_screenshot_retry',
        requestId: 'req_screenshot_retry',
        ok: true,
        result: { imageBase64: 'AA==', width: 0, height: 0 },
      }),
    );
  });

  it('retries sending a tool result when the websocket is briefly disconnected', async () => {
    vi.useFakeTimers();
    vi.mocked(send).mockReset();
    vi.mocked(send).mockReturnValueOnce(false).mockReturnValueOnce(true);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, windowId: 1, url: 'https://holaday.ai/app' }]),
        captureVisibleTab: vi.fn(async () => 'data:image/jpeg;base64,AA=='),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_result_retry',
      requestId: 'req_result_retry',
      kind: 'screenshot',
      args: {},
      timeoutMs: 30_000,
    };

    await handleExtensionToolCall(call);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(send).mock.calls[1]?.[0]).toMatchObject({
      type: 'client.extension.tool_result',
      taskId: 'tsk_result_retry',
      requestId: 'req_result_retry',
      ok: true,
      result: { imageBase64: 'AA==', width: 0, height: 0 },
    });
  });

  it('does not retry a completed tool result after the websocket token switches', async () => {
    vi.useFakeTimers();
    vi.mocked(send).mockReset();
    vi.mocked(send).mockReturnValue(false);
    vi.mocked(getCurrentWsToken).mockReturnValue('token-a');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, windowId: 1, url: 'https://holaday.ai/app' }]),
        captureVisibleTab: vi.fn(async () => 'data:image/jpeg;base64,AA=='),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_result_token_switch',
      requestId: 'req_result_token_switch',
      kind: 'screenshot',
      args: {},
      timeoutMs: 30_000,
    };

    await handleExtensionToolCall(call);
    expect(send).toHaveBeenCalledTimes(1);

    vi.mocked(getCurrentWsToken).mockReturnValue('token-b');
    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[holaday] extension tool result retry cancelled after token change',
      expect.objectContaining({
        taskId: 'tsk_result_token_switch',
        requestId: 'req_result_token_switch',
        attempt: 1,
      }),
    );
  });

  it('keeps retrying tool results through a longer websocket reconnect', async () => {
    vi.useFakeTimers();
    vi.mocked(send).mockReset();
    vi.mocked(send)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 2, windowId: 1, url: 'https://holaday.ai/app' }]),
        captureVisibleTab: vi.fn(async () => 'data:image/jpeg;base64,AA=='),
      },
    } as unknown as typeof chrome;

    const call: Extract<ServerMessage, { type: 'server.extension.tool_call' }> = {
      type: 'server.extension.tool_call',
      taskId: 'tsk_result_long_retry',
      requestId: 'req_result_long_retry',
      kind: 'screenshot',
      args: {},
      timeoutMs: 30_000,
    };

    await handleExtensionToolCall(call);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250 + 1_000 + 3_000 + 7_000);

    expect(send).toHaveBeenCalledTimes(5);
    expect(vi.mocked(send).mock.calls[4]?.[0]).toMatchObject({
      type: 'client.extension.tool_result',
      taskId: 'tsk_result_long_retry',
      requestId: 'req_result_long_retry',
      ok: true,
      result: { imageBase64: 'AA==', width: 0, height: 0 },
    });
  });
});

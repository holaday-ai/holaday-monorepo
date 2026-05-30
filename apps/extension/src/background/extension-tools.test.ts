import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extensionToolErrorPayload,
  normalizeScreenshotCaptureDataUrl,
  normalizeNavigateUrl,
  waitForTabComplete,
} from './extension-tools.js';

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
    expect(extensionToolErrorPayload(new Error('No tab with id: 123.'))).toEqual({
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
      code: 'tab_closed',
    });
    expect(extensionToolErrorPayload(new Error('screenshot_too_large'))).toEqual({
      message: '截图过大，浏览器已停止发送该帧，请缩小窗口或重试',
      code: 'screenshot_too_large',
    });
  });

  it('bounds unknown error details', () => {
    const payload = extensionToolErrorPayload(new Error('x'.repeat(300)));

    expect(payload.code).toBe('exec_error');
    expect(payload.message).toHaveLength('执行失败：'.length + 200);
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetAttachedTabsForTests,
  cdpActionErrorMessage,
  captureVisionObservation,
  detachAll,
  detachFromTab,
  executeCdpAction,
  getActiveTabId,
  normalizeCdpNavigateUrl,
  sanitizeVisionObservationCapture,
} from './cdp-actions.js';

afterEach(() => {
  vi.useRealTimers();
  _resetAttachedTabsForTests();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('normalizeCdpNavigateUrl', () => {
  it('accepts http and https urls after trimming', () => {
    expect(normalizeCdpNavigateUrl(' https://example.com/path ')).toBe(
      'https://example.com/path',
    );
    expect(normalizeCdpNavigateUrl('http://example.com/')).toBe('http://example.com/');
    expect(normalizeCdpNavigateUrl('example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    );
    expect(normalizeCdpNavigateUrl('localhost:3000/app')).toBe(
      'https://localhost:3000/app',
    );
    expect(normalizeCdpNavigateUrl('127.0.0.1:4173/app')).toBe(
      'https://127.0.0.1:4173/app',
    );
  });

  it('rejects empty, malformed, internal, and oversized urls', () => {
    expect(() => normalizeCdpNavigateUrl('')).toThrow('bad_url');
    expect(() => normalizeCdpNavigateUrl('not a url')).toThrow('bad_url');
    expect(() => normalizeCdpNavigateUrl('chrome://extensions')).toThrow('bad_url');
    expect(() => normalizeCdpNavigateUrl(`https://example.com/${'a'.repeat(2050)}`)).toThrow(
      'bad_url',
    );
  });
});

describe('executeCdpAction', () => {
  it('returns friendly invalid-url copy before attaching the debugger', async () => {
    await expect(
      executeCdpAction(1, { kind: 'navigate', url: 'chrome://extensions' }),
    ).resolves.toEqual({
      ok: false,
      message: '导航地址无效，请检查后重试',
    });
  });

  it('coalesces concurrent debugger attaches for the same tab', async () => {
    let resolveAttach: () => void = () => {
      throw new Error('attach promise was not created');
    };
    const attach = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAttach = resolve;
        }),
    );
    const sendCommand = vi.fn(async () => ({}));
    globalThis.chrome = {
      debugger: {
        attach,
        sendCommand,
      },
    } as unknown as typeof chrome;

    const click = executeCdpAction(7, { kind: 'click', x: 10, y: 20 });
    const type = executeCdpAction(7, { kind: 'type', text: 'hello' });
    await Promise.resolve();

    expect(attach).toHaveBeenCalledTimes(1);
    resolveAttach?.();

    await expect(Promise.all([click, type])).resolves.toEqual([
      { ok: true, message: 'clicked left @ (10,20)' },
      { ok: true, message: 'typed 5 chars' },
    ]);
    expect(sendCommand).toHaveBeenCalled();
  });

  it('returns a timeout when debugger attach hangs', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(() => new Promise<void>(() => undefined)),
        sendCommand: vi.fn(async () => ({})),
      },
    } as unknown as typeof chrome;

    const pending = executeCdpAction(7, { kind: 'click', x: 10, y: 20 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({
      ok: false,
      message: '浏览器操作超时，请保持标签页打开后重试',
    });
  });

  it('rejects invalid click coordinates before attaching the debugger', async () => {
    await expect(executeCdpAction(7, { kind: 'click', x: Number.NaN, y: 20 })).resolves.toEqual({
      ok: false,
      message: '点击坐标无效，请重新定位后再试',
    });
  });

  it('reports off-screen click coordinates without dispatching the click', async () => {
    const sendCommand = vi.fn(async (_target, method: string) => {
      if (method === 'Runtime.evaluate') {
        return { result: { value: JSON.stringify({ w: 360, h: 640 }) } };
      }
      return {};
    });
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(executeCdpAction(7, { kind: 'click', x: 420, y: 20 })).resolves.toEqual({
      ok: false,
      message: '点击坐标超出可视区域 (420,20) / 360x640，请重新定位',
    });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      'Runtime.evaluate',
      expect.any(Object),
    );
  });

  it('reattaches before clicking when viewport probing resets the debugger session', async () => {
    const attach = vi.fn(async () => undefined);
    const detach = vi.fn(async () => undefined);
    const sendCommand = vi.fn(async (_target, method: string) => {
      if (method === 'Runtime.evaluate') {
        throw new Error('CDP Runtime.evaluate timeout 500ms');
      }
      return {};
    });
    globalThis.chrome = {
      debugger: {
        attach,
        detach,
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(executeCdpAction(7, { kind: 'click', x: 10, y: 20 })).resolves.toEqual({
      ok: true,
      message: 'clicked left @ (10,20)',
    });
    expect(detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(attach).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      { tabId: 7 },
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed' }),
    );
  });

  it('waits for an in-flight debugger attach before detaching during teardown', async () => {
    let resolveAttach: () => void = () => {
      throw new Error('attach promise was not created');
    };
    const attach = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAttach = resolve;
        }),
    );
    const detach = vi.fn(async () => undefined);
    globalThis.chrome = {
      debugger: {
        attach,
        detach,
        sendCommand: vi.fn(async () => ({})),
      },
    } as unknown as typeof chrome;

    const action = executeCdpAction(8, { kind: 'type', text: 'cleanup' });
    await Promise.resolve();
    const detached = detachFromTab(8);
    await Promise.resolve();

    expect(detach).not.toHaveBeenCalled();
    resolveAttach();

    await expect(action).resolves.toMatchObject({ ok: true });
    await detached;
    expect(detach).toHaveBeenCalledWith({ tabId: 8 });
  });

  it('includes in-flight debugger attaches when detaching all tabs', async () => {
    let resolveAttach: () => void = () => {
      throw new Error('attach promise was not created');
    };
    const attach = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAttach = resolve;
        }),
    );
    const detach = vi.fn(async () => undefined);
    globalThis.chrome = {
      debugger: {
        attach,
        detach,
        sendCommand: vi.fn(async () => ({})),
      },
    } as unknown as typeof chrome;

    const action = executeCdpAction(9, { kind: 'type', text: 'all' });
    await Promise.resolve();
    const detached = detachAll();
    await Promise.resolve();

    expect(detach).not.toHaveBeenCalled();
    resolveAttach();

    await expect(action).resolves.toMatchObject({ ok: true });
    await detached;
    expect(detach).toHaveBeenCalledWith({ tabId: 9 });
  });

  it('omits printable text for modifier key chords', async () => {
    const sendCommand = vi.fn(async () => ({}));
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(executeCdpAction(10, { kind: 'key', key: 'cmd+c' })).resolves.toEqual({
      ok: true,
      message: 'key cmd+c',
    });

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      { tabId: 10 },
      'Input.dispatchKeyEvent',
      expect.objectContaining({
        type: 'keyDown',
        modifiers: 4,
        key: 'c',
        code: 'KeyC',
        windowsVirtualKeyCode: 67,
      }),
    );
    const keyDownParams = (sendCommand.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(keyDownParams).not.toHaveProperty('text');
  });

  it('normalizes special key names case-insensitively', async () => {
    const sendCommand = vi.fn(async () => ({}));
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(executeCdpAction(11, { kind: 'key', key: 'enter' })).resolves.toEqual({
      ok: true,
      message: 'key enter',
    });
    await expect(executeCdpAction(11, { kind: 'key', key: 'ARROWDOWN' })).resolves.toEqual({
      ok: true,
      message: 'key ARROWDOWN',
    });

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      { tabId: 11 },
      'Input.dispatchKeyEvent',
      expect.objectContaining({
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      }),
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      3,
      { tabId: 11 },
      'Input.dispatchKeyEvent',
      expect.objectContaining({
        type: 'keyDown',
        key: 'ArrowDown',
        code: 'ArrowDown',
        windowsVirtualKeyCode: 40,
      }),
    );
  });

  it('chunks long inserted text to keep CDP payloads small', async () => {
    const sendCommand = vi.fn(async () => ({}));
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
      },
    } as unknown as typeof chrome;

    const text = `${'a'.repeat(1000)}${'b'.repeat(1000)}c`;
    await expect(executeCdpAction(12, { kind: 'type', text })).resolves.toEqual({
      ok: true,
      message: 'typed 2001 chars',
    });

    expect(sendCommand).toHaveBeenCalledTimes(3);
    expect(sendCommand).toHaveBeenNthCalledWith(1, { tabId: 12 }, 'Input.insertText', {
      text: 'a'.repeat(1000),
    });
    expect(sendCommand).toHaveBeenNthCalledWith(2, { tabId: 12 }, 'Input.insertText', {
      text: 'b'.repeat(1000),
    });
    expect(sendCommand).toHaveBeenNthCalledWith(3, { tabId: 12 }, 'Input.insertText', {
      text: 'c',
    });
  });

  it('scrolls at the live viewport center', async () => {
    const sendCommand = vi.fn(async (_target, method: string) => {
      if (method === 'Runtime.evaluate') {
        return { result: { value: JSON.stringify({ w: 360, h: 640 }) } };
      }
      return {};
    });
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(executeCdpAction(12, { kind: 'scroll', dy: 500 })).resolves.toEqual({
      ok: true,
      message: 'scrolled 500px',
    });

    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      { tabId: 12 },
      'Input.dispatchMouseEvent',
      expect.objectContaining({
        type: 'mouseWheel',
        x: 180,
        y: 320,
        deltaY: 500,
      }),
    );
  });

  it('forgets timed-out CDP sessions so the next action can reattach', async () => {
    vi.useFakeTimers();
    const attach = vi.fn(async () => undefined);
    const detach = vi.fn(async () => undefined);
    const sendCommand = vi
      .fn()
      .mockImplementation((_target, method: string) => {
        if (method === 'Runtime.evaluate') {
          return Promise.resolve({ result: { value: JSON.stringify({ w: 360, h: 640 }) } });
        }
        if (method === 'Input.dispatchMouseEvent') {
          return new Promise(() => undefined);
        }
        return Promise.resolve({});
      });
    globalThis.chrome = {
      debugger: {
        attach,
        detach,
        sendCommand,
      },
    } as unknown as typeof chrome;

    const failed = executeCdpAction(13, { kind: 'click', x: 10, y: 20 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(failed).resolves.toEqual({
      ok: false,
      message: '浏览器操作超时，请保持标签页打开后重试',
    });
    expect(detach).toHaveBeenCalledWith({ tabId: 13 });

    await expect(executeCdpAction(13, { kind: 'type', text: 'retry' })).resolves.toEqual({
      ok: true,
      message: 'typed 5 chars',
    });
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('forgets detached-frame CDP sessions so the next action can reattach', async () => {
    const attach = vi.fn(async () => undefined);
    const detach = vi.fn(async () => undefined);
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error('Execution context was destroyed'))
      .mockResolvedValue({});
    globalThis.chrome = {
      debugger: {
        attach,
        detach,
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(executeCdpAction(13, { kind: 'type', text: 'retry' })).resolves.toEqual({
      ok: false,
      message: '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
    });
    expect(detach).toHaveBeenCalledWith({ tabId: 13 });

    await expect(executeCdpAction(13, { kind: 'type', text: 'retry' })).resolves.toEqual({
      ok: true,
      message: 'typed 5 chars',
    });
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('clamps wait actions to a safe non-negative window', async () => {
    vi.useFakeTimers();

    const negative = executeCdpAction(14, { kind: 'wait', ms: -50 });
    await vi.advanceTimersByTimeAsync(0);
    await expect(negative).resolves.toEqual({ ok: true, message: 'waited 0ms' });

    const oversized = executeCdpAction(14, { kind: 'wait', ms: 30_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(oversized).resolves.toEqual({ ok: true, message: 'waited 10000ms' });
  });

  it('reports CDP navigation failures instead of treating them as success', async () => {
    const sendCommand = vi.fn(async (_target, method: string) => {
      if (method === 'Page.navigate') {
        return { errorText: 'net::ERR_NAME_NOT_RESOLVED' };
      }
      return {};
    });
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(
      executeCdpAction(15, { kind: 'navigate', url: 'https://bad.invalid/' }),
    ).resolves.toEqual({
      ok: false,
      message: '页面导航失败：域名无法解析，请检查网址后重试',
    });
  });

  it('clips action result messages to the vision acted schema limit', async () => {
    await expect(
      executeCdpAction(15, { kind: 'wait_for_human', reason: 'x'.repeat(2_000) }),
    ).resolves.toEqual({
      ok: true,
      message: `wait_for_human: ${'x'.repeat(984)}`,
    });
  });
});

describe('cdpActionErrorMessage', () => {
  it('keeps common browser control failures actionable', () => {
    expect(cdpActionErrorMessage(new Error('No tab with id: 1.'))).toBe(
      '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
    );
    expect(cdpActionErrorMessage(new Error('Another debugger is already attached'))).toBe(
      '浏览器调试通道被占用，请关闭该标签页 DevTools 后重试',
    );
    expect(cdpActionErrorMessage(new Error('Cannot access contents of url'))).toBe(
      '扩展没有这个页面的访问权限，请检查扩展权限后重试',
    );
    expect(cdpActionErrorMessage(new Error('Cannot access a chrome-extension:// URL'))).toBe(
      '扩展没有这个页面的访问权限，请检查扩展权限后重试',
    );
    expect(cdpActionErrorMessage(new Error('Requires activeTab permission'))).toBe(
      '扩展没有这个页面的访问权限，请检查扩展权限后重试',
    );
    expect(cdpActionErrorMessage(new Error('Cannot access a file:// URL'))).toBe(
      '扩展没有这个页面的访问权限，请检查扩展权限后重试',
    );
    expect(cdpActionErrorMessage(new Error('Frame was detached'))).toBe(
      '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
    );
    expect(cdpActionErrorMessage(new Error('Debugger is not attached to the tab'))).toBe(
      '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
    );
    expect(cdpActionErrorMessage(new Error('Target detached'))).toBe(
      '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
    );
    expect(cdpActionErrorMessage(new Error('Execution context was destroyed'))).toBe(
      '浏览器标签页已关闭或连接中断，请重新打开页面后重试',
    );
    expect(cdpActionErrorMessage(new Error('The extensions gallery cannot be scripted.'))).toBe(
      '扩展没有这个页面的访问权限，请检查扩展权限后重试',
    );
    expect(cdpActionErrorMessage(new Error('CDP Input.dispatchMouseEvent timeout 5000ms'))).toBe(
      '浏览器操作超时，请保持标签页打开后重试',
    );
  });

  it('hides unknown raw browser control failures', () => {
    const message = cdpActionErrorMessage(new Error('x'.repeat(300)));

    expect(message).toBe('浏览器操作失败，请稍后重试');
  });
});

describe('sanitizeVisionObservationCapture', () => {
  it('keeps bounded observation metadata unchanged', () => {
    expect(
      sanitizeVisionObservationCapture({
        screenshotBase64: 'AA==',
        viewportWidth: 1280,
        viewportHeight: 720,
        url: 'https://example.com/',
        title: 'Example',
      }),
    ).toEqual({
      screenshotBase64: 'AA==',
      viewportWidth: 1280,
      viewportHeight: 720,
      url: 'https://example.com/',
      title: 'Example',
    });
  });

  it('clips metadata to the shared observation schema limits', () => {
    const result = sanitizeVisionObservationCapture({
      screenshotBase64: 'AA==',
      viewportWidth: 50_000,
      viewportHeight: Number.NaN,
      url: `https://example.com/${'a'.repeat(3000)}`,
      title: 't'.repeat(800),
      error: 'e'.repeat(1200),
    });

    expect(result.viewportWidth).toBe(20_000);
    expect(result.viewportHeight).toBe(0);
    expect(result.url).toHaveLength(2048);
    expect(result.title).toHaveLength(512);
    expect(result.error).toHaveLength(1000);
  });

  it('drops oversized screenshots instead of sending invalid partial base64', () => {
    const result = sanitizeVisionObservationCapture({
      screenshotBase64: 'x'.repeat(2_000_001),
      viewportWidth: 1280,
      viewportHeight: 720,
      url: 'https://example.com/',
      title: 'Example',
    });

    expect(result.screenshotBase64).toBe('');
    expect(result.error).toContain('oversized image');
  });
});

describe('captureVisionObservation', () => {
  it('humanizes debugger attach failures', async () => {
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => {
          throw new Error('Another debugger is already attached');
        }),
      },
    } as unknown as typeof chrome;

    await expect(captureVisionObservation(1)).resolves.toMatchObject({
      screenshotBase64: '',
      viewportWidth: 0,
      viewportHeight: 0,
      url: '',
      title: '',
      error: 'debugger attach failed: 浏览器调试通道被占用，请关闭该标签页 DevTools 后重试',
    });
  });

  it('retries observation screenshots with lower quality when the first frame is too large', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          value: JSON.stringify({
            w: 1280,
            h: 720,
            u: 'https://holaday.ai/app',
            t: 'HOLA DAY',
          }),
        },
      })
      .mockResolvedValueOnce({ data: 'x'.repeat(2_000_001) })
      .mockResolvedValueOnce({ data: 'AA==' });
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        sendCommand,
      },
    } as unknown as typeof chrome;

    await expect(captureVisionObservation(1)).resolves.toEqual({
      screenshotBase64: 'AA==',
      viewportWidth: 1280,
      viewportHeight: 720,
      url: 'https://holaday.ai/app',
      title: 'HOLA DAY',
    });
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      { tabId: 1 },
      'Page.captureScreenshot',
      {
        format: 'jpeg',
        quality: 80,
        captureBeyondViewport: false,
      },
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      3,
      { tabId: 1 },
      'Page.captureScreenshot',
      {
        format: 'jpeg',
        quality: 60,
        captureBeyondViewport: false,
      },
    );
  });

  it('falls back to chrome tab metadata when page evaluation is unavailable', async () => {
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error('Cannot find context with specified id'))
      .mockResolvedValueOnce({ data: 'AA==' });
    globalThis.chrome = {
      debugger: {
        attach: vi.fn(async () => undefined),
        detach: vi.fn(async () => undefined),
        sendCommand,
      },
      tabs: {
        get: vi.fn(async () => ({
          id: 1,
          url: 'chrome-error://chromewebdata/',
          title: 'This site cannot be reached',
        })),
      },
    } as unknown as typeof chrome;

    await expect(captureVisionObservation(1)).resolves.toEqual({
      screenshotBase64: 'AA==',
      viewportWidth: 0,
      viewportHeight: 0,
      url: 'chrome-error://chromewebdata/',
      title: 'This site cannot be reached',
    });
    expect(chrome.tabs.get).toHaveBeenCalledWith(1);
  });
});

describe('getActiveTabId', () => {
  it('falls back from currentWindow to lastFocusedWindow and normal windows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 42 }]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBe(42);
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
    expect(query).toHaveBeenNthCalledWith(3, { active: true, windowType: 'normal' });
    expect(query).toHaveBeenNthCalledWith(4, { windowType: 'normal' });
  });

  it('returns null when chrome tab lookup fails', async () => {
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => {
          throw new Error('tabs unavailable');
        }),
      },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBeNull();
  });

  it('continues the fallback chain when a tab query rejects', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('current window unavailable'))
      .mockResolvedValueOnce([{ id: 77 }]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBe(77);
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
  });

  it('prefers a web page over an internal Chrome page', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10, url: 'chrome://extensions/' }])
      .mockResolvedValueOnce([{ id: 11, url: 'https://holaday.ai/app' }])
      .mockResolvedValueOnce([]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBe(11);
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
    expect(query).toHaveBeenNthCalledWith(3, { active: true, windowType: 'normal' });
  });

  it('inspects every returned tab before giving up on the active web page', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 10, url: 'chrome://extensions/', lastAccessed: 5000 },
        { id: 11, url: 'https://holaday.ai/app', lastAccessed: 1000 },
      ]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBe(11);
  });

  it('prefers the most recently accessed active web tab within a fallback query', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 10, url: 'https://older.example/', lastAccessed: 1000 },
        { id: 11, url: 'https://newer.example/', lastAccessed: 5000 },
      ]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBe(11);
  });

  it('recovers the most recently accessed web tab when an extension page is active', async () => {
    const update = vi.fn(async () => ({ id: 13, active: true }) as chrome.tabs.Tab);
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10, url: 'chrome://extensions/', lastAccessed: 7000 }])
      .mockResolvedValueOnce([{ id: 11, url: 'chrome-extension://abc/src/popup/index.html', lastAccessed: 8000 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 12, url: 'https://older.example/', active: false, lastAccessed: 1000 },
        { id: 13, url: 'https://newer.example/', active: false, lastAccessed: 5000 },
      ]);
    globalThis.chrome = {
      tabs: { query, update },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBe(13);
    expect(query).toHaveBeenNthCalledWith(4, { windowType: 'normal' });
    expect(update).toHaveBeenCalledWith(13, { active: true });
  });

  it('does not return an internal Chrome page when no web tab is active', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10, url: 'chrome://extensions/' }])
      .mockResolvedValueOnce([{ id: 11, url: 'chrome-extension://abc/sidepanel.html' }])
      .mockResolvedValueOnce([
        { id: 12, url: 'chrome-error://chromewebdata/' },
        { id: 13, url: 'devtools://devtools/bundled/devtools_app.html' },
        { id: 14, url: 'view-source:https://example.com/' },
      ]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId()).resolves.toBeNull();
  });

  it('can return a Chrome error page when navigation needs to recover the tab', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10, url: 'chrome-error://chromewebdata/' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId({ allowErrorPage: true })).resolves.toBe(10);
  });

  it('prefers the current Chrome error tab over an older web tab for navigation recovery', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10, url: 'chrome-error://chromewebdata/' }])
      .mockResolvedValueOnce([{ id: 11, url: 'https://holaday.ai/app' }])
      .mockResolvedValueOnce([]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    await expect(getActiveTabId({ allowErrorPage: true })).resolves.toBe(10);
  });

  it('continues the fallback chain when a tab query hangs', async () => {
    vi.useFakeTimers();
    const query = vi
      .fn()
      .mockReturnValueOnce(new Promise<chrome.tabs.Tab[]>(() => undefined))
      .mockResolvedValueOnce([{ id: 78 }]);
    globalThis.chrome = {
      tabs: { query },
    } as unknown as typeof chrome;

    const pending = getActiveTabId();
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toBe(78);
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
  });
});

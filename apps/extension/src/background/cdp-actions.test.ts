import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetAttachedTabsForTests,
  cdpActionErrorMessage,
  captureVisionObservation,
  executeCdpAction,
  getActiveTabId,
  normalizeCdpNavigateUrl,
  sanitizeVisionObservationCapture,
} from './cdp-actions.js';

afterEach(() => {
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
    expect(cdpActionErrorMessage(new Error('CDP Input.dispatchMouseEvent timeout 5000ms'))).toBe(
      '浏览器操作超时，请保持标签页打开后重试',
    );
  });

  it('bounds unknown browser control failures', () => {
    const message = cdpActionErrorMessage(new Error('x'.repeat(300)));

    expect(message).toHaveLength('浏览器操作失败：'.length + 200);
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
});

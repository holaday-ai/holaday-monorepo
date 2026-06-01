import { afterEach, describe, expect, it, vi } from 'vitest';
import { _internals, tryAutoLogin } from './auto-login.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

describe('tryAutoLogin', () => {
  it('recognizes every production workbench host used by the extension UI', () => {
    expect(_internals.isWorkbenchUrl('https://hd-app.orangebench.tech/app')).toBe(true);
    expect(_internals.isWorkbenchUrl('https://holaday.ai/app')).toBe(true);
    expect(_internals.isWorkbenchUrl('https://app.holaday.ai/app')).toBe(true);
    expect(_internals.isWorkbenchUrl('https://example.com/holaday.ai')).toBe(false);
  });

  it('recognizes local dev workbench urls without requiring a path slash', () => {
    expect(_internals.isWorkbenchUrl('http://localhost:5173')).toBe(true);
    expect(_internals.isWorkbenchUrl('http://127.0.0.1:4173?dev=1')).toBe(true);
    expect(_internals.isWorkbenchUrl('http://[::1]:5173/#/app')).toBe(true);
    expect(_internals.isWorkbenchUrl('http://127.evil.com/')).toBe(false);
  });

  it('skips malformed localStorage tokens while scanning workbench tabs', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: 'undefined' }])
      .mockResolvedValueOnce([{ result: 'short' }])
      .mockResolvedValueOnce([{ result: '  hd_live_valid_token  ' }]);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 1,
            url: 'https://holaday.ai/app',
            active: true,
            lastAccessed: 2,
          },
          {
            id: 2,
            url: 'https://app.holaday.ai/app',
            active: false,
            lastAccessed: 1,
          },
          {
            id: 3,
            url: 'https://hd-app.orangebench.tech/app',
            active: false,
            lastAccessed: 0,
          },
          {
            id: 4,
            url: 'https://example.com/',
            active: false,
            lastAccessed: 3,
          },
        ]),
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    await expect(tryAutoLogin()).resolves.toBe('hd_live_valid_token');
    expect(executeScript).toHaveBeenCalledTimes(3);
  });

  it('reads candidate tabs in parallel when one localStorage read hangs', async () => {
    vi.useFakeTimers();
    const executeScript = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce([{ result: 'hd_live_valid_token' }]);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 1,
            url: 'https://holaday.ai/app',
            active: true,
            lastAccessed: 2,
          },
          {
            id: 2,
            url: 'https://app.holaday.ai/app',
            active: false,
            lastAccessed: 1,
          },
        ]),
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    const pending = tryAutoLogin();
    await vi.advanceTimersByTimeAsync(0);
    expect(executeScript).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBe('hd_live_valid_token');
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('returns null when the tab query hangs', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      tabs: {
        query: vi.fn(() => new Promise<chrome.tabs.Tab[]>(() => undefined)),
      },
    } as unknown as typeof chrome;

    const pending = tryAutoLogin();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBeNull();
    expect(chrome.tabs.query).toHaveBeenCalledWith({});
  });
});

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
    expect(_internals.isWorkbenchUrl('https://staging.holaday.ai/app')).toBe(false);
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

  it('scans a loading workbench tab using pendingUrl', async () => {
    const executeScript = vi.fn(async () => [{ result: 'hd_live_pending_token' }]);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 5,
            url: undefined,
            pendingUrl: 'https://holaday.ai/app',
            active: true,
            lastAccessed: 4,
          } as chrome.tabs.Tab,
          {
            id: 6,
            url: 'https://example.com/',
            active: false,
            lastAccessed: 5,
          } as chrome.tabs.Tab,
        ]),
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    await expect(tryAutoLogin()).resolves.toBe('hd_live_pending_token');
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 5 } }),
    );
  });

  it('scrubs sensitive query params from auto-login logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const executeScript = vi.fn(async () => [{ result: null }]);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 8,
            url: 'https://holaday.ai/app?accessToken=secret-token&view=tasks#token=hash-secret',
            active: true,
            lastAccessed: 1,
          } as chrome.tabs.Tab,
        ]),
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    await expect(tryAutoLogin()).resolves.toBeNull();

    const logs = info.mock.calls.flat().join('\n');
    expect(logs).not.toContain('secret-token');
    expect(logs).not.toContain('hash-secret');
    expect(logs).toContain('https://holaday.ai/app?view=tasks');
  });

  it('scrubs sensitive values from auto-login warning reasons', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const executeScript = vi.fn(async () => {
      throw new Error('failed accessToken=secret-token sessionId=sid');
    });
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 9,
            url: 'https://holaday.ai/app?accessToken=query-secret&view=tasks',
            active: true,
            lastAccessed: 1,
          } as chrome.tabs.Tab,
        ]),
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    await expect(tryAutoLogin()).resolves.toBeNull();

    const logs = warn.mock.calls.flat().join('\n');
    expect(logs).not.toContain('secret-token');
    expect(logs).not.toContain('query-secret');
    expect(logs).not.toContain('sid');
    expect(logs).toContain('accessToken=redacted');
    expect(logs).toContain('sessionId=redacted');
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

  it('only reads the highest-priority candidate tabs', async () => {
    const executeScript = vi.fn(async () => [{ result: null }]);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () =>
          Array.from({ length: _internals.MAX_AUTO_LOGIN_CANDIDATE_TABS + 3 }, (_value, index) => ({
            id: index + 1,
            url: 'https://holaday.ai/app',
            active: false,
            lastAccessed: index,
          })),
        ),
      },
      scripting: { executeScript },
    } as unknown as typeof chrome;

    await expect(tryAutoLogin()).resolves.toBeNull();

    expect(executeScript).toHaveBeenCalledTimes(_internals.MAX_AUTO_LOGIN_CANDIDATE_TABS);
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: _internals.MAX_AUTO_LOGIN_CANDIDATE_TABS + 3 } }),
    );
    expect(executeScript).not.toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 1 } }),
    );
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

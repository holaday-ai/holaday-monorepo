import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from './auth-bridge-core.js';

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
});

describe('auth bridge content script', () => {
  it('retries an observed token when the service worker ack never arrives', async () => {
    vi.useFakeTimers();
    const token = 'hd_live_' + 'a'.repeat(24);
    const getItem = vi.fn((key: string) => (key === TOKEN_KEY ? token : null));
    const sendMessage = vi.fn((_message: unknown, callback: () => void) => {
      if (sendMessage.mock.calls.length > 1) callback();
    });

    globalThis.window = {
      localStorage: { getItem },
      addEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;
    globalThis.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    await import('./auth-bridge.js');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(
      { type: 'holaday.auth.token', token },
      expect.any(Function),
    );
  });

  it('does not clear the service worker token when localStorage is temporarily unreadable', async () => {
    vi.useFakeTimers();
    const getItem = vi.fn(() => {
      throw new Error('localStorage unavailable');
    });
    const sendMessage = vi.fn();

    globalThis.window = {
      localStorage: { getItem },
      addEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;
    globalThis.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    await import('./auth-bridge.js');
    await vi.advanceTimersByTimeAsync(3_000);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not mirror malformed non-empty localStorage values as logout on first load', async () => {
    vi.useFakeTimers();
    const getItem = vi.fn((key: string) => (key === TOKEN_KEY ? 'Undefined' : null));
    const sendMessage = vi.fn();

    globalThis.window = {
      localStorage: { getItem },
      addEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;
    globalThis.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    await import('./auth-bridge.js');
    await vi.advanceTimersByTimeAsync(3_000);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('retries an observed token when the service worker send fails', async () => {
    vi.useFakeTimers();
    const token = 'hd_live_' + 'a'.repeat(24);
    const getItem = vi.fn((key: string) => (key === TOKEN_KEY ? token : null));
    const sendMessage = vi.fn((_message: unknown, callback: () => void) => {
      if (sendMessage.mock.calls.length === 1) {
        chrome.runtime.lastError = { message: 'service worker restarting' };
        callback();
        delete chrome.runtime.lastError;
        return;
      }
      callback();
    });

    globalThis.window = {
      localStorage: { getItem },
      addEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;
    globalThis.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    await import('./auth-bridge.js');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(
      { type: 'holaday.auth.token', token },
      expect.any(Function),
    );
  });

  it('retries a failed service worker send before the next poll tick', async () => {
    vi.useFakeTimers();
    const token = 'hd_live_' + 'a'.repeat(24);
    const getItem = vi.fn((key: string) => (key === TOKEN_KEY ? token : null));
    const sendMessage = vi.fn((_message: unknown, callback: () => void) => {
      if (sendMessage.mock.calls.length === 1) {
        chrome.runtime.lastError = { message: 'service worker restarting' };
        callback();
        delete chrome.runtime.lastError;
        return;
      }
      callback();
    });

    globalThis.window = {
      localStorage: { getItem },
      addEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;
    globalThis.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    await import('./auth-bridge.js');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(
      { type: 'holaday.auth.token', token },
      expect.any(Function),
    );
  });

  it('retries an observed token when the service worker reports an internal failure', async () => {
    vi.useFakeTimers();
    const token = 'hd_live_' + 'a'.repeat(24);
    const getItem = vi.fn((key: string) => (key === TOKEN_KEY ? token : null));
    const sendMessage = vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
      if (sendMessage.mock.calls.length === 1) {
        callback({ ok: false, reason: 'internal_error' });
        return;
      }
      callback({ ok: true });
    });

    globalThis.window = {
      localStorage: { getItem },
      addEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;
    globalThis.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    await import('./auth-bridge.js');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(
      { type: 'holaday.auth.token', token },
      expect.any(Function),
    );
  });

  it('does not let an old send failure roll back a newer token', async () => {
    vi.useFakeTimers();
    const oldToken = 'hd_old_' + 'a'.repeat(24);
    const newToken = 'hd_new_' + 'b'.repeat(24);
    let currentToken = oldToken;
    const storageListeners: Array<(event: StorageEvent) => void> = [];
    const callbacks: Array<() => void> = [];
    const getItem = vi.fn((key: string) => (key === TOKEN_KEY ? currentToken : null));
    const sendMessage = vi.fn((_message: unknown, callback: () => void) => {
      callbacks.push(callback);
    });

    globalThis.window = {
      localStorage: { getItem },
      addEventListener: vi.fn((event: string, listener: (event: StorageEvent) => void) => {
        if (event === 'storage') storageListeners.push(listener);
      }),
    } as unknown as Window & typeof globalThis;
    globalThis.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    await import('./auth-bridge.js');
    expect(sendMessage).toHaveBeenCalledTimes(1);

    currentToken = newToken;
    const [fireStorage] = storageListeners;
    if (!fireStorage) throw new Error('expected storage listener');
    fireStorage({ key: TOKEN_KEY } as StorageEvent);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    callbacks[1]?.();
    chrome.runtime.lastError = { message: 'old worker callback arrived late' };
    callbacks[0]?.();
    delete chrome.runtime.lastError;

    await vi.advanceTimersByTimeAsync(3_000);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      { type: 'holaday.auth.token', token: newToken },
      expect.any(Function),
    );
  });
});

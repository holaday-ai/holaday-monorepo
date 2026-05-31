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
});

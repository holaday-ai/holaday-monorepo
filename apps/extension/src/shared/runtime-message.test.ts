import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRuntimeMessageWithRetry } from './runtime-message.js';

describe('sendRuntimeMessageWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup
    delete globalThis.chrome;
  });

  it('retries when the service worker reports an internal failure', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
      callback(sendMessage.mock.calls.length === 1 ? { ok: false, reason: 'internal_error' } : { ok: true });
    });
    setRuntimeSendMessage(sendMessage);

    const pending = sendRuntimeMessageWithRetry<{ ok: boolean }>({ type: 'holaday.status' });
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('uses three default attempts for service worker cold starts', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
      if (sendMessage.mock.calls.length < 3) {
        callback({ ok: false, reason: 'internal_error' });
        return;
      }
      callback({ ok: true });
    });
    setRuntimeSendMessage(sendMessage);

    const pending = sendRuntimeMessageWithRetry<{ ok: boolean }>({ type: 'holaday.tasks' });
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('retries once when the runtime message callback times out', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
      if (sendMessage.mock.calls.length > 1) callback({ ok: true });
    });
    setRuntimeSendMessage(sendMessage);

    const pending = sendRuntimeMessageWithRetry<{ ok: boolean }>(
      { type: 'holaday.status' },
      { timeoutMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(350);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('falls back to safe defaults for invalid retry options', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
      if (sendMessage.mock.calls.length > 1) callback({ ok: true });
    });
    setRuntimeSendMessage(sendMessage);

    const pending = sendRuntimeMessageWithRetry<{ ok: boolean }>(
      { type: 'holaday.status' },
      {
        attempts: Number.NaN,
        timeoutMs: Number.NaN,
        retryDelayMs: Number.NaN,
      },
    );

    await vi.advanceTimersByTimeAsync(4_999);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(251);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns null after retryable failures are exhausted', async () => {
    setRuntimeSendMessage(vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
      callback({ ok: false, reason: 'internal_error' });
    }));

    const pending = sendRuntimeMessageWithRetry<{ ok: boolean }>(
      { type: 'holaday.status' },
      { attempts: 2 },
    );
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toBeNull();
  });
});

function setRuntimeSendMessage(
  sendMessage: (message: unknown, callback: (response?: unknown) => void) => void,
): void {
  const runtime = chrome.runtime as unknown as {
    sendMessage: (message: unknown, callback: (response?: unknown) => void) => void;
  };
  runtime.sendMessage = sendMessage;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithDeadline } from './http.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchWithDeadline', () => {
  it('returns the fetch response before the deadline', async () => {
    const response = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(
      fetchWithDeadline('https://holaday.ai/ping', undefined, 1_000, 'fetch_timeout'),
    ).resolves.toBe(response);
  });

  it('aborts a fetch that never settles', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }),
    );

    const pending = fetchWithDeadline(
      'https://holaday.ai/ping',
      undefined,
      1_000,
      'fetch_timeout',
    );
    const assertion = expect(pending).rejects.toThrow('fetch_timeout');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(signal?.aborted).toBe(true);
    await assertion;
  });
});

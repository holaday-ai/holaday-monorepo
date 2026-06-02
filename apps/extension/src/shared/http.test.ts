import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithDeadline, responseJsonWithDeadline } from './http.js';

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

  it('falls back to the default deadline for invalid fetch timeouts', async () => {
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
      Number.NaN,
      'fetch_timeout',
    );
    const assertion = expect(pending).rejects.toThrow('fetch_timeout');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await assertion;
  });
});

describe('responseJsonWithDeadline', () => {
  it('bounds response json reads that never settle', async () => {
    vi.useFakeTimers();
    const response = {
      json: vi.fn(() => new Promise(() => undefined)),
    } as unknown as Response;

    const pending = responseJsonWithDeadline(response, 1_000, 'json_timeout');
    const assertion = expect(pending).rejects.toThrow('json_timeout');
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
  });

  it('falls back to the default deadline for invalid body timeouts', async () => {
    vi.useFakeTimers();
    const response = {
      json: vi.fn(() => new Promise(() => undefined)),
    } as unknown as Response;

    const pending = responseJsonWithDeadline(
      response,
      Number.NaN,
      'json_timeout',
    );
    const assertion = expect(pending).rejects.toThrow('json_timeout');
    await vi.advanceTimersByTimeAsync(29_999);
    await vi.advanceTimersByTimeAsync(1);

    await assertion;
  });
});

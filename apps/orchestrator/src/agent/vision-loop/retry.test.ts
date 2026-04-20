import { describe, expect, it } from 'vitest';
import { isRetryableAnthropicError, retryAsync } from './retry.js';

describe('retryAsync', () => {
  it('returns on first success without retrying', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return 42;
    };
    const r = await retryAsync(fn, { maxAttempts: 3 });
    expect(r).toBe(42);
    expect(calls).toBe(1);
  });

  it('retries up to maxAttempts and eventually returns', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'done';
    };
    const r = await retryAsync(fn, { maxAttempts: 3, delayMs: () => 0 });
    expect(r).toBe('done');
    expect(calls).toBe(3);
  });

  it('rethrows when isRetryable returns false', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      throw new Error('non-retryable');
    };
    await expect(
      retryAsync(fn, { maxAttempts: 5, delayMs: () => 0, isRetryable: () => false }),
    ).rejects.toThrow('non-retryable');
    expect(calls).toBe(1);
  });

  it('rethrows when maxAttempts exhausted', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      throw new Error(`fail ${calls}`);
    };
    await expect(retryAsync(fn, { maxAttempts: 2, delayMs: () => 0 })).rejects.toThrow('fail 2');
    expect(calls).toBe(2);
  });

  it('calls onRetry hook with attempt index before each retry', async () => {
    const hookCalls: Array<{ attempt: number; msg: string }> = [];
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) throw new Error(`e${calls}`);
      return 'ok';
    };
    await retryAsync(fn, {
      maxAttempts: 5,
      delayMs: () => 0,
      onRetry: (attempt, err) => {
        hookCalls.push({ attempt, msg: (err as Error).message });
      },
    });
    expect(hookCalls).toEqual([
      { attempt: 1, msg: 'e1' },
      { attempt: 2, msg: 'e2' },
    ]);
  });
});

describe('isRetryableAnthropicError', () => {
  it('retries 429', () => {
    expect(isRetryableAnthropicError({ status: 429 })).toBe(true);
  });
  it('retries 5xx', () => {
    expect(isRetryableAnthropicError({ status: 500 })).toBe(true);
    expect(isRetryableAnthropicError({ status: 503 })).toBe(true);
    expect(isRetryableAnthropicError({ status: 599 })).toBe(true);
  });
  it('retries 408/409', () => {
    expect(isRetryableAnthropicError({ status: 408 })).toBe(true);
    expect(isRetryableAnthropicError({ status: 409 })).toBe(true);
  });
  it('does NOT retry 400/401/403/404', () => {
    expect(isRetryableAnthropicError({ status: 400 })).toBe(false);
    expect(isRetryableAnthropicError({ status: 401 })).toBe(false);
    expect(isRetryableAnthropicError({ status: 403 })).toBe(false);
    expect(isRetryableAnthropicError({ status: 404 })).toBe(false);
  });
  it('retries transport errors via message sniffing', () => {
    expect(isRetryableAnthropicError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableAnthropicError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableAnthropicError(new Error('fetch failed: TLS'))).toBe(true);
    expect(isRetryableAnthropicError(new Error('socket hang up'))).toBe(true);
    expect(isRetryableAnthropicError(new Error('network timeout'))).toBe(true);
  });
  it('does NOT retry unknown-shape non-transport errors', () => {
    expect(isRetryableAnthropicError(new Error('invalid request: bad schema'))).toBe(false);
  });
});

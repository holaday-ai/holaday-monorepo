import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('opens after three consecutive failures and rejects the fourth operation', async () => {
    let now = 0;
    const operation = vi.fn(async () => {
      throw new Error('upstream failed');
    });
    const breaker = new CircuitBreaker({ now: () => now });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(breaker.execute(operation)).rejects.toThrow('upstream failed');
    }
    await expect(breaker.execute(operation)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).toHaveBeenCalledTimes(3);

    now = 59_999;
    await expect(breaker.execute(operation)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('admits one half-open probe after 60 seconds and closes after success', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ now: () => now });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        breaker.execute(async () => {
          throw new Error('upstream failed');
        }),
      ).rejects.toThrow('upstream failed');
    }

    now = 60_000;
    let releaseProbe: ((value: string) => void) | undefined;
    const probe = breaker.execute(
      () =>
        new Promise<string>((resolve) => {
          releaseProbe = resolve;
        }),
    );
    await expect(breaker.execute(async () => 'second probe')).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    releaseProbe?.('recovered');
    await expect(probe).resolves.toBe('recovered');
    await expect(breaker.execute(async () => 'closed')).resolves.toBe('closed');
  });
});

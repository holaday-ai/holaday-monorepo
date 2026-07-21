import { describe, expect, it } from 'vitest';
import {
  BrowserSessionRestoreFlights,
  restorableBrowserTarget,
} from './browser-session-recovery.js';

describe('restorableBrowserTarget', () => {
  it('restores a terminal browser task at its last trusted URL', () => {
    expect(
      restorableBrowserTarget({
        status: 'completed',
        origin: 'user',
        result: {
          finalUrl: 'https://example.com/account',
          metadata: { executionMode: 'browser' },
        },
      }),
    ).toEqual({ url: 'https://example.com/account' });
  });

  it('accepts older rows with top-level browser execution metadata', () => {
    expect(
      restorableBrowserTarget({
        status: 'failed',
        origin: 'user',
        result: {
          finalUrl: 'https://example.com/retry',
          executionMode: 'browser',
        },
      }),
    ).toEqual({ url: 'https://example.com/retry' });
  });

  it('refuses non-browser, non-terminal, synthetic, and unsafe rows', () => {
    expect(
      restorableBrowserTarget({
        status: 'completed',
        origin: 'user',
        result: { finalUrl: 'https://example.com', executionMode: 'generate' },
      }),
    ).toBeNull();
    expect(
      restorableBrowserTarget({
        status: 'executing',
        origin: 'user',
        result: { finalUrl: 'https://example.com', executionMode: 'browser' },
      }),
    ).toBeNull();
    expect(
      restorableBrowserTarget({
        status: 'paused',
        origin: 'user',
        result: { finalUrl: 'https://example.com', executionMode: 'browser' },
      }),
    ).toBeNull();
    expect(
      restorableBrowserTarget({
        status: 'completed',
        origin: 'system',
        result: { finalUrl: 'https://example.com', executionMode: 'browser' },
      }),
    ).toBeNull();
    expect(
      restorableBrowserTarget({
        status: 'completed',
        origin: 'user',
        result: { finalUrl: 'javascript:alert(1)', executionMode: 'browser' },
      }),
    ).toBeNull();
  });
});

describe('BrowserSessionRestoreFlights', () => {
  it('shares one restore operation for the same pool and task', async () => {
    const flights = new BrowserSessionRestoreFlights();
    const pool = {};
    let resolveRestore: ((value: string) => void) | undefined;
    const restore = new Promise<string>((resolve) => {
      resolveRestore = resolve;
    });
    let calls = 0;

    const first = flights.run(pool, 'tsk_same', () => {
      calls += 1;
      return restore;
    });
    const second = flights.run(pool, 'tsk_same', () => {
      calls += 1;
      return Promise.resolve('duplicate');
    });

    expect(second).toBe(first);
    expect(calls).toBe(1);
    resolveRestore?.('ready');
    await expect(first).resolves.toBe('ready');
    await expect(second).resolves.toBe('ready');
  });

  it('allows a later retry after the current restore settles', async () => {
    const flights = new BrowserSessionRestoreFlights();
    const pool = {};

    await expect(
      flights.run(pool, 'tsk_retry', () => Promise.resolve('first')),
    ).resolves.toBe('first');
    await expect(
      flights.run(pool, 'tsk_retry', () => Promise.resolve('second')),
    ).resolves.toBe('second');
  });

  it('does not share restore work across browser pools', async () => {
    const flights = new BrowserSessionRestoreFlights();
    const firstPool = {};
    const secondPool = {};

    const first = flights.run(firstPool, 'tsk_same', () =>
      Promise.resolve('first'),
    );
    const second = flights.run(secondPool, 'tsk_same', () =>
      Promise.resolve('second'),
    );

    expect(second).not.toBe(first);
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });
});

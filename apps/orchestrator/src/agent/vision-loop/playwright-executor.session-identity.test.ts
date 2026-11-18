import type { BrowserContext } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';
import { PlaywrightExecutor } from './playwright-executor.js';

const releases: Array<() => void> = [];
const executors: PlaywrightExecutor[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const executor of executors.splice(0)) await executor.disconnect().catch(() => {});
  vi.unstubAllEnvs();
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function observe<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  const finished = promise.then(
    (value) => Object.assign(state, { done: true, value }),
    (error: unknown) => Object.assign(state, { done: true, error }),
  );
  return { state, finished };
}
async function fixture(
  options: { holdAcquire?: boolean; holdClose?: boolean; failClose?: boolean } = {},
) {
  vi.stubEnv('STEALTH_ENABLED', 'false');
  const acquire = gate();
  const close = gate();
  const calls = { create: 0, close: 0, sharedClose: 0, sharedNewPage: 0, transport: 0 };
  const context = {
    close: async () => {
      calls.close++;
      if (options.holdClose) await close.promise;
      if (options.failClose) throw new Error('synthetic verifier close failed');
    },
  } as unknown as BrowserContext;
  const shared = {
    pages: () => [],
    newPage: async () => {
      calls.sharedNewPage++;
    },
    close: async () => {
      calls.sharedClose++;
    },
  };
  const browser = {
    contexts: () => [shared],
    close: async () => {},
    newContext: async () => {
      calls.create++;
      if (options.holdAcquire) await acquire.promise;
      return context;
    },
  };
  const executor = new PlaywrightExecutor({
    chromium: {
      connectOverCDP: async () => {
        calls.transport++;
        return browser as never;
      },
    },
  });
  executors.push(executor);
  expect((await executor.connect('http://synthetic.invalid')).ok).toBe(true);
  return { executor, context, calls, acquire, close };
}

it('coalesces checks but a late old result cannot interrupt the replacement verifier', async () => {
  const { executor } = await fixture();
  const held = gate();
  const old = vi.fn(async () => {
    await held.promise;
    return 'account_changed';
  });
  executor.setSessionIdentityVerifier(old);
  const first = executor.verifySessionIdentity();
  const concurrent = executor.verifySessionIdentity();
  await flush();
  expect(old).toHaveBeenCalledTimes(1);
  const replacement = vi.fn(async () => null);
  executor.setSessionIdentityVerifier(replacement);
  expect(await executor.verifySessionIdentity()).toBeNull();
  held.release();
  expect(await first).toBe('identity_context_changed');
  expect(await concurrent).toBe('identity_context_changed');
  expect(executor.sessionInterruption).toBeNull();
  expect(await executor.verifySessionIdentity()).toBeNull();
  expect(replacement).toHaveBeenCalledTimes(2);
});

it('turns an unknown verification failure into an interruption and clears pending checks', async () => {
  const { executor } = await fixture();
  const check = vi.fn(async (): Promise<string | null> => {
    throw new Error('synthetic private details');
  });
  executor.setSessionIdentityVerifier(check);
  expect(await executor.verifySessionIdentity()).toBe('identity_unverified');
  expect(executor.sessionInterruption).toBe('identity_unverified');
  expect(await executor.verifySessionIdentity()).toBe('identity_unverified');
  expect(check).toHaveBeenCalledTimes(2);
});

it('shares the native connection while closing only its temporary verifier context', async () => {
  const f = await fixture({ holdClose: true });
  expect(await f.executor.createSessionVerificationContext({ serviceWorkers: 'block' })).toBe(
    f.context,
  );
  expect(f.calls.transport).toBe(1);
  const closing = observe(f.executor.closeSessionVerificationContext(f.context));
  const repeated = observe(f.executor.closeSessionVerificationContext(f.context));
  await flush();
  expect(f.calls.close).toBe(1);
  expect(closing.state.done).toBe(false);
  expect(repeated.state.done).toBe(false);
  f.close.release();
  await closing.finished;
  await repeated.finished;
  await f.executor.disconnect();
  expect(f.calls).toMatchObject({ create: 1, close: 1, sharedClose: 0, sharedNewPage: 0 });
});

it('disconnect awaits an in-flight verifier acquisition and its physical close', async () => {
  const f = await fixture({ holdAcquire: true, holdClose: true });
  const acquiring = observe(f.executor.createSessionVerificationContext({}));
  await flush();
  const disconnecting = observe(f.executor.disconnect());
  await flush();
  expect(disconnecting.state.done).toBe(false);
  f.acquire.release();
  await flush();
  expect(f.calls.close).toBe(1);
  expect(disconnecting.state.done).toBe(false);
  expect(acquiring.state.done).toBe(false);
  f.close.release();
  await disconnecting.finished;
  await acquiring.finished;
  expect(acquiring.state.error).toBeInstanceOf(Error);
  expect(disconnecting.state.error).toBeUndefined();
  expect(f.calls.sharedClose).toBe(0);
});

it('retains a failed verifier close across disposal and refuses connection replacement', async () => {
  const f = await fixture({ failClose: true });
  await f.executor.createSessionVerificationContext({});
  await expect(f.executor.closeSessionVerificationContext(f.context)).rejects.toThrow(
    'synthetic verifier close failed',
  );
  await expect(f.executor.disconnect()).rejects.toThrow('synthetic verifier close failed');
  await expect(f.executor.disposeCleanContext()).rejects.toThrow('synthetic verifier close failed');
  expect((await f.executor.connect('http://synthetic.invalid')).ok).toBe(false);
  expect(f.calls.transport).toBe(1);
  expect(f.calls.close).toBe(1);
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';
import { PlaywrightExecutor } from './playwright-executor.js';

vi.mock('../../config/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
const releases: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('STEALTH_ENABLED', 'false');
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function gate(fail: boolean) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  }).then(() => {
    if (fail) throw new Error('synthetic transport failure');
  });
  void wait.catch(() => {});
  releases.push(release);
  return { wait, release };
}
type Stage = 'connect' | 'reconnect' | 'newContext' | 'route' | 'stealth' | 'banner';
const stages: Stage[] = ['connect', 'reconnect', 'newContext', 'route', 'stealth', 'banner'];
type Failure = 'success' | 'async' | 'sync' | 'getter';
async function fixture(stage: Stage, failure: Failure = 'success') {
  const hold = gate(failure === 'async');
  const seen: Array<{ name: string; life: OperationLifetime | undefined }> = [];
  let armed = stage !== 'reconnect';
  function record(name: string) {
    if (!armed) return;
    let life: OperationLifetime | undefined;
    try {
      life = currentOperationLifetime();
    } catch {}
    seen.push({ name, life });
  }
  function method<T>(target: object, key: string, name: string, value: () => T) {
    Object.defineProperty(target, key, {
      configurable: true,
      get() {
        if (armed && name === stage && failure === 'getter') {
          record(name);
          throw new Error('synthetic getter failure');
        }
        return function (this: unknown, ..._args: unknown[]) {
          expect(this).toBe(target);
          record(name);
          if (armed && name === stage && failure === 'sync')
            throw new Error('synthetic call failure');
          return (async () => {
            if (armed && name === stage) await hold.wait;
            return value();
          })();
        };
      },
    });
  }
  const page = { isClosed: () => false, url: () => 'about:blank' };
  method(page, 'evaluate', 'banner', () => 1);
  const context = {
    pages: () => (stage === 'banner' ? [page] : []),
    newPage: async () => page,
    setDefaultTimeout: () => {},
    setDefaultNavigationTimeout: () => {},
  };
  method(context, 'addInitScript', 'stealth', () => undefined);
  method(context, 'route', 'route', () => undefined);
  const browser = { contexts: () => [context] };
  method(browser, 'newContext', 'newContext', () => context);
  const chromium = {};
  method(chromium, 'connectOverCDP', stage === 'reconnect' ? 'reconnect' : 'connect', () =>
    stage === 'reconnect' && !armed ? { contexts: () => [] } : browser,
  );
  const executor = new PlaywrightExecutor({
    chromium: chromium as never,
    ...(stage === 'route'
      ? { networkPolicy: { check: async () => ({ allowed: true }) } as never }
      : {}),
  });
  if (stage === 'reconnect') {
    expect((await executor.connect('http://synthetic.invalid')).ok).toBe(true);
    armed = true;
  }
  if (stage === 'stealth') vi.stubEnv('STEALTH_ENABLED', 'true');
  const run = () =>
    stage === 'reconnect'
      ? executor.getPage()
      : executor.connect('http://synthetic.invalid', { cleanContext: stage === 'newContext' });
  return { executor, hold, seen, run, context };
}
function start(run: () => Promise<unknown>) {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async () => {
      try {
        return await run();
      } catch {
        return undefined;
      }
    },
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  drain.close();
  return { drain, root };
}

it.each(stages.flatMap((stage) => [false, true].map((fail) => ({ stage, fail }))))(
  'holds raw $stage until settlement (late failure=$fail)',
  async ({ stage, fail }) => {
    const f = await fixture(stage, fail ? 'async' : 'success');
    const { drain, root } = start(f.run);
    await flush();
    const raw = f.seen.find((x) => x.name === stage);
    expect(raw).toBeDefined();
    expect(raw?.life?.drain).toBe(drain);
    expect(raw?.life?.owner).not.toBe(root.owner);
    if (!raw?.life) throw new Error('missing raw lifetime');
    expect(drain.finish(raw.life.owner)).toBe(false);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(drain.snapshot().idle).toBe(false);
    f.hold.release();
    await root.result;
    await flush();
    expect(drain.snapshot().active).toBe(0);
    expect(drain.snapshot().unknown > 0).toBe(fail);
    expect(drain.snapshot().idle).toBe(!fail);
  },
);
it.each(
  stages.flatMap((stage) => (['sync', 'getter'] as const).map((failure) => ({ stage, failure }))),
)('retains unknown when $stage $failure failure is caught', async ({ stage, failure }) => {
  const f = await fixture(stage, failure);
  const { drain, root } = start(f.run);
  await root.result;
  expect(drain.snapshot().active).toBe(0);
  expect(drain.snapshot().unknown).toBeGreaterThan(0);
  expect(drain.snapshot().idle).toBe(false);
});
it.each(stages)('a returned parent cannot release pending %s', async (stage) => {
  const f = await fixture(stage);
  let pending: Promise<unknown> = Promise.resolve();
  const { drain, root } = start(async () => {
    pending = f.run().catch(() => undefined);
    await flush();
    expect(f.seen.some((x) => x.name === stage)).toBe(true);
  });
  await root.result;
  expect(drain.snapshot().active).toBeGreaterThan(0);
  f.hold.release();
  await pending;
  await flush();
  expect(drain.snapshot().active).toBe(0);
});
it.each(['unknown', 'sealed', 'expired'] as const)(
  'blocks new SDK calls under %s scope',
  async (mode) => {
    const f = await fixture('connect');
    f.hold.release();
    let later: () => void = () => {};
    let laterResult: Promise<unknown> = Promise.resolve();
    const { drain, root } = start(async () => {
      const life = currentOperationLifetime();
      if (!life) throw new Error('missing scope');
      if (mode === 'unknown') life.drain.markUnknown(life.owner);
      if (mode === 'expired') {
        const wait = gate(false);
        later = wait.release;
        const pending = wait.wait.then<unknown>(f.run);
        laterResult = pending;
        return;
      }
      return withOperationDispatchScope(async (seal) => {
        if (mode === 'sealed') seal();
        return f.run();
      });
    });
    await root.result;
    if (mode === 'expired') {
      await later();
      await laterResult;
    }
    expect(f.seen).toHaveLength(0);
    expect(drain.snapshot().active).toBe(0);
  },
);
it.each(stages)('preserves no-scope %s behavior', async (stage) => {
  const f = await fixture(stage);
  f.hold.release();
  await f.run();
  expect(f.seen.some((x) => x.name === stage)).toBe(true);
  expect(f.seen.every((x) => x.life === undefined)).toBe(true);
});
it('preserves optional route absence without inventing an uncertainty', async () => {
  const f = await fixture('route');
  Object.defineProperty(f.context, 'route', { value: undefined });
  const { drain, root } = start(f.run);
  expect(await root.result).toEqual({ ok: true });
  expect(f.seen.some((x) => x.name === 'route')).toBe(false);
  expect(drain.snapshot().idle).toBe(true);
});

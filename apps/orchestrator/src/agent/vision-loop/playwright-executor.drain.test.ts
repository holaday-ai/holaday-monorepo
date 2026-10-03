import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';
import { type PageLike, PlaywrightExecutor } from './playwright-executor.js';

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
  vi.restoreAllMocks();
});
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function gate(fail = false) {
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  releases.push(release);
  const wait = pending.then(() => {
    if (fail) throw new Error('synthetic transport error');
  });
  void wait.catch(() => {});
  return { release, wait };
}
type Stage =
  | 'newPage'
  | 'close'
  | 'probe'
  | 'stealthInit'
  | 'stealthEval'
  | 'viewport'
  | 'goto'
  | 'title'
  | 'screenshot';
async function fixture(stage: Stage, fail = false) {
  const hold = gate(fail);
  const seen: Array<{ stage: Stage; life: OperationLifetime | undefined }> = [];
  const raw = async <T>(name: Stage, value: T) => {
    let life: OperationLifetime | undefined;
    try {
      life = currentOperationLifetime();
    } catch {}
    seen.push({ stage: name, life });
    if (stage === name) await hold.wait;
    return value;
  };
  let pages: unknown[] = [];
  let url = 'https://example.com/';
  const page = {
    url: () => url,
    title: () => raw('title', 'synthetic'),
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: () => raw('screenshot', Buffer.from('synthetic image')),
    goto: async (next: string) => {
      await raw('goto', undefined);
      url = next;
      return null;
    },
    evaluate: async function (this: unknown, script: unknown) {
      return raw(script === '1' ? 'probe' : 'stealthEval', 1);
    },
    addInitScript: () => raw('stealthInit', undefined),
    setViewportSize: () => raw('viewport', undefined),
    close: async function (this: unknown) {
      expect(this).toBe(page);
      return raw('close', undefined);
    },
  };
  let fresh = page;
  const context = { pages: () => pages, newPage: () => raw('newPage', fresh) };
  const executor = new PlaywrightExecutor({
    chromium: {
      connectOverCDP: async () => ({ contexts: () => [context], close: async () => {} }) as never,
    },
  });
  expect((await executor.connect('http://synthetic.invalid')).ok).toBe(true);
  const run = async () => {
    if (stage === 'close') {
      pages = [page];
      return executor.resetPageForTask();
    }
    if (stage === 'probe') return executor.isPageResponsive(page as unknown as PageLike, 10);
    if (stage === 'viewport') {
      executor.setViewportSize({ width: 390, height: 844 });
      return executor.resetPageForTask();
    }
    if (stage === 'stealthInit' || stage === 'stealthEval') {
      vi.stubEnv('STEALTH_ENABLED', 'true');
      return executor.getPage();
    }
    if (stage === 'goto' || stage === 'title')
      return executor.navigate(page as unknown as PageLike, 'https://example.com/');
    if (stage === 'screenshot') return executor.screenshot(page as unknown as PageLike);
    return executor.resetPageForTask();
  };
  return {
    hold,
    seen,
    run,
    executor,
    page,
    setPages: (value: unknown[]) => {
      pages = value;
    },
    setFresh: (value: typeof page) => {
      fresh = value;
    },
  };
}
const stages: Stage[] = [
  'newPage',
  'close',
  'probe',
  'stealthInit',
  'stealthEval',
  'viewport',
  'goto',
  'title',
  'screenshot',
];
it.each(stages.flatMap((stage) => [false, true].map((fail) => ({ stage, fail }))))(
  'tracks raw $stage until late settlement (failure=$fail)',
  async ({ stage, fail }) => {
    const f = await fixture(stage, fail);
    const drain = new ExecutionDrain();
    drain.open();
    const root = startOwnedOperation(
      drain,
      'request',
      async () => {
        try {
          await f.run();
        } catch {}
      },
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    drain.close();
    await flush();
    const entry = f.seen.find((item) => item.stage === stage);
    expect(entry).toBeDefined();
    expect(entry?.life?.owner).not.toBe(root.owner);
    expect(entry?.life?.drain).toBe(drain);
    expect(drain.snapshot().active).toBeGreaterThan(0);
    // Force the public waiter to finish where it has a timeout; that must not
    // complete the raw SDK promise or make the process look idle.
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    expect(drain.snapshot().idle).toBe(false);
    f.hold.release();
    await root.result;
    await flush();
    expect(drain.snapshot().active).toBe(0);
    expect(drain.snapshot().unknown > 0).toBe(fail);
    expect(drain.snapshot().idle).toBe(!fail);
  },
);
it.each(stages)('refuses raw %s with an already unknown scope', async (stage) => {
  const f = await fixture(stage);
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async (owner) => {
      drain.markUnknown(owner);
      try {
        await f.run();
      } catch {}
    },
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  await flush();
  f.hold.release();
  await vi.advanceTimersByTimeAsync(1600);
  await root.result;
  expect(f.seen).toEqual([]);
});
it.each(['sealed', 'expired'] as const)(
  'refuses screenshot from %s dispatch context',
  async (mode) => {
    const f = await fixture('screenshot');
    const drain = new ExecutionDrain();
    drain.open();
    const delayed = gate();
    let later: Promise<unknown> | undefined;
    const root = startOwnedOperation(
      drain,
      'request',
      async () => {
        if (mode === 'sealed')
          await withOperationDispatchScope(async (seal) => {
            seal();
            await f.run();
          });
        else later = delayed.wait.then(() => f.run());
      },
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    await flush();
    f.hold.release();
    await root.result;
    delayed.release();
    await later;
    expect(f.seen).toEqual([]);
  },
);
it('does not release a timed-out stale close when the parent returns', async () => {
  const f = await fixture('close');
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async () => {
      await f.run();
    },
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  drain.close();
  await flush();
  await vi.advanceTimersByTimeAsync(1501);
  await root.result;
  expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 0, idle: false });
  f.hold.release();
  await flush();
  expect(drain.snapshot().idle).toBe(true);
});
it.each([false, true])(
  'holds fallback detached close through late settlement (failure=%s)',
  async (fail) => {
    const f = await fixture('close', fail);
    f.page.url = () => 'about:blank';
    f.page.goto = async () => null;
    f.setFresh({ ...f.page, url: () => 'https://example.com/' });
    const drain = new ExecutionDrain();
    drain.open();
    const root = startOwnedOperation(
      drain,
      'request',
      async () => {
        await f.executor.navigate(f.page as unknown as PageLike, 'https://example.com/');
      },
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    drain.close();
    await root.result;
    expect(
      f.seen.some((entry) => entry.stage === 'close' && entry.life?.owner !== root.owner),
    ).toBe(true);
    expect(drain.snapshot()).toMatchObject({ active: 1, idle: false });
    f.hold.release();
    await flush();
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: fail ? 1 : 0, idle: !fail });
  },
);
it.each([false, true])(
  'tracks native screenshot metadata before catch (failure=%s)',
  async (fail) => {
    const f = await fixture('screenshot');
    f.hold.release();
    Object.assign(f.page, { viewportSize: () => null });
    const hold = gate(fail);
    let life: OperationLifetime | undefined;
    vi.spyOn(sharp.prototype, 'metadata').mockImplementation((() => {
      life = currentOperationLifetime();
      return hold.wait.then(() => ({ width: 1, height: 1 }));
    }) as never);
    const drain = new ExecutionDrain();
    drain.open();
    const root = startOwnedOperation(drain, 'request', async () => f.run(), {
      dispatch: 'immediate',
      errorOutcome: 'known',
    });
    drain.close();
    await flush();
    expect(life?.owner).not.toBe(root.owner);
    expect(life?.drain).toBe(drain);
    expect(drain.snapshot().idle).toBe(false);
    hold.release();
    await root.result;
    await flush();
    expect(drain.snapshot().unknown > 0).toBe(fail);
  },
);
it.each(['initial', 'redirect', 'fresh-redirect'] as const)(
  'tracks policy check at %s boundary',
  async (phase) => {
    const hold = gate();
    let life: OperationLifetime | undefined;
    let calls = 0;
    let pages: unknown[] = [];
    const target = 'https://example.com/';
    const redirect = 'https://redirect.example.com/';
    const page = {
      url: () => (phase === 'fresh-redirect' ? 'about:blank' : redirect),
      title: async () => '',
      goto: async () => null,
    };
    const fresh = { url: () => redirect, goto: async () => null };
    const ex = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () =>
          ({
            contexts: () => [{ pages: () => pages, newPage: async () => fresh }],
            close: async () => {},
          }) as never,
      },
      networkPolicy: {
        check: async (url) => {
          calls++;
          if (calls === (phase === 'initial' ? 1 : 2)) {
            life = currentOperationLifetime();
            await hold.wait;
          }
          return { allowed: true, url, addresses: ['93.184.216.34'] };
        },
      },
    });
    expect((await ex.connect('http://synthetic.invalid')).ok).toBe(true);
    pages = [page];
    const drain = new ExecutionDrain();
    drain.open();
    const root = startOwnedOperation(
      drain,
      'request',
      async () => ex.navigate(page as unknown as PageLike, target),
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    drain.close();
    await flush();
    expect(life?.owner).not.toBe(root.owner);
    expect(life?.drain).toBe(drain);
    hold.release();
    await root.result;
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0, idle: true });
  },
);
it('does not dispatch the second stale close after a synchronous first close failure', async () => {
  const f = await fixture('newPage');
  f.hold.release();
  let first = 0;
  let second = 0;
  f.setPages([
    {
      close: () => {
        first++;
        throw new Error('synthetic close failure');
      },
    },
    {
      close: async () => {
        second++;
      },
    },
  ]);
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(drain, 'request', async () => f.executor.resetPageForTask(), {
    dispatch: 'immediate',
    errorOutcome: 'known',
  });
  await flush();
  await vi.advanceTimersByTimeAsync(1501);
  await root.result;
  expect(first).toBe(1);
  expect(second).toBe(0);
  expect(drain.snapshot().unknown).toBe(1);
});
it('keeps evaluate receiver intact', async () => {
  const f = await fixture('probe');
  f.hold.release();
  let receiver: unknown;
  f.page.evaluate = async function (this: unknown) {
    receiver = this;
    return 1;
  };
  expect(await f.executor.isPageResponsive(f.page as unknown as PageLike, 10)).toBe(true);
  expect(receiver).toBe(f.page);
});

it.each([
  ['close', 'close'],
  ['viewport', 'setViewportSize'],
  ['probe', 'evaluate'],
  ['stealthInit', 'addInitScript'],
  ['stealthEval', 'evaluate'],
] as const)(
  'records a %s method getter failure before best-effort catch',
  async (stage, property) => {
    const f = await fixture(stage);
    f.hold.release();
    let reads = 0;
    Object.defineProperty(f.page, property, {
      get() {
        reads++;
        throw new Error('synthetic method getter failure');
      },
    });
    const drain = new ExecutionDrain();
    drain.open();
    const root = startOwnedOperation(
      drain,
      'request',
      async () => {
        try {
          await f.run();
        } catch {}
      },
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    await flush();
    await vi.advanceTimersByTimeAsync(1501);
    await root.result;
    expect(reads).toBe(1);
    expect(drain.snapshot().unknown).toBe(1);
  },
);
it('does not dispatch the second stale close after the first close getter fails', async () => {
  const f = await fixture('newPage');
  f.hold.release();
  let next = 0;
  f.setPages([
    {
      get close() {
        throw new Error('synthetic getter failure');
      },
    },
    {
      close: async () => {
        next++;
      },
    },
  ]);
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(drain, 'request', async () => f.executor.resetPageForTask(), {
    dispatch: 'immediate',
    errorOutcome: 'known',
  });
  await flush();
  await vi.advanceTimersByTimeAsync(1501);
  await root.result;
  expect(next).toBe(0);
  expect(drain.snapshot().unknown).toBe(1);
});
it('contains and records detached close getter failure', async () => {
  const f = await fixture('close');
  f.hold.release();
  f.page.url = () => 'about:blank';
  f.page.goto = async () => null;
  f.setFresh({ ...f.page, url: () => 'https://example.com/' });
  Object.defineProperty(f.page, 'close', {
    get() {
      throw new Error('synthetic detached getter failure');
    },
  });
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async () => f.executor.navigate(f.page as unknown as PageLike, 'https://example.com/'),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  await root.result;
  await flush();
  expect(drain.snapshot().unknown).toBe(1);
});

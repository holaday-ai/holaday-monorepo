import type { BrowserContext } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../execution/owned-operation.js';
import { _resetMasterKeyCacheForTests } from './cookie-crypto.js';
import { injectCookies, injectPendingCookies } from './sync-service.js';

vi.mock('../config/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
}));
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  vi.unstubAllEnvs();
  _resetMasterKeyCacheForTests();
});
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { wait, release };
}
function observe<T>(work: Promise<T>) {
  const state = { done: false, value: undefined as T | undefined, error: undefined as unknown };
  const finished = work.then(
    (value) => {
      state.done = true;
      state.value = value;
    },
    (error) => {
      state.done = true;
      state.error = error;
    },
  );
  pending.push(finished);
  return { state, finished };
}
type Stage = 'user' | 'row' | 'delete' | 'add';
type Row = 'valid' | 'empty' | 'invalid-json' | 'not-array' | 'empty-array' | 'bad-encryption';
function fixture(
  opts: { held?: Stage; fail?: Stage; sync?: boolean; row?: Row; ack?: unknown } = {},
) {
  const hold = gate();
  const entered = gate();
  const counts = { user: 0, row: 0, delete: 0, add: 0 };
  const packets: unknown[] = [];
  const cookies = [
    { name: 'synthetic', value: 'fixture-only', domain: '.github.com', sameSite: 'lax' },
  ];
  const row = {
    id: 2,
    cookiesJson: JSON.stringify(cookies),
    encryptedBlob: null as Buffer | null,
    encryptionIv: null as Buffer | null,
    encryptionTag: null as Buffer | null,
    encryptedKey: null as Buffer | null,
  };
  if (opts.row === 'empty') row.cookiesJson = '';
  if (opts.row === 'invalid-json') row.cookiesJson = '{';
  if (opts.row === 'not-array') row.cookiesJson = '{}';
  if (opts.row === 'empty-array') row.cookiesJson = '[]';
  if (opts.row === 'bad-encryption') {
    vi.stubEnv('COOKIE_MASTER_KEY', Buffer.alloc(32, 1).toString('base64'));
    _resetMasterKeyCacheForTests();
    row.encryptedBlob = Buffer.alloc(1);
    row.encryptionIv = Buffer.alloc(12);
    row.encryptionTag = Buffer.alloc(16);
    row.encryptedKey = Buffer.alloc(60);
  }
  function io<T>(stage: Stage, value: T): Promise<T> {
    counts[stage]++;
    if (stage === opts.held) entered.release();
    if (opts.fail === stage && opts.sync) throw new Error('synthetic IO failure');
    return (async () => {
      if (stage === opts.held) await hold.wait;
      if (opts.fail === stage) throw new Error('synthetic IO failure');
      return value;
    })();
  }
  let selects = 0;
  const db = {
    select() {
      expect(this).toBe(db);
      const stage: Stage = selects++ === 0 ? 'user' : 'row';
      return {
        from: () => ({
          where: () => ({
            limit: (n: number) => {
              expect(n).toBe(1);
              return io(stage, stage === 'user' ? [{ id: 1 }] : [row]);
            },
          }),
        }),
      };
    },
    delete() {
      expect(this).toBe(db);
      return { where: () => io('delete', 'ack' in opts ? opts.ack : [{ affectedRows: 1 }, []]) };
    },
  };
  const context = {
    addCookies(batch: unknown[]) {
      expect(this).toBe(context);
      packets.push(batch);
      return io('add', undefined);
    },
  };
  const run = () =>
    injectPendingCookies({
      db: db as never,
      context: context as never,
      userExternalId: 'synthetic',
    });
  return { db, context, run, cookies, counts, packets, hold, entered };
}
function owned(action: () => Promise<unknown>) {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(drain, 'request', action, {
    dispatch: 'immediate',
    errorOutcome: 'known',
  });
  drain.close();
  return { drain, root, done: observe(root.result) };
}

it.each(['user', 'row', 'delete', 'add'] as const)(
  'original %s IO stays pinned after caller ACK, then cannot continue from an expired parent',
  async (stage) => {
    const f = fixture({ held: stage });
    let work!: ReturnType<typeof observe<number>>;
    const run = owned(async () => {
      work = observe(f.run());
      await f.entered.wait;
    });
    await run.done.finished;
    expect(run.drain.snapshot().byKind[stage === 'add' ? 'execution' : 'database']).toBe(1);
    expect(work.state.done).toBe(false);
    expect(run.drain.snapshot().idle).toBe(false);
    f.hold.release();
    await work.finished;
    expect(run.drain.snapshot().active).toBe(0);
    if (stage !== 'delete') expect(work.state.error).toBeDefined();
  },
);

it.each(['empty', 'invalid-json', 'not-array', 'empty-array', 'bad-encryption'] as const)(
  '%s cleanup pins the actual delete until it settles',
  async (row) => {
    const f = fixture({ held: 'delete', row });
    const run = owned(f.run);
    await f.entered.wait;
    expect(run.drain.snapshot().byKind.database).toBe(1);
    expect(f.counts.add).toBe(0);
    f.hold.release();
    await run.done.finished;
    expect(run.done.state.value).toBe(0);
    expect(run.drain.snapshot().idle).toBe(true);
  },
);

it.each(['user', 'row', 'delete', 'add'] as const)(
  'a rejected raw %s call retains uncertainty before compatibility catches',
  async (stage) => {
    const f = fixture({ held: stage, fail: stage });
    const run = owned(f.run);
    await f.entered.wait;
    f.hold.release();
    await run.done.finished;
    expect(run.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(run.drain.snapshot().active).toBe(0);
    expect(run.done.state.error).toBeDefined();
    expect(f.counts.add).toBeLessThanOrEqual(1);
    if (stage === 'add') expect(f.counts.delete).toBe(0);
  },
);

it.each(['user', 'row', 'delete', 'add'] as const)(
  'a synchronous raw %s failure also retains uncertainty',
  async (stage) => {
    const f = fixture({ fail: stage, sync: true });
    const run = owned(f.run);
    await run.done.finished;
    expect(run.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(run.done.state.error).toBeDefined();
    if (stage === 'add') expect(f.counts.delete).toBe(0);
  },
);

it.each(['blocked', 'unknown', 'sealed'] as const)(
  '%s before the next DB call prevents all later side effects',
  async (condition) => {
    const f = fixture({ held: 'user' });
    let seal!: () => void;
    const run = owned(() =>
      withOperationDispatchScope(async (s) => {
        seal = s;
        return f.run();
      }),
    );
    await f.entered.wait;
    if (condition === 'blocked') run.drain.block();
    if (condition === 'unknown') run.drain.markUnknown(run.root.owner);
    if (condition === 'sealed') seal();
    f.hold.release();
    await run.done.finished;
    expect(f.counts).toEqual({ user: 1, row: 0, delete: 0, add: 0 });
    expect(run.done.state.error).toBeDefined();
  },
);

it.each(['blocked', 'unknown', 'sealed'] as const)(
  '%s on entry rejects before obtaining any DB method',
  async (condition) => {
    const f = fixture();
    const run = owned(() =>
      withOperationDispatchScope(async (seal) => {
        const lifetime = currentOperationLifetime();
        if (!lifetime) throw new Error('expected synthetic operation scope');
        if (condition === 'blocked') lifetime.drain.block();
        if (condition === 'unknown') lifetime.drain.markUnknown(lifetime.owner);
        if (condition === 'sealed') seal();
        return f.run();
      }),
    );
    await run.done.finished;
    expect(f.counts).toEqual({ user: 0, row: 0, delete: 0, add: 0 });
    expect(run.done.state.error).toBeDefined();
  },
);

it.each(['sealed', 'blocked', 'unknown'] as const)(
  'checks SDK dispatch again after a getter makes the scope %s',
  async (condition) => {
    let calls = 0;
    const run = owned(() =>
      withOperationDispatchScope(async (seal) => {
        const life = currentOperationLifetime();
        if (!life) throw new Error('expected synthetic operation scope');
        const context = {
          get addCookies() {
            if (condition === 'sealed') seal();
            if (condition === 'blocked') life.drain.block();
            if (condition === 'unknown') life.drain.markUnknown(life.owner);
            return async () => {
              calls++;
            };
          },
        };
        return injectCookies(context as never, [
          { name: 'synthetic', value: '', domain: '.github.com' },
        ]);
      }),
    );
    await run.done.finished;
    expect(calls).toBe(0);
    expect(run.done.state.error).toBeDefined();
    expect(run.drain.snapshot().unknown).toBe(condition === 'unknown' ? 1 : 0);
  },
);

it('records a throwing SDK getter without retry or deleting pending cookies', async () => {
  const f = fixture();
  Object.defineProperty(f.context, 'addCookies', {
    get() {
      throw new Error('synthetic getter');
    },
  });
  const run = owned(f.run);
  await run.done.finished;
  expect(run.drain.snapshot().unknown).toBeGreaterThan(0);
  expect(f.counts.delete).toBe(0);
  expect(run.done.state.error).toBeDefined();
});

it('success keeps mapped payload, return count and clears once after injection', async () => {
  const f = fixture();
  const run = owned(f.run);
  await run.done.finished;
  expect(run.done.state.value).toBe(1);
  expect(f.counts).toEqual({ user: 1, row: 1, delete: 1, add: 1 });
  expect(f.packets).toEqual([
    [
      {
        name: 'synthetic',
        value: 'fixture-only',
        domain: '.github.com',
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: 'Lax',
      },
    ],
  ]);
  expect(run.drain.snapshot().idle).toBe(true);
});

it('without a scope preserves best-effort bulk/per-cookie fallback and final cleanup', async () => {
  const f = fixture({ fail: 'add' });
  expect(await f.run()).toBe(1);
  expect(f.counts).toEqual({ user: 1, row: 1, delete: 1, add: 2 });
});

it('an empty cookie list does not access the SDK', async () => {
  const context = {
    get addCookies() {
      throw new Error('should not dispatch');
    },
  } as unknown as BrowserContext;
  expect(await injectCookies(context, [])).toBeUndefined();
});

it.each([
  undefined,
  null,
  {},
  [],
  [{ affectedRows: '1' }],
  [{ affectedRows: -1 }],
  [{ affectedRows: 2 }],
  [{ affectedRows: Number.NaN }],
])(
  'rejects malformed delete acknowledgement %# while retaining database uncertainty',
  async (ack) => {
    const f = fixture({ ack });
    const run = owned(f.run);
    await run.done.finished;
    expect(run.done.state.error).toBeDefined();
    expect(run.drain.snapshot().unknown).toBe(1);
    expect(run.drain.snapshot().active).toBe(0);
    expect(f.counts.delete).toBe(1);
  },
);
it.each([0, 1])('accepts exact delete acknowledgement %i', async (affectedRows) => {
  const f = fixture({ ack: [{ affectedRows }, []] });
  const run = owned(f.run);
  await run.done.finished;
  expect(run.done.state.value).toBe(1);
  expect(run.drain.snapshot().idle).toBe(true);
});
it('without ownership preserves legacy delete result compatibility', async () => {
  const f = fixture({ ack: undefined });
  expect(await f.run()).toBe(1);
});

it.each(['empty', 'invalid-json', 'not-array', 'empty-array', 'bad-encryption'] as const)(
  '%s cleanup also rejects missing deletion acknowledgement',
  async (row) => {
    const f = fixture({ row, ack: undefined });
    const run = owned(f.run);
    await run.done.finished;
    expect(run.done.state.error).toBeDefined();
    expect(run.drain.snapshot().unknown).toBe(1);
    expect(f.counts).toEqual({ user: 1, row: 1, delete: 1, add: 0 });
  },
);
it.each(['select', 'delete'] as const)(
  'a throwing database %s getter records uncertainty',
  async (method) => {
    const f = fixture();
    Object.defineProperty(f.db, method, {
      get() {
        throw new Error('synthetic database getter');
      },
    });
    const run = owned(f.run);
    await run.done.finished;
    expect(run.done.state.error).toBeDefined();
    expect(run.drain.snapshot().unknown).toBe(1);
  },
);
it.each(['blocked', 'unknown', 'sealed'] as const)(
  '%s during successful raw cookie injection retains pending row instead of dispatching delete',
  async (condition) => {
    const f = fixture({ held: 'add' });
    let seal!: () => void;
    const run = owned(() =>
      withOperationDispatchScope(async (s) => {
        seal = s;
        return f.run();
      }),
    );
    await f.entered.wait;
    if (condition === 'blocked') run.drain.block();
    if (condition === 'unknown') run.drain.markUnknown(run.root.owner);
    if (condition === 'sealed') seal();
    expect(run.drain.snapshot().byKind.execution).toBe(1);
    f.hold.release();
    await run.done.finished;
    expect(run.done.state.error).toBeDefined();
    expect(f.counts.delete).toBe(0);
    expect(run.drain.snapshot().unknown).toBe(condition === 'unknown' ? 1 : 0);
    expect(run.drain.snapshot().active).toBe(0);
  },
);

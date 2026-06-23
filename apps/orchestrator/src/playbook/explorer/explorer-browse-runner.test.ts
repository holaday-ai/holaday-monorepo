import { describe, expect, it } from 'vitest';
import {
  type CleanBrowseExecutor,
  makeRunBrowseTask,
  withExplorationRun,
} from './explorer-browse-runner.js';
import type { ExploreSiteOutcome } from './explorer.js';

function fakeExecutor(over: Partial<Record<'connectOk' | 'cleanThrows', boolean>> = {}) {
  const calls = { connect: 0, assert: 0, dispose: 0 };
  const ex: CleanBrowseExecutor = {
    connect: async (_e, opts) => {
      calls.connect += 1;
      expect(opts.cleanContext).toBe(true); // ALWAYS clean-context
      return over.connectOk === false ? { ok: false, error: 'no cdp' } : { ok: true };
    },
    assertCleanContext: async () => {
      calls.assert += 1;
      if (over.cleanThrows) throw new Error('clean context is NOT clean: 1 cookie(s)');
    },
    disposeCleanContext: async () => {
      calls.dispose += 1;
    },
  };
  return { ex, calls };
}

describe('makeRunBrowseTask — clean-context contract', () => {
  it('happy path: connect(clean) → assert → runSupercar → dispose (always)', async () => {
    const { ex, calls } = fakeExecutor();
    let ranSupercar = false;
    const run = makeRunBrowseTask({
      cdpEndpoint: 'http://x',
      makeExecutor: () => ex,
      runSupercar: async ({ executor }) => {
        ranSupercar = true;
        expect(executor).toBe(ex);
        return { status: 'completed' };
      },
      newTaskExternalId: () => 'tsk_1',
      resolveTaskInternalId: async () => 42,
    });
    const r = await run({
      domain: 'figma.com',
      intent: 'i',
      onBeforeAction: () => ({ allowed: true }),
    });
    expect(r.status).toBe('completed');
    expect(r.taskInternalId).toBe(42);
    expect(calls).toEqual({ connect: 1, assert: 1, dispose: 1 });
    expect(ranSupercar).toBe(true);
  });

  it('🔒 DIRTY context (assert throws) → failed, runSupercar NEVER called, context disposed', async () => {
    const { ex, calls } = fakeExecutor({ cleanThrows: true });
    let ranSupercar = false;
    const run = makeRunBrowseTask({
      cdpEndpoint: 'http://x',
      makeExecutor: () => ex,
      runSupercar: async () => {
        ranSupercar = true;
        return { status: 'completed' };
      },
      newTaskExternalId: () => 'tsk_1',
      resolveTaskInternalId: async () => 42,
    });
    const r = await run({
      domain: 'x.com',
      intent: 'i',
      onBeforeAction: () => ({ allowed: true }),
    });
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/not clean/i);
    expect(ranSupercar).toBe(false); // never browsed a dirty context
    expect(calls.dispose).toBe(1); // disposed in finally
  });

  it('connect failure → failed, dispose still called', async () => {
    const { ex, calls } = fakeExecutor({ connectOk: false });
    const run = makeRunBrowseTask({
      cdpEndpoint: 'http://x',
      makeExecutor: () => ex,
      runSupercar: async () => ({ status: 'completed' }),
      newTaskExternalId: () => 'tsk_1',
      resolveTaskInternalId: async () => null,
    });
    const r = await run({
      domain: 'x.com',
      intent: 'i',
      onBeforeAction: () => ({ allowed: true }),
    });
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/connect/i);
    expect(calls.assert).toBe(0);
    expect(calls.dispose).toBe(1);
  });
});

describe('withExplorationRun — persists one row per browse', () => {
  it('writes site/status/cost/note (status mapped) without altering the outcome', async () => {
    const written: Array<Record<string, unknown>> = [];
    const outcome: ExploreSiteOutcome = {
      domain: 'figma.com',
      status: 'halted_sensitive',
      costUsd: 0.37,
      note: 'live-veto: 登录',
    };
    const wrapped = withExplorationRun(async () => outcome, {
      resolveSiteId: async () => 9,
      createExplorationRun: async (input) => {
        written.push(input);
        return {};
      },
    });
    const r = await wrapped('figma.com');
    expect(r).toEqual(outcome); // outcome unchanged
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      siteId: 9,
      runnerType: 'explorer.browse',
      status: 'halted_sensitive',
    });
    expect((written[0]?.metadataJson as { costUsd: number }).costUsd).toBe(0.37);
  });

  it('a write failure is swallowed (outcome still returned)', async () => {
    const outcome: ExploreSiteOutcome = {
      domain: 'x.com',
      status: 'completed',
      costUsd: 0.1,
      note: 'ok',
    };
    const wrapped = withExplorationRun(async () => outcome, {
      resolveSiteId: async () => {
        throw new Error('db down');
      },
      createExplorationRun: async () => ({}),
    });
    const r = await wrapped('x.com');
    expect(r).toEqual(outcome);
  });
});

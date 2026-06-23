import { describe, expect, it } from 'vitest';
import {
  type CleanBrowseExecutor,
  makeRunBrowseTask,
  requireBrowseEnv,
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
      runSupercar: async ({ executor, onBeforeAction }) => {
        ranSupercar = true;
        expect(executor).toBe(ex); // the SAME clean executor the runner connected
        expect(typeof onBeforeAction).toBe('function'); // veto hook threaded through
        return { status: 'completed', costUsd: 0.42 };
      },
      newTaskExternalId: () => 'tsk_1',
    });
    const r = await run({
      domain: 'figma.com',
      intent: 'i',
      onBeforeAction: () => ({ allowed: true }),
    });
    expect(r.status).toBe('completed');
    expect(r.costUsd).toBe(0.42); // cost-source A: runSupercar's in-memory cost flows through
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
        return { status: 'completed', costUsd: 0.1 };
      },
      newTaskExternalId: () => 'tsk_1',
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
      runSupercar: async () => ({ status: 'completed', costUsd: 0.1 }),
      newTaskExternalId: () => 'tsk_1',
    });
    const r = await run({
      domain: 'x.com',
      intent: 'i',
      onBeforeAction: () => ({ allowed: true }),
    });
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/connect/i);
    expect(r.costUsd).toBe(0); // connect-fail → never browsed → zero cost
    expect(calls.assert).toBe(0);
    expect(calls.dispose).toBe(1);
  });
});

describe('requireBrowseEnv — FAIL-CLOSED env gate (the cost-source-A hinge)', () => {
  it('🔴 throws when EXPLORER_USER_EXTERNAL_ID missing (recorder gate → breaker would read $0 = fail-OPEN)', () => {
    expect(() => requireBrowseEnv({ HEADED_CDP_ENDPOINT: 'http://127.0.0.1:9223' })).toThrow(
      /EXPLORER_USER_EXTERNAL_ID|fail-OPEN/i,
    );
  });
  it('treats blank/whitespace user id as missing (still fail-closed)', () => {
    expect(() =>
      requireBrowseEnv({ EXPLORER_USER_EXTERNAL_ID: '   ', HEADED_CDP_ENDPOINT: 'http://x:9223' }),
    ).toThrow(/EXPLORER_USER_EXTERNAL_ID/);
  });
  it('throws when HEADED_CDP_ENDPOINT missing (would hit the dead 9222)', () => {
    expect(() => requireBrowseEnv({ EXPLORER_USER_EXTERNAL_ID: 'usr_1' })).toThrow(
      /HEADED_CDP_ENDPOINT/,
    );
  });
  it('returns both when present (the only path that lets browse proceed)', () => {
    expect(
      requireBrowseEnv({
        EXPLORER_USER_EXTERNAL_ID: 'usr_1',
        HEADED_CDP_ENDPOINT: 'http://127.0.0.1:9223',
      }),
    ).toEqual({ userExternalId: 'usr_1', cdpEndpoint: 'http://127.0.0.1:9223' });
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

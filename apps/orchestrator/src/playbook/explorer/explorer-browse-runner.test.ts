import { describe, expect, it } from 'vitest';
import {
  type CleanBrowseExecutor,
  DEFAULT_BROWSE_HARD_MS,
  DEFAULT_MAX_ITERATIONS,
  MAX_ITERATIONS_CEILING,
  makeRunBrowseTask,
  requireBrowseEnv,
  resolveBrowseHardMs,
  resolveMaxIterations,
  withExplorationRun,
  withHardDeadline,
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

describe('resolveMaxIterations — env-configurable per-browse cap (fail-safe + clamp)', () => {
  it('missing / blank → DEFAULT', () => {
    expect(resolveMaxIterations(undefined)).toBe(DEFAULT_MAX_ITERATIONS);
    expect(resolveMaxIterations('')).toBe(DEFAULT_MAX_ITERATIONS);
  });
  it('non-positive / non-integer / garbage → DEFAULT (fail-safe)', () => {
    expect(resolveMaxIterations('0')).toBe(DEFAULT_MAX_ITERATIONS);
    expect(resolveMaxIterations('-5')).toBe(DEFAULT_MAX_ITERATIONS);
    expect(resolveMaxIterations('15.5')).toBe(DEFAULT_MAX_ITERATIONS);
    expect(resolveMaxIterations('abc')).toBe(DEFAULT_MAX_ITERATIONS);
  });
  it('a valid value is used (BOSS tunes batch-1 without a redeploy)', () => {
    expect(resolveMaxIterations('15')).toBe(15);
    expect(resolveMaxIterations(String(MAX_ITERATIONS_CEILING))).toBe(MAX_ITERATIONS_CEILING);
  });
  it('🛡️ fat-finger above the ceiling is CLAMPED (a mistyped 2500 cannot run away)', () => {
    expect(resolveMaxIterations('2500')).toBe(MAX_ITERATIONS_CEILING);
  });
});

describe('resolveBrowseHardMs — per-browse hard wall (env, fail-safe)', () => {
  it('missing / non-positive / garbage → DEFAULT', () => {
    expect(resolveBrowseHardMs(undefined)).toBe(DEFAULT_BROWSE_HARD_MS);
    expect(resolveBrowseHardMs('0')).toBe(DEFAULT_BROWSE_HARD_MS);
    expect(resolveBrowseHardMs('-1')).toBe(DEFAULT_BROWSE_HARD_MS);
    expect(resolveBrowseHardMs('abc')).toBe(DEFAULT_BROWSE_HARD_MS);
  });
  it('a valid value is used (BOSS tunes without redeploy)', () => {
    expect(resolveBrowseHardMs('600000')).toBe(600000);
  });
});

describe('withHardDeadline — fixes the soft-timeout gap (a hung op past the wall)', () => {
  it('work resolves before the wall → returns value, onTimeout NOT called', async () => {
    let fired = false;
    const r = await withHardDeadline(Promise.resolve('ok'), 1000, () => {
      fired = true;
    });
    expect(r).toBe('ok');
    expect(fired).toBe(false);
  });
  it('🔴 a HUNG work past the wall → onTimeout fires (force-dispose) + rejects', async () => {
    let fired = false;
    const hung = new Promise<string>(() => {}); // never resolves — like a blocked page op
    await expect(
      withHardDeadline(hung, 20, () => {
        fired = true; // in the real adapter: dispose the clean context → unblock the op
      }),
    ).rejects.toThrow(/hard deadline/i);
    expect(fired).toBe(true);
  });
  it('onTimeout throwing does not mask the timeout rejection (best-effort)', async () => {
    const hung = new Promise<string>(() => {});
    await expect(
      withHardDeadline(hung, 20, () => {
        throw new Error('dispose blew up');
      }),
    ).rejects.toThrow(/hard deadline/i);
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

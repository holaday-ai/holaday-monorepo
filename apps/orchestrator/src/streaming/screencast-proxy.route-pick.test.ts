/**
 * Phase 24 fix #2 — per-task screencast route dispatcher.
 *
 * The `/screencast-ws/{arg}` upgrade path historically treated `{arg}`
 * as a userId and called `pool.peekActiveForUser(callerUserId)`. With
 * per-task browser pool (Phase 24), each in-flight task has its own
 * Brave keyed by taskId — and the SPA needs to let the user click a
 * specific task in the side panel and watch THAT task's browser, not
 * "the most recently active one for this user".
 *
 * The route picker dispatches by ID prefix:
 *   - `tsk_…` → look up via pool.peek(taskId), verify the JWT subject
 *     owns the task (`instance.userId === callerUserId`), reject as
 *     forbidden on mismatch.
 *   - else (legacy `usr_…` or any non-task id) → preserve the
 *     existing peekActiveForUser(callerUserId) behaviour.
 *
 * Pure function: takes the URL arg + caller JWT subject + two pool
 * lookup closures, returns a discriminated outcome. The proxy layer
 * uses the outcome to either accept the upgrade or reject with the
 * matching HTTP status.
 */

import { describe, expect, it, vi } from 'vitest';
import { pickInstanceForRoute } from './screencast-proxy.js';
import type { BrowserInstance } from '../browser-pool/types.js';

function fakeInstance(overrides: Partial<BrowserInstance>): BrowserInstance {
  return {
    taskId: 'tsk_default',
    userId: 'usr_default',
    userDataDir: '/tmp/x',
    // Cast the executor — pickInstanceForRoute never touches it.
    executor: {} as BrowserInstance['executor'],
    xvfbPid: 0,
    bravePid: 0,
    x11vncPid: 0,
    websockifyPid: 0,
    lastActiveAt: Date.now(),
    createdAt: Date.now(),
    status: 'ready',
    cdpPort: 9300,
    vncPort: 5900,
    wsPort: 6900,
    displayNumber: 1,
    ...overrides,
  } as BrowserInstance;
}

describe('pickInstanceForRoute — taskId path (tsk_…)', () => {
  it('returns the instance when taskId resolves and ownership matches', () => {
    const inst = fakeInstance({ taskId: 'tsk_abc', userId: 'usr_alice' });
    const peek = vi.fn().mockReturnValue(inst);
    const peekActiveForUser = vi.fn();

    const out = pickInstanceForRoute({
      urlArg: 'tsk_abc',
      callerUserId: 'usr_alice',
      peek,
      peekActiveForUser,
    });

    expect(out.kind).toBe('instance');
    if (out.kind === 'instance') expect(out.instance).toBe(inst);
    expect(peek).toHaveBeenCalledWith('tsk_abc');
    expect(peekActiveForUser).not.toHaveBeenCalled();
  });

  it('returns no-active when the task is unknown', () => {
    const peek = vi.fn().mockReturnValue(null);
    const peekActiveForUser = vi.fn();

    const out = pickInstanceForRoute({
      urlArg: 'tsk_missing',
      callerUserId: 'usr_alice',
      peek,
      peekActiveForUser,
    });

    expect(out.kind).toBe('no-active');
    expect(peekActiveForUser).not.toHaveBeenCalled();
  });

  it('returns forbidden when caller does not own the task', () => {
    const inst = fakeInstance({ taskId: 'tsk_abc', userId: 'usr_alice' });
    const peek = vi.fn().mockReturnValue(inst);

    const out = pickInstanceForRoute({
      urlArg: 'tsk_abc',
      callerUserId: 'usr_mallory',
      peek,
      peekActiveForUser: vi.fn(),
    });

    expect(out.kind).toBe('forbidden');
  });

  it('does NOT call peekActiveForUser when arg is a taskId', () => {
    const peek = vi.fn().mockReturnValue(null);
    const peekActiveForUser = vi.fn();

    pickInstanceForRoute({
      urlArg: 'tsk_xyz',
      callerUserId: 'usr_alice',
      peek,
      peekActiveForUser,
    });

    expect(peekActiveForUser).not.toHaveBeenCalled();
  });
});

describe('pickInstanceForRoute — userId path (legacy compat)', () => {
  it('returns the active instance when arg matches caller user', () => {
    const inst = fakeInstance({ taskId: 'tsk_anything', userId: 'usr_alice' });
    const peekActiveForUser = vi.fn().mockReturnValue(inst);

    const out = pickInstanceForRoute({
      urlArg: 'usr_alice',
      callerUserId: 'usr_alice',
      peek: vi.fn(),
      peekActiveForUser,
    });

    expect(out.kind).toBe('instance');
    if (out.kind === 'instance') expect(out.instance).toBe(inst);
    expect(peekActiveForUser).toHaveBeenCalledWith('usr_alice');
  });

  it('returns forbidden when arg userId does not match caller', () => {
    const out = pickInstanceForRoute({
      urlArg: 'usr_bob',
      callerUserId: 'usr_alice',
      peek: vi.fn(),
      peekActiveForUser: vi.fn(),
    });

    expect(out.kind).toBe('forbidden');
  });

  it('returns no-active when caller has no ready instance', () => {
    const peekActiveForUser = vi.fn().mockReturnValue(null);

    const out = pickInstanceForRoute({
      urlArg: 'usr_alice',
      callerUserId: 'usr_alice',
      peek: vi.fn(),
      peekActiveForUser,
    });

    expect(out.kind).toBe('no-active');
  });

  it('arg without recognised prefix is treated as userId (legacy strings still work)', () => {
    const inst = fakeInstance({ userId: 'demo' });
    const peekActiveForUser = vi.fn().mockReturnValue(inst);

    const out = pickInstanceForRoute({
      urlArg: 'demo',
      callerUserId: 'demo',
      peek: vi.fn(),
      peekActiveForUser,
    });

    expect(out.kind).toBe('instance');
  });
});

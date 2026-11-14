/**
 * BROWSER-HOME-1 step 4 — a user's cloud browser (`bhs_<userId>`) lent to one of their tasks and
 * given back when the task ends. Same stubbed-spawn pool as browser-pool.test.ts: keying, owner
 * checks, retention and the idle GC run for real.
 */

import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { AWAITING_REPLY, BrowserPool } from './browser-pool.js';
import type { BrowserInstance, BrowserSessionTarget, PoolConfig } from './types.js';

const HOME_IDLE_MS = 15 * 60_000;

function makePool(): { pool: BrowserPool; spawnSpy: ReturnType<typeof vi.fn> } {
  const cfg: PoolConfig = {
    maxInstances: 4,
    idleTimeoutMs: 300_000,
    baseDir: '/tmp/holaday-test',
    cdpPortStart: 9300,
    vncPortStart: 5910,
    wsPortStart: 6090,
    displayStart: 100,
    screenSize: '1280x800x24',
  };
  const pool = new BrowserPool(cfg, pino({ level: 'silent' }));
  const spawnSpy = vi.fn(
    async (taskId: string, userId: string, _profile?: unknown, session?: BrowserSessionTarget) => {
      const allocator = (pool as unknown as { allocator: { claim: () => unknown } }).allocator;
      const slot = allocator.claim() as {
        index: number;
        display: number;
        cdpPort: number;
        vncPort: number;
        wsPort: number;
      };
      const inst: BrowserInstance = {
        ...slot,
        taskId,
        userId,
        ...(session?.sessionPolicy ? { sessionPolicy: session.sessionPolicy } : {}),
        userDataDir: `/tmp/test-task-${taskId}`,
        executor: {
          disconnect: vi.fn().mockResolvedValue(undefined),
        } as unknown as BrowserInstance['executor'],
        xvfbPid: 1000 + slot.index,
        bravePid: 2000 + slot.index,
        x11vncPid: 3000 + slot.index,
        websockifyPid: 4000 + slot.index,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        status: 'ready',
      };
      (pool as unknown as { instances: Map<string, BrowserInstance> }).instances.set(taskId, inst);
      return inst;
    },
  );
  (pool as unknown as { spawnInstance: typeof spawnSpy }).spawnInstance = spawnSpy;
  (pool as unknown as { tearDownInstance: () => Promise<void> }).tearDownInstance = async () =>
    undefined;
  return { pool, spawnSpy };
}

async function openHome(pool: BrowserPool, userId: string): Promise<BrowserInstance> {
  const inst = await pool.allocate(`bhs_${userId}`, userId, undefined, {
    sessionPolicy: 'anonymous',
  });
  pool.setIdleTimeout(`bhs_${userId}`, HOME_IDLE_MS);
  return inst;
}

const gc = (pool: BrowserPool) =>
  (pool as unknown as { runGcSweep: () => Promise<void> }).runGcSweep();

describe('BrowserPool — cloud browser lent to a task (BROWSER-HOME-1)', () => {
  it('moves the same live browser to the task without spawning, and back again', async () => {
    const { pool, spawnSpy } = makePool();
    const home = await openHome(pool, 'usr_A');

    const lent = pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    expect(lent).toBe(home);
    expect(home.taskId).toBe('tsk_1');
    expect(pool.peek('bhs_usr_A')).toBeNull();
    expect(pool.peek('tsk_1')).toBe(home);
    expect(pool.browserHomeHolder('usr_A')).toBe('tsk_1');
    expect(pool.peekBrowserHome('usr_A')).toBe(home);
    // The task runs on the pool's idle default, not the session's 15 minutes.
    expect(home.idleTimeoutMs).toBeUndefined();

    const back = pool.returnBrowserHome('tsk_1', 'usr_A');
    expect(back).toBe(home);
    expect(home.taskId).toBe('bhs_usr_A');
    expect(pool.peek('tsk_1')).toBeNull();
    expect(pool.peek('bhs_usr_A')).toBe(home);
    expect(home.idleTimeoutMs).toBe(HOME_IDLE_MS);
    expect(pool.browserHomeHolder('usr_A')).toBeNull();
    expect(pool.peekBrowserHome('usr_A')).toBe(home);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('one task at a time: a second task cannot take a browser that is already lent', async () => {
    const { pool } = makePool();
    await openHome(pool, 'usr_A');
    expect(pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous')).not.toBeNull();
    expect(pool.lendBrowserHome('usr_A', 'tsk_2', 'anonymous')).toBeNull();
    expect(pool.peek('tsk_2')).toBeNull();
    expect(pool.browserHomeHolder('usr_A')).toBe('tsk_1');
  });

  it("another user's task can never take the browser (the source id comes from the user)", async () => {
    const { pool } = makePool();
    const home = await openHome(pool, 'usr_A');
    expect(pool.lendBrowserHome('usr_B', 'tsk_b', 'anonymous')).toBeNull();
    expect(pool.peek('bhs_usr_A')).toBe(home);
    expect(pool.peekBrowserHome('usr_B')).toBeNull();

    // Even a home key whose instance belongs to someone else is refused.
    home.userId = 'usr_B';
    expect(pool.lendBrowserHome('usr_A', 'tsk_a', 'anonymous')).toBeNull();
    home.userId = 'usr_A';

    expect(pool.lendBrowserHome('usr_A', 'tsk_a', 'anonymous')).toBe(home);
    // Only the owner gives it back.
    expect(pool.returnBrowserHome('tsk_a', 'usr_B')).toBeNull();
    expect(pool.peek('tsk_a')).toBe(home);
    expect(pool.peekBrowserHome('usr_B')).toBeNull();
    expect(pool.returnBrowserHome('tsk_a', 'usr_A')).toBe(home);
  });

  it('refuses a mismatched session policy, a bhs_ destination or a taken destination', async () => {
    const { pool } = makePool();
    const home = await openHome(pool, 'usr_A');
    expect(pool.lendBrowserHome('usr_A', 'tsk_1', 'vault_allowed')).toBeNull();
    expect(pool.lendBrowserHome('usr_A', 'bhs_usr_A', 'anonymous')).toBeNull();
    expect(pool.lendBrowserHome('usr_A', 'bhs_other', 'anonymous')).toBeNull();
    const other = await pool.allocate('tsk_busy', 'usr_A');
    expect(pool.lendBrowserHome('usr_A', 'tsk_busy', 'anonymous')).toBeNull();
    expect(pool.peek('tsk_busy')).toBe(other);
    expect(pool.peek('bhs_usr_A')).toBe(home);
  });

  it('nothing to lend when the user has no open cloud browser', async () => {
    const { pool } = makePool();
    expect(pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous')).toBeNull();
    expect(pool.browserHomeHolder('usr_A')).toBeNull();
    expect(pool.peekBrowserHome('usr_A')).toBeNull();
  });

  it('the return ends any hold the task left (awaiting-reply) and restores the 15-minute idle', async () => {
    const { pool } = makePool();
    const home = await openHome(pool, 'usr_A');
    pool.lendBrowserHome('usr_A', 'tsk_wait', 'anonymous');
    expect(pool.retain('tsk_wait', 30 * 60_000, AWAITING_REPLY)).toBe(true);
    expect(pool.returnBrowserHome('tsk_wait', 'usr_A')).toBe(home);
    expect(home.retainedUntil).toBeUndefined();
    expect(home.retentionReason).toBeUndefined();

    // 10 minutes idle: inside the session's 15, past the pool's 5.
    home.lastActiveAt = Date.now() - 10 * 60_000;
    await gc(pool);
    expect(pool.peek('bhs_usr_A')).toBe(home);
    home.lastActiveAt = Date.now() - 16 * 60_000;
    await gc(pool);
    expect(pool.peek('bhs_usr_A')).toBeNull();
  });

  it('a second return, or a return of a task that never held it, gives back nothing', async () => {
    const { pool } = makePool();
    await openHome(pool, 'usr_A');
    pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    expect(pool.returnBrowserHome('tsk_1', 'usr_A')).not.toBeNull();
    expect(pool.returnBrowserHome('tsk_1', 'usr_A')).toBeNull();
    expect(pool.returnBrowserHome('tsk_never', 'usr_A')).toBeNull();
    expect(pool.peek('bhs_usr_A')).not.toBeNull();
  });

  it('closed while lent: the loan ends, the task keeps it until its normal release', async () => {
    const { pool } = makePool();
    const home = await openHome(pool, 'usr_A');
    pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    expect(pool.endBrowserHomeLoan('usr_A')).toBe('tsk_1');
    expect(pool.browserHomeHolder('usr_A')).toBeNull();
    expect(pool.peekBrowserHome('usr_A')).toBeNull();
    expect(pool.peek('tsk_1')).toBe(home);
    expect(pool.returnBrowserHome('tsk_1', 'usr_A')).toBeNull();
    expect(await pool.release('tsk_1', 'task-done')).toBe(true);
    expect(pool.peek('tsk_1')).toBeNull();
    expect(pool.peek('bhs_usr_A')).toBeNull();
  });

  it('a browser stopped while lent is not given back, and the loan clears', async () => {
    const { pool } = makePool();
    await openHome(pool, 'usr_A');
    pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    await pool.release('tsk_1', 'browser-died');
    expect(pool.browserHomeHolder('usr_A')).toBeNull();
    expect(pool.returnBrowserHome('tsk_1', 'usr_A')).toBeNull();
    expect(pool.peek('bhs_usr_A')).toBeNull();
    // A fresh session can be opened and lent again.
    const again = await openHome(pool, 'usr_A');
    expect(pool.lendBrowserHome('usr_A', 'tsk_2', 'anonymous')).toBe(again);
  });

  it('never gives back over a session opened again in the meantime', async () => {
    const { pool } = makePool();
    const first = await openHome(pool, 'usr_A');
    pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    pool.endBrowserHomeLoan('usr_A');
    const second = await openHome(pool, 'usr_A');
    expect(pool.returnBrowserHome('tsk_1', 'usr_A')).toBeNull();
    expect(pool.peek('bhs_usr_A')).toBe(second);
    expect(pool.peek('tsk_1')).toBe(first);
  });

  it('peekActiveForUser never returns the session, but does return it while a task holds it', async () => {
    const { pool } = makePool();
    const home = await openHome(pool, 'usr_A');
    expect(pool.peekActiveForUser('usr_A')).toBeNull();
    pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    // Lent, it is that task's browser (the task's own panel routes reach it).
    expect(pool.peekActiveForUser('usr_A')).toBe(home);
  });

  it('return is atomic: a failed broker check leaves the browser whole under the task (P2-7)', async () => {
    const { pool } = makePool();
    const home = await openHome(pool, 'usr_A');
    const valid = vi.spyOn(
      pool as unknown as { loanBrokerValid: (inst: BrowserInstance) => boolean },
      'loanBrokerValid',
    );

    // Fails before the move: nothing changes, the task's hold stays.
    pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    expect(pool.retain('tsk_1', 30 * 60_000, AWAITING_REPLY)).toBe(true);
    const held = home.retainedUntil;
    valid.mockReturnValueOnce(false);
    expect(pool.returnBrowserHome('tsk_1', 'usr_A')).toBeNull();
    expect(pool.peek('tsk_1')).toBe(home);
    expect(home.taskId).toBe('tsk_1');
    expect(pool.peek('bhs_usr_A')).toBeNull();
    expect(home.retainedUntil).toBe(held);
    expect(home.retentionReason).toBe(AWAITING_REPLY);
    expect(home.idleTimeoutMs).toBeUndefined();
    await pool.release('tsk_1', 'task-done');

    // Fails after the move: the key goes back, the hold is restored.
    const again = await openHome(pool, 'usr_A');
    pool.lendBrowserHome('usr_A', 'tsk_2', 'anonymous');
    expect(pool.retain('tsk_2', 30 * 60_000, AWAITING_REPLY)).toBe(true);
    const held2 = again.retainedUntil;
    valid.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(pool.returnBrowserHome('tsk_2', 'usr_A')).toBeNull();
    expect(pool.peek('tsk_2')).toBe(again);
    expect(again.taskId).toBe('tsk_2');
    expect(pool.peek('bhs_usr_A')).toBeNull();
    expect(again.retainedUntil).toBe(held2);
    expect(again.retentionReason).toBe(AWAITING_REPLY);
    // The caller then finishes it the normal way, under the task id.
    expect(await pool.release('tsk_2', 'task-done')).toBe(true);
    expect(pool.peek('tsk_2')).toBeNull();
  });

  it('a forfeited loan (watchdog) is never given back (P1-1)', async () => {
    const { pool } = makePool();
    const home = await openHome(pool, 'usr_A');
    pool.lendBrowserHome('usr_A', 'tsk_1', 'anonymous');
    expect(pool.forfeitBrowserHomeLoan('tsk_1')).toBe(true);
    expect(pool.browserHomeHolder('usr_A')).toBeNull();
    expect(pool.returnBrowserHome('tsk_1', 'usr_A')).toBeNull();
    expect(pool.peek('tsk_1')).toBe(home);
    expect(pool.peek('bhs_usr_A')).toBeNull();
  });
});

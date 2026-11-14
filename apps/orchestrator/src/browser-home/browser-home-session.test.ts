/**
 * BROWSER-HOME-1 — the task-less cloud browser (`bhs_<userId>`) on a real BrowserPool whose
 * process spawn / teardown are stubbed (as in browser-pool.test.ts): keying, reuse, one per user,
 * release, the 15-minute idle GC and the remembered last address run for real.
 */
import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { BrowserPool, PoolCapacityError } from '../browser-pool/browser-pool.js';
import type { BrowserInstance, BrowserSessionTarget, PoolConfig } from '../browser-pool/types.js';
import {
  BROWSER_HOME_IDLE_TIMEOUT_MS,
  BrowserHomeSessions,
  browserHomeSessionId,
} from './browser-home-session.js';

const logger = pino({ level: 'silent' });

function fakeExecutor() {
  const state = { url: 'about:blank' };
  const navigated: Array<(frame: unknown) => void> = [];
  const mainFrame = { url: () => state.url };
  const page = {
    url: () => state.url,
    mainFrame: () => mainFrame,
    on: (_event: string, listener: (frame: unknown) => void) => navigated.push(listener),
    context: () => ({ pages: () => [page], on: () => {} }),
  };
  const executor = {
    getPage: async () => page,
    navigate: vi.fn(async (_page: unknown, url: string) => {
      state.url = url;
      return { ok: true };
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  /** The person clicked a link inside the page. */
  const clickTo = (url: string) => {
    state.url = url;
    for (const listener of navigated) listener(mainFrame);
  };
  return { executor, state, clickTo };
}

function makePool(maxInstances = 10) {
  const cfg: PoolConfig = {
    maxInstances,
    idleTimeoutMs: 300_000,
    baseDir: '/tmp/holaday-test',
    cdpPortStart: 9300,
    vncPortStart: 5910,
    wsPortStart: 6090,
    displayStart: 100,
    screenSize: '1280x800x24',
  };
  const pool = new BrowserPool(cfg, logger);
  const executors = new Map<string, ReturnType<typeof fakeExecutor>>();
  const spawnSpy = vi.fn(
    async (taskId: string, userId: string, _profile?: unknown, session?: BrowserSessionTarget) => {
      const allocator = (
        pool as unknown as { allocator: { claim: () => unknown; isFull: () => boolean } }
      ).allocator;
      if (allocator.isFull()) throw new PoolCapacityError(maxInstances);
      const slot = allocator.claim() as {
        index: number;
        display: number;
        cdpPort: number;
        vncPort: number;
        wsPort: number;
      };
      const fake = fakeExecutor();
      executors.set(taskId, fake);
      const inst: BrowserInstance = {
        ...slot,
        taskId,
        userId,
        sessionPolicy: session?.sessionPolicy,
        userDataDir: `/tmp/test-task-${taskId}`,
        executor: fake.executor as unknown as BrowserInstance['executor'],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        status: 'ready',
      };
      (pool as unknown as { instances: Map<string, BrowserInstance> }).instances.set(taskId, inst);
      return inst;
    },
  );
  (pool as unknown as { spawnInstance: typeof spawnSpy }).spawnInstance = spawnSpy;
  (pool as unknown as { tearDownInstance: () => Promise<void> }).tearDownInstance = async () => {};
  const gc = () => (pool as unknown as { runGcSweep: () => Promise<void> }).runGcSweep();
  return { pool, spawnSpy, executors, gc };
}

describe('BrowserHomeSessions — BROWSER-HOME-1 per-user cloud browser', () => {
  let sessions: BrowserHomeSessions;
  let env: ReturnType<typeof makePool>;

  beforeEach(() => {
    sessions = new BrowserHomeSessions();
    env = makePool();
  });

  it('creates bhs_<userId> with no task, an anonymous session and a 15-minute idle timeout', async () => {
    const opened = await sessions.open(env.pool, 'usr_a', logger);
    expect(opened).toEqual({ sessionId: 'bhs_usr_a', url: null });
    expect(browserHomeSessionId('usr_a')).toBe('bhs_usr_a');
    expect(env.spawnSpy).toHaveBeenCalledTimes(1);
    expect(env.spawnSpy.mock.calls[0]?.[0]).toBe('bhs_usr_a');
    expect(env.spawnSpy.mock.calls[0]?.[1]).toBe('usr_a');
    const inst = env.pool.peek('bhs_usr_a');
    expect(inst?.sessionPolicy).toBe('anonymous');
    expect(inst?.idleTimeoutMs).toBe(BROWSER_HOME_IDLE_TIMEOUT_MS);
    expect(BROWSER_HOME_IDLE_TIMEOUT_MS).toBe(15 * 60_000);
    // The person can drive it directly: an open review control exists.
    expect(browserControlSessions.openForViewer(inst!)).not.toBeNull();
  });

  it('reuses the open browser (and its page) instead of spawning another', async () => {
    await sessions.open(env.pool, 'usr_a', logger);
    env.executors.get('bhs_usr_a')!.clickTo('https://1.1.1.1/page');
    const again = await sessions.open(env.pool, 'usr_a', logger);
    expect(again).toEqual({ sessionId: 'bhs_usr_a', url: 'https://1.1.1.1/page' });
    expect(env.spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('at most one per user, even for concurrent opens; users are separate', async () => {
    const [one, two] = await Promise.all([
      sessions.open(env.pool, 'usr_a', logger),
      sessions.open(env.pool, 'usr_a', logger),
    ]);
    expect(one.sessionId).toBe(two.sessionId);
    await sessions.open(env.pool, 'usr_b', logger);
    expect(env.spawnSpy).toHaveBeenCalledTimes(2);
    expect(
      env.pool
        .stats()
        .byUser.map((entry) => entry.taskId)
        .sort(),
    ).toEqual(['bhs_usr_a', 'bhs_usr_b']);
  });

  it('close releases it; closing nothing is false', async () => {
    expect(await sessions.close(env.pool, 'usr_a')).toBe(false);
    await sessions.open(env.pool, 'usr_a', logger);
    expect(await sessions.close(env.pool, 'usr_a')).toBe(true);
    expect(env.pool.peek('bhs_usr_a')).toBeNull();
  });

  it('a reopened session goes back to the last address (URL only)', async () => {
    await sessions.open(env.pool, 'usr_a', logger);
    env.executors.get('bhs_usr_a')!.clickTo('https://1.1.1.1/last');
    await sessions.close(env.pool, 'usr_a');
    expect(sessions.lastUrl('usr_a')).toBe('https://1.1.1.1/last');
    const reopened = await sessions.open(env.pool, 'usr_a', logger);
    expect(reopened.url).toBe('https://1.1.1.1/last');
    expect(env.executors.get('bhs_usr_a')!.executor.navigate).toHaveBeenCalledWith(
      expect.anything(),
      'https://1.1.1.1/last',
    );
  });

  it('never remembers a blank, local or private page', () => {
    sessions.rememberUrl('usr_a', 'about:blank');
    sessions.rememberUrl('usr_a', 'file:///etc/passwd');
    sessions.rememberUrl('usr_a', 'http://10.0.0.1/admin');
    sessions.rememberUrl('usr_a', 'http://localhost:3000/');
    expect(sessions.lastUrl('usr_a')).toBeNull();
  });

  it('idles out after 15 minutes, not the pool-wide 5 — task browsers keep the global timeout', async () => {
    await sessions.open(env.pool, 'usr_a', logger);
    await env.pool.allocate('tsk_task', 'usr_a');
    env.executors.get('bhs_usr_a')!.clickTo('https://1.1.1.1/where-i-was');
    const home = env.pool.peek('bhs_usr_a')!;
    const task = env.pool.peek('tsk_task')!;

    home.lastActiveAt = Date.now() - 10 * 60_000;
    task.lastActiveAt = Date.now() - 10 * 60_000;
    await env.gc();
    expect(env.pool.peek('bhs_usr_a')).not.toBeNull();
    expect(env.pool.peek('tsk_task')).toBeNull();

    // A connected viewer's touch keeps it alive.
    env.pool.touch('bhs_usr_a');
    await env.gc();
    expect(env.pool.peek('bhs_usr_a')).not.toBeNull();

    home.lastActiveAt = Date.now() - 16 * 60_000;
    await env.gc();
    expect(env.pool.peek('bhs_usr_a')).toBeNull();

    // Released by the GC (no close call): the next open still restores the last address.
    const reopened = await sessions.open(env.pool, 'usr_a', logger);
    expect(reopened.url).toBe('https://1.1.1.1/where-i-was');
    // A fresh allocation under the same id gets the 15 minutes again.
    expect(env.pool.peek('bhs_usr_a')?.idleTimeoutMs).toBe(BROWSER_HOME_IDLE_TIMEOUT_MS);
  });

  it('task routes that look up "the user’s active browser" never land on the home browser', async () => {
    await sessions.open(env.pool, 'usr_a', logger);
    expect(env.pool.peekActiveForUser('usr_a')).toBeNull();
    await env.pool.allocate('tsk_task', 'usr_a');
    expect(env.pool.peekActiveForUser('usr_a')?.taskId).toBe('tsk_task');
  });

  it('capacity errors surface to the caller (no half-open session)', async () => {
    env = makePool(1);
    await env.pool.allocate('tsk_busy', 'usr_b');
    await expect(sessions.open(env.pool, 'usr_a', logger)).rejects.toBeInstanceOf(
      PoolCapacityError,
    );
    expect(env.pool.peek('bhs_usr_a')).toBeNull();
  });
});

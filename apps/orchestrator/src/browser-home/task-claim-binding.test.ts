import { describe, expect, it } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { BrowserHomeSessions } from './browser-home-session.js';
import {
  assertBrowserHomeTaskAllowed,
  claimBrowserHomeTaskOrThrow,
  lendBrowserHomeToTask,
} from './browser-home-task.js';

function fixture() {
  const sessions = new BrowserHomeSessions();
  const fresh = () =>
    ({ userId: 'alice', taskId: 'bhs_alice', status: 'ready', executor: {} }) as BrowserInstance;
  let current: BrowserInstance | null = fresh();
  const pool = {
    peek: (id: string) => (current?.taskId === id ? current : null),
    browserHomeHolder: () => (current && current.taskId !== 'bhs_alice' ? current.taskId : null),
    peekBrowserHome: () => current,
    lendBrowserHome: (_owner: string, taskId: string) => {
      if (!current || current.taskId !== 'bhs_alice') return null;
      current.taskId = taskId;
      return current;
    },
  };
  const claim = () =>
    claimBrowserHomeTaskOrThrow({ pool: pool as never, userId: 'alice', sessions });
  const lend = (c: ReturnType<typeof claim> | null) =>
    lendBrowserHomeToTask({
      pool: pool as never,
      userId: 'alice',
      taskId: 'tsk_old',
      sessions,
      claim: c,
      settleMs: 200,
    });
  return {
    sessions,
    pool,
    claim,
    lend,
    home: () => current!,
    replace: () => {
      current = fresh();
      return current;
    },
  };
}

describe('Home task claims keep their original browser', () => {
  it('refuses a replacement opened after task admission', async () => {
    const f = fixture();
    const claim = f.claim();
    const replacement = f.replace();
    await expect(f.lend(claim)).rejects.toThrow('云浏览器已关闭或正被另一个任务使用');
    expect(replacement.taskId).toBe('bhs_alice');
    const next = f.claim();
    expect(await f.lend(next)).toBe(replacement);
  });

  it('rechecks identity after waiting for the original human input to settle', async () => {
    const f = fixture();
    const home = f.home();
    const claim = f.claim();
    const control = browserControlSessions.review(home).control;
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const input = control.runHuman(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          entered();
        }),
      'navigate',
    );
    await started;
    const lent = f.lend(claim);
    const refusal = expect(lent).rejects.toThrow('云浏览器已关闭或正被另一个任务使用');
    const replacement = f.replace();
    finish();
    await input;
    await refusal;
    expect(replacement.taskId).toBe('bhs_alice');
    control.close();
  });

  it('a superseded claim cannot lend or erase a newer claim on the same browser', async () => {
    const f = fixture();
    const old = f.claim();
    const newer = f.sessions.claimTask(f.pool as never, 'alice', Date.now() + 121_000);
    expect(newer.kind).toBe('claimed');
    await expect(f.lend(old)).rejects.toThrow('云浏览器已关闭或正被另一个任务使用');
    expect(f.home().taskId).toBe('bhs_alice');
    if (newer.kind !== 'claimed') throw new Error('new claim missing');
    expect(await f.lend(newer.claim)).toBe(f.home());
  });

  it('cannot lend a browser without an admitted claim', async () => {
    const f = fixture();
    await expect(f.lend(null)).rejects.toThrow('云浏览器已关闭或正被另一个任务使用');
    expect(f.home().taskId).toBe('bhs_alice');
  });

  it.each(['cloud-public', 'local-chrome'])(
    'refuses contradictory %s routing before any browser loan',
    (browserPreference) => {
      const f = fixture();
      expect(() =>
        assertBrowserHomeTaskAllowed({
          userId: 'alice',
          input: { browserHomeSession: true, browserPreference },
          pool: f.pool as never,
          sessions: f.sessions,
          allowed: () => true,
        }),
      ).toThrow('不能同时追问、重试、使用本地 Chrome 或转到公开云端');
      expect(f.home().taskId).toBe('bhs_alice');
    },
  );
});

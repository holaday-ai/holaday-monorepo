import { describe, expect, it } from 'vitest';
import {
  type BrowseAction,
  type BrowseRunResult,
  browseIntent,
  explorerOnBeforeAction,
  makeBrowseExploreSite,
} from './explorer-browse.js';

describe('explorerOnBeforeAction — live-veto decision', () => {
  it('vetoes sensitive labels + urls, allows benign', () => {
    expect(explorerOnBeforeAction({ kind: 'click', label: '登录' }).allowed).toBe(false);
    expect(explorerOnBeforeAction({ kind: 'click', label: '提交订单' }).allowed).toBe(false);
    expect(explorerOnBeforeAction({ kind: 'navigate', url: 'https://x.com/pay' }).allowed).toBe(
      false,
    );
    expect(
      explorerOnBeforeAction({ kind: 'navigate', url: 'https://x.com/checkout' }).allowed,
    ).toBe(false);
    expect(explorerOnBeforeAction({ kind: 'click', label: 'Read the docs' }).allowed).toBe(true);
    expect(explorerOnBeforeAction({ kind: 'navigate', url: 'https://x.com/docs' }).allowed).toBe(
      true,
    );
    // type carries no label → allowed (search box); the protective veto is click/nav/submit
    expect(explorerOnBeforeAction({ kind: 'type' }).allowed).toBe(true);
  });
});

describe('browseIntent', () => {
  it('is a read-only constrained intent (soft guard)', () => {
    const i = browseIntent('figma.com');
    expect(i).toContain('figma.com');
    expect(i).toContain('绝不');
    expect(i).toMatch(/登录|支付|提交/);
  });
});

// A fake that mimics the agent-loop's veto contract: propose each action, call
// onBeforeAction, EXECUTE (record) only if allowed; on a veto STOP and return failed
// (the action is never executed) — exactly what runSupercarTask does with the hook.
function fakeLoop(actions: BrowseAction[], executed: BrowseAction[], costUsd = 0.42) {
  return async ({
    onBeforeAction,
  }: {
    onBeforeAction: (a: BrowseAction) => { allowed: boolean; reason?: string };
  }): Promise<BrowseRunResult> => {
    for (const a of actions) {
      const v = onBeforeAction(a);
      if (!v.allowed) return { status: 'failed', costUsd, reason: v.reason }; // cost-source A
      executed.push(a); // only reached when allowed
    }
    return { status: 'completed', costUsd };
  };
}

describe('makeBrowseExploreSite — live-veto really refuses + halts', () => {
  it('a sensitive action halts the site (halted_sensitive) and is NEVER executed', async () => {
    const executed: BrowseAction[] = [];
    const out = await makeBrowseExploreSite({
      runBrowseTask: fakeLoop(
        [
          { kind: 'navigate', url: 'https://x.com/' },
          { kind: 'click', label: 'Read docs' },
          { kind: 'click', label: '登录' }, // sensitive → veto here
          { kind: 'click', label: 'Pricing' }, // never reached
        ],
        executed,
      ),
    })('x.com');

    expect(out.status).toBe('halted_sensitive');
    expect(out.costUsd).toBe(0.42); // cost-source A: the run's in-memory cost, not a DB read
    expect(out.note).toMatch(/live-veto/);
    // the sensitive action + everything after it was NOT executed
    expect(executed.map((a) => a.label ?? a.url)).toEqual(['https://x.com/', 'Read docs']);
    expect(executed.some((a) => a.label === '登录')).toBe(false);
  });

  it('navigation to a sensitive url is vetoed (covers the page.goto path)', async () => {
    const executed: BrowseAction[] = [];
    const out = await makeBrowseExploreSite({
      runBrowseTask: fakeLoop([{ kind: 'navigate', url: 'https://x.com/checkout' }], executed, 0),
    })('x.com');
    expect(out.status).toBe('halted_sensitive');
    expect(executed).toEqual([]); // the navigation was refused before executing
  });

  it('a fully-benign browse completes', async () => {
    const executed: BrowseAction[] = [];
    const out = await makeBrowseExploreSite({
      runBrowseTask: fakeLoop(
        [
          { kind: 'navigate', url: 'https://x.com/' },
          { kind: 'click', label: 'Docs' },
          { kind: 'type' },
        ],
        executed,
        0.1,
      ),
    })('x.com');
    expect(out.status).toBe('completed');
    expect(out.costUsd).toBe(0.1);
    expect(executed).toHaveLength(3);
  });

  it('a non-veto task failure maps to failed (not halted_sensitive)', async () => {
    const out = await makeBrowseExploreSite({
      runBrowseTask: async () => ({ status: 'failed', costUsd: 0.05, reason: 'timeout' }),
    })('x.com');
    expect(out.status).toBe('failed');
    expect(out.note).toMatch(/timeout/);
  });

  it('runBrowseTask throwing does not crash — returns failed', async () => {
    const out = await makeBrowseExploreSite({
      runBrowseTask: async () => {
        throw new Error('boom');
      },
    })('x.com');
    expect(out.status).toBe('failed');
    expect(out.note).toMatch(/boom/);
  });
});

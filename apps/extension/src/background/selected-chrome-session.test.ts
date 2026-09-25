import type { DriverAction, DriverResult } from '@holaday/browser-driver';
import { describe, expect, it, vi } from 'vitest';
import { SelectedChromeSession } from './selected-chrome-session.js';

function harness() {
  let owner: string | null = 'account-a';
  let current = true;
  const actions: DriverAction[] = [];
  const observation = {
    tabId: 42,
    origin: 'https://work.example',
    title: 'Projects',
    bodyText: 'Saved',
    ariaSnapshot: '- button "Save"',
    truncated: false,
  };
  const driver = {
    attachExistingTab: vi.fn(
      async (): Promise<DriverResult> => ({ status: 'ok', data: { tabId: 42 } }),
    ),
    observeCurrentPage: vi.fn(
      async (): Promise<DriverResult> => ({ status: 'ok', data: observation }),
    ),
    execute: vi.fn(async (action: DriverAction): Promise<DriverResult> => {
      actions.push(action);
      return { status: 'ok' };
    }),
    dispose: vi.fn(async () => {}),
  };
  const makeDriver = vi.fn(() => driver);
  const session = new SelectedChromeSession({ makeDriver, owner: () => owner });
  const open = () =>
    session.open({
      taskId: 'task-a',
      tabId: 42,
      validate: async () => {
        if (!current) throw new Error('target_changed');
      },
    });
  return {
    session,
    driver,
    makeDriver,
    actions,
    observation,
    open,
    changeOwner: () => {
      owner = 'account-b';
    },
    signOut: () => {
      owner = null;
    },
    invalidate: () => {
      current = false;
    },
  };
}

describe('selected Chrome execution session', () => {
  it('keeps a failed detach seat closed to actions but allows cleanup retry', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    h.driver.dispose.mockRejectedValueOnce(new Error('detach interrupted'));
    await expect(h.session.stopTask('task-a')).rejects.toThrow('detach interrupted');
    expect(await h.open()).toMatchObject({ ok: false, error: 'browser_busy' });
    expect(await h.session.execute('task-a', opened.sessionId, { kind: 'key' })).toMatchObject({
      ok: false,
    });
    await h.session.stopTask('task-a');
    expect(h.driver.dispose).toHaveBeenCalledTimes(2);
    expect(await h.open()).toMatchObject({ ok: true });
  });
  it('rejects a native attach receipt for a different tab', async () => {
    const h = harness();
    h.driver.attachExistingTab.mockResolvedValue({ status: 'ok', data: { tabId: 99 } });
    expect(await h.open()).toMatchObject({ ok: false, error: 'target_changed' });
    expect(h.driver.observeCurrentPage).not.toHaveBeenCalled();
    expect(h.driver.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects an observation for a different tab', async () => {
    const h = harness();
    h.driver.observeCurrentPage.mockResolvedValue({
      status: 'ok',
      data: { ...h.observation, tabId: 99 },
    });
    expect(await h.open()).toMatchObject({ ok: false, error: 'target_changed' });
    expect(h.driver.execute).not.toHaveBeenCalled();
  });

  it('does not quarantine a read-only wait timeout or exception', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    h.driver.execute.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'WAIT_TIMEOUT', message: 'not visible' },
    });
    expect(await h.session.execute('task-a', opened.sessionId, { kind: 'wait' })).toMatchObject({
      ok: false,
      actionOutcome: 'not_applied',
    });
    h.driver.execute.mockRejectedValueOnce(new Error('wait interrupted'));
    expect(await h.session.execute('task-a', opened.sessionId, { kind: 'wait' })).toMatchObject({
      ok: false,
      actionOutcome: 'not_applied',
    });
    expect(await h.session.observe('task-a', opened.sessionId)).toMatchObject({ ok: true });
  });

  it('rejects a non-web navigation before invoking the native driver', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    for (const url of [
      'javascript:alert(1)',
      'file:///private/data',
      'chrome://settings',
      'https://name:secret@example.com',
    ]) {
      expect(
        await h.session.execute('task-a', opened.sessionId, { kind: 'goto', payload: { url } }),
      ).toMatchObject({ ok: false, error: 'invalid_url', actionOutcome: 'not_applied' });
    }
    expect(h.driver.execute).not.toHaveBeenCalled();
  });

  it('requires the pinned owner and session for externally requested close', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    expect(await h.session.close('task-a', 'wrong-session')).toEqual({ ok: false });
    h.changeOwner();
    expect(await h.session.close('task-a', opened.sessionId)).toEqual({ ok: false });
    expect(h.driver.dispose).not.toHaveBeenCalled();
    await h.session.stopTask('task-a'); // Trusted cancellation still works after account switch.
    expect(h.driver.dispose).toHaveBeenCalledTimes(1);
  });
  it('does not attach an unauthenticated execution seat', async () => {
    const h = harness();
    h.signOut();
    expect(await h.open()).toMatchObject({ ok: false, error: 'session_unavailable' });
    expect(h.makeDriver).not.toHaveBeenCalled();
  });
  it('attaches only the explicitly selected tab and returns a structured observation', async () => {
    const h = harness();
    const opened = await h.open();
    expect(opened).toMatchObject({ ok: true, observation: h.observation });
    expect(h.makeDriver).toHaveBeenCalledWith(42);
    expect(h.actions).toEqual([]);
  });

  it('rejects invalid selection before attaching a driver', async () => {
    const h = harness();
    h.invalidate();
    expect(await h.open()).toMatchObject({ ok: false, error: 'target_changed' });
    expect(h.makeDriver).not.toHaveBeenCalled();
  });

  it('refuses a second local session instead of sharing one CRX application concurrently', async () => {
    const h = harness();
    await h.open();
    expect(await h.open()).toMatchObject({ ok: false, error: 'browser_busy' });
    expect(h.makeDriver).toHaveBeenCalledTimes(1);
  });

  it('uses the native selector action and observes the resulting page', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    const action: DriverAction = {
      kind: 'click',
      selector: {
        description: 'Save',
        scope: { timeoutMs: 5000 },
        selfHeal: false,
        strategies: [{ kind: 'role', role: 'button', name: 'Save' }],
      },
    };
    expect(await h.session.execute('task-a', opened.sessionId, action)).toMatchObject({
      ok: true,
      actionOutcome: 'applied',
      observation: h.observation,
    });
    expect(h.actions).toEqual([action]);
    expect(h.driver.observeCurrentPage).toHaveBeenCalledTimes(2);
  });

  it('will not operate for a different task or account', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    expect(
      await h.session.execute('task-b', opened.sessionId, {
        kind: 'key',
        payload: { key: 'Enter' },
      }),
    ).toMatchObject({ ok: false, error: 'session_unavailable' });
    h.changeOwner();
    expect(
      await h.session.execute('task-a', opened.sessionId, {
        kind: 'key',
        payload: { key: 'Enter' },
      }),
    ).toMatchObject({ ok: false, error: 'session_unavailable' });
    expect(h.actions).toEqual([]);
  });

  it('denies arbitrary evaluation through the new session entry', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    expect(
      await h.session.execute('task-a', opened.sessionId, {
        kind: 'eval',
        payload: { expression: 'location.href' },
      }),
    ).toMatchObject({ ok: false, error: 'unsupported_action' });
    expect(h.actions).toEqual([]);
  });

  it('retains an in-flight operation when stop is requested and admits no next action', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    let finish!: (value: DriverResult) => void;
    h.driver.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const action = h.session.execute('task-a', opened.sessionId, {
      kind: 'key',
      payload: { key: 'Enter' },
    });
    await Promise.resolve(); // The native input has actually begun.
    const stopped = h.session.stopTask('task-a');
    expect(await h.session.execute('task-a', opened.sessionId, { kind: 'key' })).toMatchObject({
      ok: false,
    });
    expect(h.driver.dispose).not.toHaveBeenCalled();
    finish({ status: 'ok' });
    await action;
    await stopped;
    expect(h.driver.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not replay an input after an uncertain driver failure', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    h.driver.execute.mockResolvedValue({
      status: 'error',
      error: {
        code: 'CLICK_FAILED',
        message: 'timeout with private URL https://private.example/path-token',
      },
    });
    const reply = await h.session.execute('task-a', opened.sessionId, { kind: 'click' });
    expect(reply).toMatchObject({
      ok: false,
      actionOutcome: 'unknown',
      error: 'input_outcome_unknown',
    });
    expect(JSON.stringify(reply)).not.toContain('private.example');
    expect(await h.session.execute('task-a', opened.sessionId, { kind: 'click' })).toMatchObject({
      ok: false,
      error: 'input_outcome_unknown',
    });
    expect(h.driver.execute).toHaveBeenCalledTimes(1);
  });

  it('reports applied-but-unobserved input without replaying it', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    h.driver.observeCurrentPage.mockResolvedValue({
      status: 'error',
      error: { code: 'OBSERVATION_FAILED', message: 'missing' },
    });
    expect(
      await h.session.execute('task-a', opened.sessionId, {
        kind: 'key',
        payload: { key: 'Enter' },
      }),
    ).toMatchObject({ ok: false, actionOutcome: 'applied', error: 'observation_failed' });
    expect(
      await h.session.execute('task-a', opened.sessionId, {
        kind: 'key',
        payload: { key: 'Enter' },
      }),
    ).toMatchObject({ ok: false, error: 'observation_required' });
    expect(h.driver.execute).toHaveBeenCalledTimes(1);
    h.driver.observeCurrentPage.mockResolvedValue({ status: 'ok', data: h.observation });
    expect(await h.session.observe('task-a', opened.sessionId)).toMatchObject({ ok: true });
    expect(await h.session.execute('task-a', opened.sessionId, { kind: 'wait' })).toMatchObject({
      ok: true,
    });
  });

  it('does not start a queued native input after stop closes admission', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    const action = h.session.execute('task-a', opened.sessionId, {
      kind: 'key',
      payload: { key: 'Enter' },
    });
    const stopped = h.session.stopTask('task-a');
    expect(await action).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
    await stopped;
    expect(h.driver.execute).not.toHaveBeenCalled();
  });

  it('does not start queued input after an account changes', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    const action = h.session.execute('task-a', opened.sessionId, {
      kind: 'key',
      payload: { key: 'Enter' },
    });
    h.changeOwner();
    expect(await action).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
    expect(h.driver.execute).not.toHaveBeenCalled();
    await h.session.stopTask('task-a');
  });

  it('keeps a known applied receipt when post-action observation throws', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    h.driver.observeCurrentPage.mockRejectedValue(new Error('transport lost'));
    expect(
      await h.session.execute('task-a', opened.sessionId, {
        kind: 'key',
        payload: { key: 'Enter' },
      }),
    ).toMatchObject({ ok: false, error: 'observation_failed', actionOutcome: 'applied' });
    expect(await h.session.execute('task-a', opened.sessionId, { kind: 'key' })).toMatchObject({
      ok: false,
      error: 'observation_required',
    });
    expect(h.driver.execute).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';

const sid = 'e2215e8d-7b6c-4711-ab15-460f51e558a4';
const target = { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid };
const observation = {
  tabId: 42,
  origin: 'https://work.example',
  title: 'Projects',
  bodyText: 'Draft',
  ariaSnapshot: '- button "Save"',
  truncated: false,
};
function harness() {
  const commands: string[] = [];
  const control = new BrowserControl();
  const send = vi.fn(
    async (_user: string, input: ExtensionToolCallOptions): Promise<ExtensionToolCallOutcome> => {
      const op = input.args?.session?.op ?? '';
      commands.push(op);
      return {
        ok: true,
        result:
          op === 'close'
            ? { ok: true, closed: true }
            : {
                ok: true,
                sessionId: sid,
                observation,
                ...(op === 'act' ? { actionOutcome: 'applied' } : {}),
              },
      };
    },
  );
  const client = new SelectedChromeClient({
    userId: 'user-a',
    taskId: 'task-a',
    extensionClientId: 'chrome-a',
    control,
    send,
  });
  return { client, control, send, commands };
}

describe('controlled selected Chrome client', () => {
  it('recovers from a lost read receipt without classifying it as unknown input', async () => {
    const h = harness();
    await h.client.open(target);
    h.send.mockResolvedValueOnce({
      ok: false,
      error: { code: 'timeout', message: 'read timeout' },
    });
    expect(await h.client.observe()).toMatchObject({ ok: false, error: 'observation_failed' });
    expect(h.control.snapshot().phase).toBe('agent');
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false, error: 'observation_required' });
    expect(await h.client.observe()).toMatchObject({ ok: true });
    await h.client.close();
  });

  it('keeps a timed-out wait non-mutating and requires fresh observation', async () => {
    const h = harness();
    await h.client.open(target);
    h.send.mockResolvedValueOnce({
      ok: false,
      error: { code: 'timeout', message: 'wait timeout' },
    });
    expect(
      await h.client.execute({ kind: 'wait', payload: { ms: 10 } }, h.client.revision),
    ).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
    expect(h.control.snapshot().phase).toBe('agent');
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false, error: 'observation_required' });
    await h.client.close();
  });
  it('closes admission immediately but waits for the pending action before remote close', async () => {
    const h = harness();
    await h.client.open(target);
    let settle!: (reply: ExtensionToolCallOutcome) => void;
    h.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const action = h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision);
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'));
    const closed = h.client.close();
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false });
    expect(h.send).toHaveBeenCalledTimes(2);
    settle({
      ok: true,
      result: { ok: true, sessionId: sid, observation, actionOutcome: 'applied' },
    });
    await action;
    expect(await closed).toMatchObject({ ok: true, closed: true });
    expect(h.send).toHaveBeenCalledTimes(3);
  });

  it('does not claim remote cleanup or retry open after losing the open receipt', async () => {
    const h = harness();
    h.send.mockResolvedValueOnce({ ok: false, error: { code: 'timeout', message: 'timeout' } });
    expect(await h.client.open(target)).toMatchObject({ ok: false });
    expect(await h.client.open(target)).toMatchObject({ ok: false });
    expect(await h.client.close()).toMatchObject({ ok: false, error: 'session_outcome_unknown' });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('retries only close after an unconfirmed close receipt', async () => {
    const h = harness();
    await h.client.open(target);
    h.send.mockResolvedValueOnce({ ok: false, error: { code: 'timeout', message: 'timeout' } });
    expect(await h.client.close()).toMatchObject({ ok: false, error: 'close_unconfirmed' });
    expect(await h.client.close()).toMatchObject({ ok: true, closed: true });
    expect(h.send.mock.calls.slice(1).map(([, input]) => input.args?.session?.op)).toEqual([
      'close',
      'close',
    ]);
  });

  it('does not claim release when opening failed to clean up a remote seat', async () => {
    const h = harness();
    h.send.mockResolvedValueOnce({
      ok: false,
      result: { ok: false, error: 'session_cleanup_failed' },
    });
    expect(await h.client.open(target)).toMatchObject({ ok: false });
    expect(await h.client.close()).toEqual({ ok: false, error: 'session_outcome_unknown' });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('keeps a proven pre-dispatch server rejection recoverable', async () => {
    const h = harness();
    await h.client.open(target);
    h.send.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid_session_command', message: 'invalid' },
    });
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
    expect(h.control.snapshot().phase).toBe('agent');
    await h.client.close();
  });
  it('keeps all commands pinned to the original task and connection', async () => {
    const h = harness();
    expect(await h.client.open(target)).toMatchObject({ ok: true, observation });
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: true, actionOutcome: 'applied' });
    await h.client.close();
    expect(h.commands).toEqual(['open', 'act', 'close']);
    for (const args of h.send.mock.calls)
      expect(args).toMatchObject([
        'user-a',
        { taskId: 'task-a', extensionClientId: 'chrome-a', kind: 'session' },
      ]);
  });

  it('grants human control only after the real action settles and observes before handback', async () => {
    const h = harness();
    await h.client.open(target);
    let settle!: (reply: ExtensionToolCallOutcome) => void;
    h.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const oldRevision = h.client.revision;
    const action = h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, oldRevision);
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'));
    h.control.requestHuman();
    const checkpoint = h.client.checkpoint();
    expect(h.control.snapshot().phase).toBe('requested');
    settle({
      ok: true,
      result: { ok: true, sessionId: sid, observation, actionOutcome: 'applied' },
    });
    await action;
    await vi.waitFor(() => expect(h.control.snapshot().phase).toBe('human'));
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, oldRevision),
    ).toMatchObject({ ok: false, error: 'replan_required' });
    const lease = h.control.snapshot().lease;
    if (!lease) throw new Error('no human lease');
    h.control.returnToAgent(lease);
    expect(await checkpoint).toMatchObject({ resumed: true });
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, oldRevision),
    ).toMatchObject({ ok: false, error: 'replan_required' });
    expect(h.commands).toEqual(['open', 'observe']);
    await h.client.close();
  });

  it('does not retry an input when the transport receipt is lost', async () => {
    const h = harness();
    await h.client.open(target);
    h.send.mockResolvedValueOnce({ ok: false, error: { code: 'timeout', message: 'timeout' } });
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false, actionOutcome: 'unknown' });
    expect(h.control.snapshot()).toMatchObject({ phase: 'closed', error: 'input_outcome_unknown' });
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false });
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(await h.client.close()).toMatchObject({ ok: true, closed: true });
  });

  it('preserves applied receipt on failed observation and requires a new observation', async () => {
    const h = harness();
    await h.client.open(target);
    h.send.mockResolvedValueOnce({
      ok: false,
      result: { ok: false, error: 'observation_failed', actionOutcome: 'applied' },
    });
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false, error: 'observation_failed', actionOutcome: 'applied' });
    expect(
      await h.client.execute({ kind: 'key', payload: { key: 'Enter' } }, h.client.revision),
    ).toMatchObject({ ok: false, error: 'observation_required' });
    expect(await h.client.observe()).toMatchObject({ ok: true });
    await h.client.close();
  });

  it('does not accept observations returned for a different selected tab', async () => {
    const h = harness();
    h.send.mockResolvedValueOnce({
      ok: true,
      result: { ok: true, sessionId: sid, observation: { ...observation, tabId: 99 } },
    });
    expect(await h.client.open(target)).toMatchObject({ ok: false, error: 'invalid_receipt' });
    expect(h.control.snapshot().phase).toBe('closed');
    await h.client.close();
  });
});

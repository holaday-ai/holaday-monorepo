import {
  type SelectedChromeSessionCommand,
  selectedChromeSessionCommandSchema,
} from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createBrowserExecutionOwnership } from './browser-execution-ownership.js';
import {
  type SelectedChromeBridge,
  type SelectedChromeTransportReply,
  createSelectedChromeTransport,
} from './selected-chrome-transport.js';

const target = {
  tabId: 42,
  expectedUrl: 'https://work.example/projects',
  selectionId: '6d4a8210-06fd-46fa-91dc-de69968a21f3',
};
const selector = {
  description: 'Save',
  strategies: [{ kind: 'role' as const, role: 'button', name: 'Save' }],
  scope: { timeoutMs: 5_000 },
  selfHeal: false,
};

function command(value: unknown): SelectedChromeSessionCommand {
  return selectedChromeSessionCommandSchema.parse(value);
}

function openedSession(reply: SelectedChromeTransportReply) {
  if (!reply.ok || !('sessionId' in reply)) throw new Error('open failed');
  return reply;
}

function harness() {
  let owner: string | null = 'owner-a';
  let sessionId = 'c4860f52-6b76-4d18-a6ba-04165322af7d';
  const bridge = {
    open: vi.fn<SelectedChromeBridge['open']>(async () => ({
      ok: true,
      sessionId,
      observation: { tabId: 42 },
    })),
    observe: vi.fn<SelectedChromeBridge['observe']>(async () => ({
      ok: true,
      sessionId,
      observation: { tabId: 42 },
    })),
    execute: vi.fn<SelectedChromeBridge['execute']>(async () => ({
      ok: true as const,
      sessionId,
      observation: { tabId: 42, bodyText: 'Saved' },
      actionOutcome: 'applied' as const,
    })),
    close: vi.fn<SelectedChromeBridge['close']>(async () => ({ ok: true })),
    stopTask: vi.fn<SelectedChromeBridge['stopTask']>(async () => {}),
  } satisfies SelectedChromeBridge;
  const ownership = createBrowserExecutionOwnership();
  const prepareLegacy = vi.fn(async () => {});
  let now = 1_000;
  const transport = createSelectedChromeTransport({
    bridge,
    ownership,
    prepareLegacy,
    currentOwner: () => owner,
    now: () => now,
  });
  return {
    bridge,
    ownership,
    prepareLegacy,
    transport,
    setOwner(value: string | null) {
      owner = value;
    },
    setSessionId(value: string) {
      sessionId = value;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('selected Chrome command schema', () => {
  it('accepts the five bounded action kinds with their native requirements', () => {
    const actions = [
      { kind: 'click', selector },
      { kind: 'type', selector, payload: { text: 'hello' } },
      { kind: 'key', selector, payload: { key: 'Enter' } },
      { kind: 'goto', payload: { url: 'https://work.example/next' } },
      { kind: 'wait', payload: { ms: 10_000 } },
    ];
    for (const action of actions) {
      expect(
        selectedChromeSessionCommandSchema.safeParse({
          op: 'act',
          sessionId: 'c4860f52-6b76-4d18-a6ba-04165322af7d',
          action,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects eval, extra action fields, invalid payloads, and missing required fields', () => {
    const invalid = [
      { kind: 'eval', payload: { expression: 'location.href' } },
      { kind: 'click', selector, eval: 'location.href' },
      { kind: 'click' },
      { kind: 'type', selector, payload: {} },
      { kind: 'type', selector, payload: { text: 'x'.repeat(16_001) } },
      { kind: 'key', payload: { key: 'x'.repeat(129) } },
      { kind: 'goto', payload: { url: 'file:///private/data' } },
      { kind: 'goto', payload: { url: `https://example.com/${'x'.repeat(2_048)}` } },
      { kind: 'wait', payload: { ms: 10_001 } },
      { kind: 'wait', payload: { ms: -1 } },
      { kind: 'click', selector, deadlineMs: 30_001 },
    ];
    for (const action of invalid) {
      expect(
        selectedChromeSessionCommandSchema.safeParse({
          op: 'act',
          sessionId: 'c4860f52-6b76-4d18-a6ba-04165322af7d',
          action,
        }).success,
        JSON.stringify(action).slice(0, 200),
      ).toBe(false);
    }
  });
});

describe('selected Chrome transport lifecycle', () => {
  it.each([null, 'owner-b'])(
    'stops the old owner on auth change to %s and waits for detach',
    async (nextOwner) => {
      const h = harness();
      const opened = openedSession(
        await h.transport.handle('task-a', command({ op: 'open', target })),
      );
      let detach!: () => void;
      h.bridge.stopTask.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            detach = resolve;
          }),
      );
      const stopped = h.transport.stopOnOwnerChange(nextOwner);
      h.setOwner(nextOwner);
      expect(
        await h.transport.handle('task-a', command({ op: 'observe', sessionId: opened.sessionId })),
      ).toMatchObject({ ok: false });
      await vi.waitFor(() => expect(detach).toBeTypeOf('function'));
      await expect(h.ownership.runLegacy(async () => {})).rejects.toMatchObject({
        code: 'browser_busy',
      });
      detach();
      await stopped;
      expect(h.bridge.stopTask).toHaveBeenCalledWith('task-a');
      h.setOwner('owner-b');
      expect(await h.transport.handle('task-b', command({ op: 'open', target }))).toMatchObject({
        ok: true,
      });
      await h.transport.stopTask('task-b');
    },
  );

  it('does not stop a session when the owner value is unchanged', async () => {
    const h = harness();
    const opened = openedSession(
      await h.transport.handle('task-a', command({ op: 'open', target })),
    );
    await h.transport.stopOnOwnerChange('owner-a');
    expect(h.bridge.stopTask).not.toHaveBeenCalled();
    expect(
      await h.transport.handle('task-a', command({ op: 'observe', sessionId: opened.sessionId })),
    ).toMatchObject({ ok: true });
    await h.transport.stopTask('task-a');
  });

  it('prepares idle legacy handles before attach and holds ownership through close', async () => {
    const h = harness();
    const opened = openedSession(
      await h.transport.handle('task-a', command({ op: 'open', target })),
    );
    expect(opened).toMatchObject({ ok: true });
    expect(h.prepareLegacy.mock.invocationCallOrder[0]).toBeLessThan(
      h.bridge.open.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    await expect(h.ownership.runLegacy(async () => 'legacy')).rejects.toMatchObject({
      code: 'browser_busy',
    });

    expect(
      await h.transport.handle('task-a', command({ op: 'close', sessionId: opened.sessionId })),
    ).toEqual({ ok: true, closed: true });
    await expect(h.ownership.runLegacy(async () => 'legacy')).resolves.toBe('legacy');
  });

  it('does not attach selected Chrome while a legacy native action is unresolved', async () => {
    const h = harness();
    let finish!: () => void;
    const legacy = h.ownership.runLegacy(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    expect(await h.transport.handle('task-a', command({ op: 'open', target }))).toEqual({
      ok: false,
      error: 'browser_busy',
    });
    expect(h.prepareLegacy).not.toHaveBeenCalled();
    expect(h.bridge.open).not.toHaveBeenCalled();
    finish();
    await legacy;
  });

  it('blocks attach when idle legacy cleanup fails', async () => {
    const h = harness();
    h.prepareLegacy.mockRejectedValueOnce(new Error('private native state https://secret.example'));

    expect(await h.transport.handle('task-a', command({ op: 'open', target }))).toEqual({
      ok: false,
      error: 'legacy_cleanup_failed',
    });
    expect(h.bridge.open).not.toHaveBeenCalled();
    await expect(h.ownership.runLegacy(async () => 'legacy')).resolves.toBe('legacy');
  });

  it('stop closes admission immediately and releases only after the real action settles', async () => {
    const h = harness();
    const opened = openedSession(
      await h.transport.handle('task-a', command({ op: 'open', target })),
    );
    let finish!: () => void;
    h.bridge.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              ok: true,
              sessionId: opened.sessionId,
              observation: { tabId: 42 },
              actionOutcome: 'applied',
            });
        }),
    );
    const act = h.transport.handle(
      'task-a',
      command({
        op: 'act',
        sessionId: opened.sessionId,
        action: { kind: 'key', payload: { key: 'Enter' } },
      }),
    );
    await vi.waitFor(() => expect(h.bridge.execute).toHaveBeenCalledTimes(1));
    let stopped = false;
    const stop = h.transport.stopTask('task-a').then(() => {
      stopped = true;
    });
    expect(
      await h.transport.handle('task-a', command({ op: 'observe', sessionId: opened.sessionId })),
    ).toEqual({ ok: false, error: 'session_unavailable' });
    await Promise.resolve();
    expect(stopped).toBe(false);
    await expect(h.ownership.runLegacy(async () => 'legacy')).rejects.toMatchObject({
      code: 'browser_busy',
    });

    finish();
    await act;
    await stop;
    expect(h.bridge.stopTask).toHaveBeenCalledWith('task-a');
    await expect(h.ownership.runLegacy(async () => 'legacy')).resolves.toBe('legacy');
  });

  it('does not start a queued bridge input after stop closes admission', async () => {
    const h = harness();
    const opened = openedSession(
      await h.transport.handle('task-a', command({ op: 'open', target })),
    );
    const act = h.transport.handle(
      'task-a',
      command({
        op: 'act',
        sessionId: opened.sessionId,
        action: { kind: 'key', payload: { key: 'Enter' } },
      }),
    );
    const stop = h.transport.stopTask('task-a');

    expect(await act).toEqual({
      ok: false,
      error: 'session_unavailable',
      actionOutcome: 'not_applied',
    });
    await stop;
    expect(h.bridge.execute).not.toHaveBeenCalled();
  });

  it.each(['browser_busy', 'session_unavailable', 'observation_required'])(
    'marks confirmed pre-dispatch %s failures as not applied',
    async (error) => {
      const h = harness();
      const opened = openedSession(
        await h.transport.handle('task-a', command({ op: 'open', target })),
      );
      h.bridge.execute.mockResolvedValueOnce({ ok: false, error });

      expect(
        await h.transport.handle(
          'task-a',
          command({
            op: 'act',
            sessionId: opened.sessionId,
            action: { kind: 'key', payload: { key: 'Enter' } },
          }),
        ),
      ).toEqual({ ok: false, error, actionOutcome: 'not_applied' });
    },
  );

  it('preserves unknown outcome from an error after native input begins', async () => {
    const h = harness();
    const opened = openedSession(
      await h.transport.handle('task-a', command({ op: 'open', target })),
    );
    h.bridge.execute.mockResolvedValueOnce({
      ok: false,
      error: 'input_outcome_unknown',
      actionOutcome: 'unknown',
    });

    expect(
      await h.transport.handle(
        'task-a',
        command({
          op: 'act',
          sessionId: opened.sessionId,
          action: { kind: 'key', payload: { key: 'Enter' } },
        }),
      ),
    ).toEqual({
      ok: false,
      error: 'input_outcome_unknown',
      actionOutcome: 'unknown',
    });
  });

  it('retries a lost close receipt only for the exact recent owner, task, and session', async () => {
    const h = harness();
    const opened = openedSession(
      await h.transport.handle('task-a', command({ op: 'open', target })),
    );
    const close = command({ op: 'close', sessionId: opened.sessionId });
    expect(await h.transport.handle('task-a', close)).toEqual({ ok: true, closed: true });
    expect(await h.transport.handle('task-a', close)).toEqual({ ok: true, closed: true });
    expect(h.bridge.close).toHaveBeenCalledTimes(1);

    expect(await h.transport.handle('task-b', close)).toEqual({
      ok: false,
      error: 'session_unavailable',
    });
    h.setOwner('owner-b');
    expect(await h.transport.handle('task-a', close)).toEqual({
      ok: false,
      error: 'session_unavailable',
    });
    h.setOwner('owner-a');
    h.advance(60_001);
    expect(await h.transport.handle('task-a', close)).toEqual({
      ok: false,
      error: 'session_unavailable',
    });
  });

  it('keeps the seat after close cleanup failure and retries cleanup without replaying close', async () => {
    const h = harness();
    const opened = openedSession(
      await h.transport.handle('task-a', command({ op: 'open', target })),
    );
    const close = command({ op: 'close', sessionId: opened.sessionId });
    h.bridge.close.mockRejectedValueOnce(new Error('detach failed'));

    expect(await h.transport.handle('task-a', close)).toEqual({
      ok: false,
      error: 'session_cleanup_failed',
    });
    await expect(h.ownership.runLegacy(async () => 'legacy')).rejects.toMatchObject({
      code: 'browser_busy',
    });

    expect(await h.transport.handle('task-a', close)).toEqual({ ok: true, closed: true });
    expect(h.bridge.close).toHaveBeenCalledTimes(1);
    expect(h.bridge.stopTask).toHaveBeenCalledTimes(1);
    await expect(h.ownership.runLegacy(async () => 'legacy')).resolves.toBe('legacy');
  });
});

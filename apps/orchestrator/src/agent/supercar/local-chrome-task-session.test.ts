import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { LocalChromeTaskSessions } from './local-chrome-task-session.js';

const selection = {
  extensionClientId: 'connection',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
};
describe('local Chrome task ownership', () => {
  it('reports only a scoped local observation and never dispatches to resolve uncertainty', async () => {
    const sessions = new LocalChromeTaskSessions();
    let sends = 0;
    const session = sessions.start('alice', 'task', selection, async () => {
      sends++;
      return { ok: false };
    });
    expect(sessions.executionObservation('alice', 'task')).toBeNull();
    expect(sessions.executionObservation('bob', 'task')).toEqual({
      state: 'unconfirmed',
      reason: 'session_not_observed',
    });
    session.control.close('input_outcome_unknown');
    expect(sessions.executionObservation('alice', 'task')).toEqual({
      state: 'unconfirmed',
      reason: 'input_outcome_unknown',
    });
    expect(sends).toBe(0);
    await sessions.finish('alice', 'task');
    expect(sessions.executionObservation('alice', 'task')).toEqual({
      state: 'unconfirmed',
      reason: 'session_not_observed',
    });
  });
  it('does not mistake quarantined cleanup for an active run', async () => {
    const sessions = new LocalChromeTaskSessions();
    const session = sessions.start('alice', 'task', selection, async () => ({ ok: false }));
    await session.client.open(selection);
    await sessions.finish('alice', 'task');
    expect(sessions.get('alice', 'task')).toBe(session);
    expect(sessions.executionObservation('alice', 'task')).toEqual({
      state: 'unconfirmed',
      reason: 'session_finishing',
    });
    expect(() => sessions.reserve('alice', selection)).toThrow('chrome_connection_busy');
  });
  it.each([false, true])(
    'only requests file bytes with the explicit task file switch (%s)',
    async (enabled) => {
      const sessions = new LocalChromeTaskSessions();
      let requested: readonly string[] = [];
      const session = sessions.start(
        'alice',
        'task',
        selection,
        async (_user, options) => {
          const command = options.args?.session;
          if (command?.op === 'open') requested = command.protocol?.capabilities ?? [];
          return {
            ok: true,
            result:
              command?.op === 'close'
                ? { ok: true, closed: true }
                : {
                    ok: true,
                    sessionId: selection.selectionId,
                    protocol: {
                      ...USER_BROWSER_PROTOCOL,
                      capabilities: [
                        ...USER_BROWSER_PROTOCOL.capabilities,
                        ...(enabled ? ['task_file_upload_v1'] : []),
                      ],
                    },
                    observation: {
                      tabId: 42,
                      origin: 'https://work.example',
                      title: 'Report',
                      bodyText: 'Draft',
                      ariaSnapshot: '',
                      truncated: false,
                      observationRevision: 1,
                    },
                  },
          };
        },
        undefined,
        { viewportV2: false, observationV2: false, replayV1: false, routingV2: true },
        enabled ? { taskFilesV1: true } : undefined,
      );
      try {
        expect(await session.client.open(selection)).toMatchObject({ ok: true });
        expect(requested.includes('task_file_upload_v1')).toBe(enabled);
        expect(session.client.fileUploadsEnabled).toBe(enabled);
      } finally {
        await sessions.finish('alice', 'task');
      }
    },
  );
  it('reserves before admission and transfers the same seat to execution', async () => {
    const sessions = new LocalChromeTaskSessions();
    const reservation = sessions.reserve('alice', selection);
    expect(() => sessions.reserve('alice', selection)).toThrow('chrome_connection_busy');
    sessions.start('alice', 'task', selection, async () => ({ ok: false }), reservation);
    sessions.releaseReservation(reservation);
    expect(() => sessions.reserve('alice', selection)).toThrow('chrome_connection_busy');
    await sessions.finish('alice', 'task');
    const next = sessions.reserve('alice', selection);
    sessions.releaseReservation(next);
    expect(() => sessions.reserve('alice', selection)).not.toThrow();
  });
  it('pins the user and connection, aborts control, and releases only after close', async () => {
    const sessions = new LocalChromeTaskSessions();
    const session = sessions.start('alice', 'task', selection, async () => ({ ok: false }));
    expect(sessions.get('bob', 'task')).toBeUndefined();
    expect(sessions.abort('bob', 'task')).toBe(false);
    expect(() => sessions.start('alice', 'other', selection, async () => ({ ok: false }))).toThrow(
      'chrome_connection_busy',
    );
    expect(sessions.abort('alice', 'task')).toBe(true);
    expect(session.cancellation.signal.aborted).toBe(true);
    expect(session.control.snapshot().phase).toBe('closed');
    expect((await sessions.finish('alice', 'task'))?.ok).toBe(true);
    expect(sessions.get('alice', 'task')).toBeUndefined();
  });
  it('retains a seat when remote attachment outcome is unknown', async () => {
    const sessions = new LocalChromeTaskSessions();
    const session = sessions.start('alice', 'task', selection, async () => ({ ok: false }));
    await session.client.open(selection);
    expect((await sessions.finish('alice', 'task'))?.ok).toBe(false);
    expect(sessions.get('alice', 'task')).toBe(session);
  });
});

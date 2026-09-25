import { describe, expect, it } from 'vitest';
import { LocalChromeTaskSessions } from './local-chrome-task-session.js';

const selection = {
  extensionClientId: 'connection',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
};
describe('local Chrome task ownership', () => {
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

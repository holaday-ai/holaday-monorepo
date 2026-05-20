import { describe, expect, it } from 'vitest';
import { isTerminalStatus } from './task';

describe('isTerminalStatus', () => {
  it('treats all browser-session-ending statuses as terminal', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('partial_success')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('keeps paused active because user-paused tasks can resume', () => {
    expect(isTerminalStatus('paused')).toBe(false);
    expect(isTerminalStatus('awaiting_user')).toBe(false);
    expect(isTerminalStatus('executing')).toBe(false);
    expect(isTerminalStatus('queued')).toBe(false);
  });
});

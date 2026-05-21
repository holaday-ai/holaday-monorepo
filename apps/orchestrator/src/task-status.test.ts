import { describe, expect, it } from 'vitest';
import { isTaskTerminalStatus } from './task-status.js';

describe('isTaskTerminalStatus', () => {
  it('treats partial_success as a first-class terminal task status', () => {
    expect(isTaskTerminalStatus('completed')).toBe(true);
    expect(isTaskTerminalStatus('partial_success')).toBe(true);
    expect(isTaskTerminalStatus('failed')).toBe(true);
    expect(isTaskTerminalStatus('cancelled')).toBe(true);
  });

  it('keeps live and empty statuses non-terminal', () => {
    expect(isTaskTerminalStatus('queued')).toBe(false);
    expect(isTaskTerminalStatus('executing')).toBe(false);
    expect(isTaskTerminalStatus('awaiting_user')).toBe(false);
    expect(isTaskTerminalStatus(null)).toBe(false);
  });
});


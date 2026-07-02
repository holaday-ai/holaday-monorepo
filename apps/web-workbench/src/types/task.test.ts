import { describe, expect, it } from 'vitest';
import { isActive, isTerminalStatus } from './task';

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

describe('isActive', () => {
  it('matches the backend active status set used for quota and recovery', () => {
    expect(isActive('pending')).toBe(true);
    expect(isActive('planning')).toBe(true);
    expect(isActive('queued')).toBe(true);
    expect(isActive('executing')).toBe(true);
    expect(isActive('awaiting_user')).toBe(true);
    expect(isActive('paused')).toBe(true);
    expect(isActive('completed')).toBe(false);
    expect(isActive('partial_success')).toBe(false);
    expect(isActive('failed')).toBe(false);
    expect(isActive('cancelled')).toBe(false);
  });
});

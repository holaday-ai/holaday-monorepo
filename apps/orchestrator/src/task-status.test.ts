import { describe, expect, it } from 'vitest';
import {
  TASK_ACTIVE_STATUSES,
  TASK_QUEUE_DEPTH_STATUSES,
  isTaskTerminalStatus,
} from './task-status.js';

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

describe('task status sets', () => {
  it('keeps queued in the active task set for quota and recovery visibility', () => {
    expect(TASK_ACTIVE_STATUSES).toEqual([
      'pending',
      'planning',
      'queued',
      'executing',
      'awaiting_user',
      'paused',
    ]);
  });

  it('counts queued in global queue depth without counting parked user waits', () => {
    expect(TASK_QUEUE_DEPTH_STATUSES).toEqual([
      'pending',
      'planning',
      'queued',
      'executing',
    ]);
  });
});

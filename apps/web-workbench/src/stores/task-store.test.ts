import { describe, expect, it } from 'vitest';
import { normaliseDetailStepStatus } from './task-store';

describe('normaliseDetailStepStatus', () => {
  it('maps DB completed steps to done instead of failed', () => {
    expect(normaliseDetailStepStatus('completed')).toBe('done');
    expect(normaliseDetailStepStatus('done')).toBe('done');
    expect(normaliseDetailStepStatus('ok')).toBe('done');
  });

  it('keeps active DB step states running in the hydrated detail view', () => {
    expect(normaliseDetailStepStatus('pending')).toBe('running');
    expect(normaliseDetailStepStatus('executing')).toBe('running');
    expect(normaliseDetailStepStatus('awaiting_user')).toBe('running');
  });

  it('maps error-like states to failed', () => {
    expect(normaliseDetailStepStatus('failed')).toBe('failed');
    expect(normaliseDetailStepStatus('error')).toBe('failed');
  });

  it('keeps cancelled detail steps distinct from failures', () => {
    expect(normaliseDetailStepStatus('cancelled')).toBe('cancelled');
  });
});

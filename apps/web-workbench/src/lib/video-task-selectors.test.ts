import { describe, expect, it } from 'vitest';
import type { UiStep } from '@/types/task';
import {
  EMPTY_STEPS,
  isVideoTaskRunning,
  selectStepsFor,
  shouldRefreshForTask,
  videoTaskStatusLabel,
} from './video-task-selectors';

type StepsState = { stepsByTask: Record<string, UiStep[]> };

/**
 * Emulate what React's `useSyncExternalStore` does to a Zustand v5
 * selector: it repeatedly calls `getSnapshot()` and re-renders whenever
 * the result is not `Object.is`-equal to the previous one. A snapshot
 * that never stabilises is exactly the infinite re-render that surfaces
 * as React error #185 ("Maximum update depth exceeded"). This helper
 * returns false when the snapshot keeps changing — i.e. it would loop.
 */
function snapshotStabilises(getSnapshot: () => unknown, maxChecks = 100): boolean {
  let prev = getSnapshot();
  for (let i = 0; i < maxChecks; i++) {
    const next = getSnapshot();
    if (Object.is(next, prev)) return true; // converged → React stops re-rendering
    prev = next;
  }
  return false; // never settled → useSyncExternalStore loops → #185
}

describe('selectStepsFor — #185 regression (referentially-stable snapshot)', () => {
  it('documents the BUG: an inline `?? []` selector is NOT stable (this is what looped)', () => {
    const state: StepsState = { stepsByTask: {} };
    const buggy = (s: StepsState): readonly UiStep[] => s.stepsByTask['tsk_x'] ?? [];
    // Two calls, identical state → two DIFFERENT array refs. This is the
    // useSyncExternalStore contract violation that crashed VideoPage.
    expect(buggy(state)).not.toBe(buggy(state));
    expect(snapshotStabilises(() => buggy(state))).toBe(false);
  });

  it('the FIX: selectStepsFor returns a stable ref when the task has no steps', () => {
    const state: StepsState = { stepsByTask: {} };
    const sel = selectStepsFor('tsk_x');
    // Same reference across calls → snapshot is stable → no #185 loop.
    // This assertion FAILS if selectStepsFor is ever rewritten with `?? []`.
    expect(sel(state)).toBe(sel(state));
    expect(sel(state)).toBe(EMPTY_STEPS);
    expect(snapshotStabilises(() => sel(state))).toBe(true);
  });

  it('stable even across fresh selector instances (different ?task= renders)', () => {
    const state: StepsState = { stepsByTask: {} };
    expect(selectStepsFor('tsk_x')(state)).toBe(selectStepsFor('tsk_x')(state));
  });

  it('returns the real steps array (by reference) when present', () => {
    const steps: UiStep[] = [{ tickIndex: 0, status: 'running', startedAt: 0 }];
    const state: StepsState = { stepsByTask: { tsk_x: steps } };
    expect(selectStepsFor('tsk_x')(state)).toBe(steps);
    expect(snapshotStabilises(() => selectStepsFor('tsk_x')(state))).toBe(true);
  });

  it('EMPTY_STEPS is frozen so it cannot be mutated into a shared-state bug', () => {
    expect(Object.isFrozen(EMPTY_STEPS)).toBe(true);
  });
});

describe('shouldRefreshForTask — one-time deep-link refresh guard', () => {
  it('true only on the first miss for a deep-linked id', () => {
    expect(shouldRefreshForTask({ taskId: 'tsk_x', hasTask: false, already: false })).toBe(true);
  });
  it('false once already refreshed (stops the effect feeding itself)', () => {
    expect(shouldRefreshForTask({ taskId: 'tsk_x', hasTask: false, already: true })).toBe(false);
  });
  it('false when the row is already in the store', () => {
    expect(shouldRefreshForTask({ taskId: 'tsk_x', hasTask: true, already: false })).toBe(false);
  });
  it('false when there is no ?task= id', () => {
    expect(shouldRefreshForTask({ taskId: null, hasTask: false, already: false })).toBe(false);
  });
});

describe('video task product status helpers', () => {
  it('treats pre-execution and executing statuses as generating', () => {
    for (const status of ['pending', 'planning', 'queued', 'executing'] as const) {
      expect(isVideoTaskRunning(status)).toBe(true);
      expect(videoTaskStatusLabel(status)).toBe('生成中');
    }
    expect(isVideoTaskRunning('awaiting_user')).toBe(false);
    expect(videoTaskStatusLabel('awaiting_user')).toBe('待确认报价');
  });
});

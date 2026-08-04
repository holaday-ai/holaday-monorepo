import { describe, expect, it } from 'vitest';
import type { UiStep } from '@/types/task';
import {
  EMPTY_STEPS,
  currentMediaTaskTitle,
  currentMediaTaskText,
  hydrateMissingMediaTask,
  isVideoTaskRunning,
  resolveVideoAwaitingKind,
  selectStepsFor,
  videoTabForTaskType,
  videoTaskStatusIconKind,
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

describe('hydrateMissingMediaTask — one-time deep-link detail recovery', () => {
  it('hydrates the exact older history task when it is absent from the first list page', () => {
    const hydrated: string[] = [];

    expect(
      hydrateMissingMediaTask(
        { taskId: 'tsk_older', hasTask: false, already: false },
        (taskId) => hydrated.push(taskId),
      ),
    ).toBe(true);
    expect(hydrated).toEqual(['tsk_older']);
  });

  it('does not rehydrate an existing, already attempted, or missing task id', () => {
    const hydrated: string[] = [];
    const hydrate = (taskId: string): void => {
      hydrated.push(taskId);
    };

    expect(
      hydrateMissingMediaTask(
        { taskId: 'tsk_existing', hasTask: true, already: false },
        hydrate,
      ),
    ).toBe(false);
    expect(
      hydrateMissingMediaTask(
        { taskId: 'tsk_attempted', hasTask: false, already: true },
        hydrate,
      ),
    ).toBe(false);
    expect(
      hydrateMissingMediaTask(
        { taskId: null, hasTask: false, already: false },
        hydrate,
      ),
    ).toBe(false);
    expect(hydrated).toEqual([]);
  });
});

describe('video task product status helpers', () => {
  it('opens a deep-linked video task in its actual product tab', () => {
    expect(videoTabForTaskType('normal')).toBe('normal');
    expect(videoTabForTaskType('pet')).toBe('pet');
    expect(videoTabForTaskType('ip_person')).toBe('ip');
    expect(videoTabForTaskType(undefined)).toBeNull();
  });

  it('keeps quote actions visible when the live awaiting event wins the create-task race', () => {
    expect(resolveVideoAwaitingKind(undefined, 'video_quote')).toBe('video_quote');
    expect(resolveVideoAwaitingKind('login', 'video_quote')).toBe('login');
    expect(resolveVideoAwaitingKind(undefined, undefined)).toBeUndefined();
  });

  it('treats pre-execution and executing statuses as generating', () => {
    for (const status of ['pending', 'planning', 'queued', 'executing'] as const) {
      expect(isVideoTaskRunning(status)).toBe(true);
      expect(videoTaskStatusLabel(status)).toBe('生成中');
    }
    expect(isVideoTaskRunning('awaiting_user')).toBe(false);
    expect(videoTaskStatusLabel('awaiting_user')).toBe('待确认报价');
    expect(videoTaskStatusLabel('partial_success')).toBe('需复核');
  });

  it('does not use a success icon for review-needed video tasks', () => {
    expect(videoTaskStatusIconKind('completed')).toBe('success');
    expect(videoTaskStatusIconKind('partial_success')).toBe('attention');
    expect(videoTaskStatusIconKind('awaiting_user')).toBe('attention');
    expect(videoTaskStatusIconKind('failed')).toBe('failed');
    expect(videoTaskStatusIconKind('cancelled')).toBe('inactive');
    expect(videoTaskStatusIconKind('executing')).toBe('running');
  });

  it('never leaks stale live progress into a terminal media task', () => {
    expect(
      currentMediaTaskText({
        status: 'completed',
        resultText: '图片生成完成。',
        liveSubStatusText: '正在生成图片…',
        progress: '正在生成图片…',
        streamingText: '仍在处理中…',
      }),
    ).toBe('图片生成完成。');

    expect(
      currentMediaTaskText({
        status: 'completed',
        progress: '正在生成图片…',
      }),
    ).toBe('');
  });

  it('keeps live progress visible while a media task is active or awaiting confirmation', () => {
    expect(
      currentMediaTaskText({
        status: 'executing',
        liveSubStatusText: '正在生成视频…',
        progress: '已完成 1/3 段',
      }),
    ).toBe('正在生成视频…');

    expect(
      currentMediaTaskText({
        status: 'awaiting_user',
        awaitingQuestion: '请确认报价',
        progress: '正在估价…',
      }),
    ).toBe('请确认报价');
  });

  it('bounds an unbroken current-task title for narrow workbench panes', () => {
    const title = currentMediaTaskTitle({
      intent: `生成视频：https://example.com/${'unbroken'.repeat(20)}`,
      title: null,
    });

    expect(title.length).toBeLessThanOrEqual(64);
    expect(title.endsWith('…')).toBe(true);
  });
});

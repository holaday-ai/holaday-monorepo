import type { TaskStore } from '@/stores/task-store';
import type { UiStep } from '@/types/task';

/**
 * Stable, shared empty array for "this task has no steps yet".
 *
 * Why this exists: under Zustand v5 (`^5.0.2`) `useStore(selector)` is
 * backed by React's bare `useSyncExternalStore`, whose contract requires
 * `getSnapshot()` to return a *referentially stable* value while the store
 * is unchanged. A selector like `(s) => s.stepsByTask[id] ?? []` allocates
 * a NEW `[]` on every call, so React sees the snapshot "change" on every
 * consistency check, re-renders to reconcile, calls the selector again,
 * gets yet another new `[]` … → "Maximum update depth exceeded"
 * (minified React error #185). This bit the in-page video task panel: a
 * freshly-submitted task has no `stepsByTask[id]` entry, so the `?? []`
 * branch fired every render and crashed the page to its error boundary
 * (it only "recovered" on reload because detail-load then populated a
 * real, stable steps array). A module-level constant keeps the empty case
 * referentially stable. Frozen so an accidental mutation can't poison it.
 */
export const EMPTY_STEPS: readonly UiStep[] = Object.freeze([]);

/**
 * Steps for `taskId`, or the shared stable empty array. Safe to pass to
 * `useTaskStore(...)` — the no-steps case returns the SAME reference every
 * call, satisfying the useSyncExternalStore snapshot-stability contract.
 */
export const selectStepsFor =
  (taskId: string) =>
  (s: Pick<TaskStore, 'stepsByTask'>): readonly UiStep[] =>
    s.stepsByTask[taskId] ?? EMPTY_STEPS;

/**
 * Should VideoPage fire a one-time `refreshTasks()` for a deep-linked
 * `?task=` whose row isn't in the store yet?
 *
 * True only when the id is present, its row is absent, AND we haven't
 * already refreshed for this id. The `already` guard is what stops the
 * effect feeding itself: refresh → store update → re-render → (row still
 * absent for a beat) → refresh → … The caller records the id in a ref the
 * first time so a given `?task=` triggers at most one refresh.
 */
export function shouldRefreshForTask(input: {
  taskId: string | null;
  hasTask: boolean;
  already: boolean;
}): boolean {
  if (!input.taskId) return false;
  if (input.hasTask) return false;
  if (input.already) return false;
  return true;
}

export function isVideoTaskRunning(status: string): boolean {
  return (
    status === 'pending' ||
    status === 'planning' ||
    status === 'queued' ||
    status === 'executing'
  );
}

export function videoTaskStatusLabel(status: string): string {
  switch (status) {
    case 'awaiting_user':
      return '待确认报价';
    case 'pending':
    case 'planning':
    case 'executing':
    case 'queued':
      return '生成中';
    case 'completed':
      return '已完成';
    case 'partial_success':
      return '需复核';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

export type VideoTaskStatusIconKind =
  | 'success'
  | 'attention'
  | 'failed'
  | 'inactive'
  | 'running';

export function videoTaskStatusIconKind(status: string): VideoTaskStatusIconKind {
  switch (status) {
    case 'completed':
      return 'success';
    case 'partial_success':
    case 'awaiting_user':
      return 'attention';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'inactive';
    default:
      return 'running';
  }
}

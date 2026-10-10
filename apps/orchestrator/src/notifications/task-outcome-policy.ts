/**
 * Batch 10.3 — when does a scheduled / planned task outcome notify, and where.
 *
 *   failed   → inbox + external IM webhooks, but only when the consecutive
 *              failure streak reaches the per-task threshold N (default 1),
 *              then again every N further failures (N, 2N, 3N …) so a task
 *              broken for days keeps reminding without spamming every run.
 *   success  → silent by default; inbox + webhooks when the task opted in
 *              (`notify_on_success`).
 *   started / skipped
 *            → inbox only (never pushed to IM), unchanged inbox behaviour.
 *   cancelled→ silent (user action, not a failure).
 */

export const DEFAULT_FAILURE_NOTIFY_THRESHOLD = 1;
export const MAX_FAILURE_NOTIFY_THRESHOLD = 10;

export type TaskOutcomeKind = 'started' | 'skipped' | 'success' | 'failed' | 'cancelled';

export interface TaskOutcomePrefs {
  /** Consecutive failures INCLUDING the current one (0 for non-failures). */
  consecutiveFailures: number;
  failureNotifyThreshold: number | null | undefined;
  notifyOnSuccess: boolean | null | undefined;
}

export type TaskOutcomeDecision =
  | { notify: false }
  | { notify: true; delivery: 'all' | 'in_app_only' };

export function normaliseFailureThreshold(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_FAILURE_NOTIFY_THRESHOLD;
  }
  return Math.min(MAX_FAILURE_NOTIFY_THRESHOLD, Math.max(1, Math.trunc(value)));
}

export function decideTaskOutcomeNotification(
  kind: TaskOutcomeKind,
  prefs: TaskOutcomePrefs,
): TaskOutcomeDecision {
  switch (kind) {
    case 'started':
    case 'skipped':
      return { notify: true, delivery: 'in_app_only' };
    case 'cancelled':
      return { notify: false };
    case 'success':
      return prefs.notifyOnSuccess === true
        ? { notify: true, delivery: 'all' }
        : { notify: false };
    case 'failed': {
      const threshold = normaliseFailureThreshold(prefs.failureNotifyThreshold);
      const streak = Math.max(0, Math.trunc(prefs.consecutiveFailures));
      if (streak < threshold || streak % threshold !== 0) return { notify: false };
      return { notify: true, delivery: 'all' };
    }
    default: {
      const exhaustive: never = kind;
      void exhaustive;
      return { notify: false };
    }
  }
}

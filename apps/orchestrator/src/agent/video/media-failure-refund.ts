/**
 * Integration point for refunding quota when an image / video generation fails
 * on the platform side (provider error, quality gate, storage failure).
 *
 * The shared platform-failure refund helper (`quota_refunds` table, idempotent
 * by taskId) is being built on the main branch. This module deliberately owns
 * NO table and NO quota logic: the main session registers that helper once at
 * startup via `setMediaFailureRefundHook`, and the media lanes call
 * `notifyMediaGenerationFailed` from their failure branches. Until a hook is
 * registered the call is a logged no-op, so wiring order cannot double-refund.
 */

export type MediaFailureLane = 'image' | 'video_creation';

export interface MediaGenerationFailure {
  /** External task id — the idempotency key of the refund helper. */
  readonly taskId: string;
  readonly userIdInternal: number;
  readonly lane: MediaFailureLane;
  /** Safe, user-facing reason already persisted on the task. */
  readonly reason: string;
  /** True only when nothing was delivered (partial successes are not refunded). */
  readonly nothingDelivered: boolean;
}

export type MediaFailureRefundHook = (failure: MediaGenerationFailure) => Promise<void>;

interface RefundLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

let hook: MediaFailureRefundHook | null = null;

/** Register the shared refund helper (main branch, idempotent by taskId). */
export function setMediaFailureRefundHook(next: MediaFailureRefundHook | null): void {
  hook = next;
}

export function hasMediaFailureRefundHook(): boolean {
  return hook !== null;
}

/**
 * Fire the refund hook for a failed generation. Never throws: a refund
 * failure must not mask the task's own terminal failure.
 */
export async function notifyMediaGenerationFailed(
  failure: MediaGenerationFailure,
  logger?: RefundLogger,
): Promise<'refund_requested' | 'skipped_partial' | 'no_hook' | 'hook_failed'> {
  if (!failure.nothingDelivered) return 'skipped_partial';
  if (!hook) {
    logger?.warn(
      { taskId: failure.taskId, lane: failure.lane },
      'media refund hook not registered — platform-failure refund skipped',
    );
    return 'no_hook';
  }
  try {
    await hook(failure);
    return 'refund_requested';
  } catch (err) {
    logger?.warn(
      {
        taskId: failure.taskId,
        lane: failure.lane,
        err: err instanceof Error ? err.message : String(err),
      },
      'media refund hook failed',
    );
    return 'hook_failed';
  }
}

/**
 * Batch 10.2 — failed-task recovery copy. Mirrors the server read model
 * `taskRecovery.failureContext` (refund ledger + original inputs).
 */

export type TaskRefundState =
  | 'refunded'
  | 'pending'
  | 'not_refundable'
  | 'contact_support'
  | 'not_charged';

export interface TaskFailureContext {
  taskId: string;
  refund: { state: TaskRefundState; refundedAt: Date | string | null };
  inputFiles: ReadonlyArray<{ fileId: string; filename: string; mimetype: string }>;
  unavailableInputCount: number;
}

export interface RefundStatusCopy {
  label: string;
  detail: string;
  tone: 'positive' | 'pending' | 'neutral';
}

/**
 * User-facing refund line. `not_charged` returns null: there is nothing
 * honest to say (follow-ups are free, test accounts are unmetered, older
 * tasks predate the ledger) and an empty claim reads like a billing bug.
 */
export function refundStatusCopy(state: TaskRefundState | null | undefined): RefundStatusCopy | null {
  switch (state) {
    case 'refunded':
      return { label: '额度已退还', detail: '这次失败由平台原因导致，消耗的额度已自动退回。', tone: 'positive' };
    case 'pending':
      return { label: '额度退还中', detail: '这次失败由平台原因导致，额度会在几分钟内自动退回。', tone: 'pending' };
    case 'contact_support':
      return {
        label: '额度未自动退还',
        detail: '已超过自动退还时限，如需处理请联系 support@holaday.ai。',
        tone: 'neutral',
      };
    case 'not_refundable':
      return { label: '额度不退还', detail: '这次失败与任务内容或取消操作有关，不属于平台原因。', tone: 'neutral' };
    default:
      return null;
  }
}

/** Short note under the retry button so users know which files go along. */
export function retryAttachmentNote(context: TaskFailureContext | null | undefined): string | null {
  if (!context) return null;
  const resend = context.inputFiles.length;
  const missing = context.unavailableInputCount;
  if (resend === 0 && missing === 0) return null;
  if (missing === 0) return `重新执行会带上原来的 ${resend} 个附件。`;
  if (resend === 0) return `原来的 ${missing} 个附件已失效，重新执行时需要重新上传。`;
  return `重新执行会带上 ${resend} 个附件；另有 ${missing} 个已失效，需要重新上传。`;
}

/** Local optimistic rows (`local_pending_*`) have no server record yet. */
export function canLoadFailureContext(taskId: string | undefined, status: string): taskId is string {
  return (
    typeof taskId === 'string' &&
    taskId.length > 0 &&
    !taskId.startsWith('local_pending_') &&
    (status === 'failed' || status === 'cancelled')
  );
}

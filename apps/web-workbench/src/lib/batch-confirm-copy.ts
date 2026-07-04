import type { UiAwaitingUser } from '@/types/task';

export type BatchConfirmState = NonNullable<UiAwaitingUser['batchConfirm']>;
export type SingleConfirmState = NonNullable<UiAwaitingUser['singleConfirm']>;
export type BatchConfirmDecision = 'approve' | 'skip' | 'reject';
export type SingleConfirmDecision = 'approve' | 'reject';

const RISK_LABEL: Record<BatchConfirmState['risk'], string> = {
  low: '低风险操作',
  medium: '中风险操作',
  high: '高风险操作',
};

export function batchConfirmDisplayIndex(batch: Pick<BatchConfirmState, 'batchIndex' | 'batchTotal'>): number {
  const bounded = Math.max(1, batch.batchIndex);
  return Math.min(batch.batchTotal, bounded);
}

export function batchConfirmQuestion(batch: BatchConfirmState): string {
  const prefix = `确认第 ${batchConfirmDisplayIndex(batch)}/${batch.batchTotal} 批`;
  const summary = batch.summary?.trim();
  return summary ? `${prefix}：${summary}` : prefix;
}

export function batchConfirmSummary(batch: BatchConfirmState): string {
  return `${RISK_LABEL[batch.risk]} · ${batch.items.length} 项待确认`;
}

export function batchConfirmActionLabel(decision: BatchConfirmDecision): string {
  switch (decision) {
    case 'approve':
      return '确认执行';
    case 'skip':
      return '跳过本批';
    case 'reject':
      return '取消任务';
  }
}

export function singleConfirmQuestion(confirm: SingleConfirmState): string {
  return confirm.prompt.trim() || '请确认是否继续下一步。';
}

export function singleConfirmSummary(confirm: SingleConfirmState): string {
  return `${RISK_LABEL[confirm.risk]} · 需要你确认后继续`;
}

export function singleConfirmActionLabel(decision: SingleConfirmDecision): string {
  switch (decision) {
    case 'approve':
      return '我已确认，继续';
    case 'reject':
      return '取消任务';
  }
}

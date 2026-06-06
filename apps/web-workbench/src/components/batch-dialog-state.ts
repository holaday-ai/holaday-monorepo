export function batchCreateButtonLabel(submitting: boolean): string {
  return submitting ? '创建中…' : '创建并开始';
}

export function batchCreateDisabled({
  submitting,
  promptCount,
  overLimit,
}: {
  readonly submitting: boolean;
  readonly promptCount: number;
  readonly overLimit: boolean;
}): boolean {
  return submitting || promptCount === 0 || overLimit;
}

export function batchPromptCountCopy({
  promptCount,
  maxItems,
  duplicateCount,
  overLimit,
}: {
  readonly promptCount: number;
  readonly maxItems: number;
  readonly duplicateCount: number;
  readonly overLimit: boolean;
}): string {
  const parts = [`${promptCount} / ${maxItems}`];
  if (duplicateCount > 0) parts.push(`已去重 ${duplicateCount} 项`);
  if (overLimit) parts.push(`超过上限 ${maxItems} 项`);
  return parts.join(' · ');
}

export function batchActiveIndexAfterRemove({
  activeIndex,
  removedIndex,
  itemCount,
}: {
  readonly activeIndex: number;
  readonly removedIndex: number;
  readonly itemCount: number;
}): number {
  if (itemCount <= 1) return 0;
  const nextLastIndex = itemCount - 2;
  if (activeIndex === removedIndex) return Math.max(0, removedIndex - 1);
  if (activeIndex > removedIndex) return activeIndex - 1;
  return Math.min(activeIndex, nextLastIndex);
}

export interface NormalizedBatchCreateResult {
  readonly batchId: string;
  readonly itemsTotal: number;
  readonly concurrency: number;
}

export function normalizeBatchCreateResult(
  value: unknown,
): NormalizedBatchCreateResult {
  if (!isRecord(value)) throw new Error('批量任务已提交，但结果暂时无法确认，请刷新后查看任务列表。');
  const batchId = typeof value.batchId === 'string' ? value.batchId.trim() : '';
  const itemsTotal = normalizePositiveInteger(value.itemsTotal);
  const concurrency = normalizePositiveInteger(value.concurrency);
  if (!batchId || itemsTotal == null || concurrency == null) {
    throw new Error('批量任务已提交，但结果暂时无法确认，请刷新后查看任务列表。');
  }
  return { batchId, itemsTotal, concurrency };
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

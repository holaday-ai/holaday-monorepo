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

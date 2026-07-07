export function batchUnsuccessfulCopy(
  itemsFailed: number,
  itemsCancelled?: number | null,
  itemsReview?: number | null,
): string {
  if (typeof itemsCancelled !== 'number') {
    return itemsFailed > 0 ? ` · ${itemsFailed} 未成功` : '';
  }
  const failed = Math.max(0, itemsFailed);
  const cancelled = Math.max(0, itemsCancelled);
  const review = Math.max(0, itemsReview ?? 0);
  const parts: string[] = [];
  if (review > 0) parts.push(`${review} 需复核`);
  if (failed > 0) parts.push(`${failed} 失败`);
  if (cancelled > 0) parts.push(`${cancelled} 取消`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

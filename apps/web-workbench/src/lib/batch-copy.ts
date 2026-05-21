export function batchUnsuccessfulCopy(
  itemsFailedOrCancelled: number,
  itemsCancelled?: number | null,
): string {
  if (itemsFailedOrCancelled <= 0) return '';
  if (typeof itemsCancelled !== 'number') {
    return ` · ${itemsFailedOrCancelled} 失败/取消`;
  }
  const cancelled = Math.max(0, Math.min(itemsCancelled, itemsFailedOrCancelled));
  const failed = Math.max(0, itemsFailedOrCancelled - cancelled);
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} 失败`);
  if (cancelled > 0) parts.push(`${cancelled} 取消`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

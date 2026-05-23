export function batchUnsuccessfulCopy(
  itemsFailed: number,
  itemsCancelled?: number | null,
): string {
  if (typeof itemsCancelled !== 'number') {
    return itemsFailed > 0 ? ` · ${itemsFailed} 失败/取消` : '';
  }
  const failed = Math.max(0, itemsFailed);
  const cancelled = Math.max(0, itemsCancelled);
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} 失败`);
  if (cancelled > 0) parts.push(`${cancelled} 取消`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

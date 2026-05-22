export function usageOutcomeSubcopy({
  partialSuccess,
  failed,
  cancelled,
  executing,
}: {
  partialSuccess?: number | null;
  failed: number;
  cancelled?: number | null;
  executing: number;
}): string {
  const parts: string[] = [];
  if (typeof partialSuccess === 'number' && partialSuccess > 0) {
    parts.push(`部分完成 ${Math.max(0, partialSuccess)}`);
  }
  if (typeof cancelled === 'number') {
    parts.push(`失败 ${Math.max(0, failed)}`);
    parts.push(`取消 ${Math.max(0, cancelled)}`);
  } else {
    parts.push(`失败/取消 ${Math.max(0, failed)}`);
  }
  parts.push(`进行中 ${Math.max(0, executing)}`);
  return parts.join(' · ');
}

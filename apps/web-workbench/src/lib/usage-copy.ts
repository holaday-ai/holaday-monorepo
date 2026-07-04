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
    parts.push(`需复核 ${Math.max(0, partialSuccess)}`);
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

export function usageQuotaPolicyCopy(): string {
  return '额度按任务提交计入；系统任务不计入。任务后续进入需复核、失败或取消，也会保留本次提交占用。';
}

export function usageOutcomeLoadingSubcopy(): string {
  return '需复核 — · 失败 — · 取消 — · 进行中 —';
}

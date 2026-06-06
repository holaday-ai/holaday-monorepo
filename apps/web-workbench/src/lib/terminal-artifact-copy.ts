export function terminalArtifactFallbackText({
  text,
  attachmentCount,
  finalUrl,
}: {
  text: string;
  attachmentCount?: number | null;
  finalUrl?: string | null;
}): string {
  if (text.trim().length > 0) return '';
  const parts: string[] = [];
  const count = Math.max(0, attachmentCount ?? 0);
  if (count > 0) {
    parts.push(`任务产出了 ${count} 个文件`);
  }
  const url = finalUrl?.trim();
  if (url && url !== 'about:blank' && !url.startsWith('chrome://')) {
    parts.push(`浏览器页面：${url}`);
  }
  return parts.join('\n');
}

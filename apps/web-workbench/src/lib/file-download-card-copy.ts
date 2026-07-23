export type DownloadFileKind =
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'video'
  | 'document'
  | 'generic';

export type DownloadFileAvailability =
  | 'available'
  | 'expired'
  | 'unavailable'
  | 'unknown';

export function classifyDownloadFileKind(filename: string): DownloadFileKind {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
  if (['pptx', 'ppt'].includes(ext)) return 'presentation';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (['pdf', 'docx', 'doc', 'txt', 'md', 'json'].includes(ext)) return 'document';
  return 'generic';
}

export function downloadFileKindLabel(kind: DownloadFileKind): string {
  if (kind === 'spreadsheet') return '表格文件';
  if (kind === 'presentation') return '演示文稿';
  if (kind === 'image') return '图片文件';
  if (kind === 'video') return '视频文件';
  if (kind === 'document') return '文档文件';
  return '产出文件';
}

export function downloadFileMetaLabel(options: {
  readonly filename: string;
  readonly formattedSize: string;
  readonly expiresAt?: string | Date | null;
  readonly now?: number;
  readonly availability?: DownloadFileAvailability;
}): string {
  const kind = classifyDownloadFileKind(options.filename);
  const availability =
    options.availability ?? downloadFileAvailability(options.expiresAt, options.now);
  const availabilityLabel =
    availability === 'available'
      ? '当前可下载'
      : availability === 'expired'
        ? '文件已过期'
        : availability === 'unavailable'
          ? '文件已失效'
        : '文件生成后保留 24 小时';
  return `${downloadFileKindLabel(kind)} · ${options.formattedSize} · ${availabilityLabel}`;
}

export function downloadFileAvailability(
  expiresAt: string | Date | null | undefined,
  now = Date.now(),
): DownloadFileAvailability {
  if (expiresAt == null) return 'unknown';
  const expires = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const timestamp = expires.getTime();
  if (!Number.isFinite(timestamp)) return 'unknown';
  return timestamp > now ? 'available' : 'expired';
}

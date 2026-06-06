export type DownloadFileKind =
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'document'
  | 'generic';

export function classifyDownloadFileKind(filename: string): DownloadFileKind {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
  if (['pptx', 'ppt'].includes(ext)) return 'presentation';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['pdf', 'docx', 'doc', 'txt', 'md', 'json'].includes(ext)) return 'document';
  return 'generic';
}

export function downloadFileKindLabel(kind: DownloadFileKind): string {
  if (kind === 'spreadsheet') return '表格文件';
  if (kind === 'presentation') return '演示文稿';
  if (kind === 'image') return '图片文件';
  if (kind === 'document') return '文档文件';
  return '产出文件';
}

export function downloadFileMetaLabel(options: {
  readonly filename: string;
  readonly formattedSize: string;
}): string {
  const kind = classifyDownloadFileKind(options.filename);
  return `${downloadFileKindLabel(kind)} · ${options.formattedSize} · 24 小时内可下载`;
}

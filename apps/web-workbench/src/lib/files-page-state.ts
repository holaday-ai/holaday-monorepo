export interface NormalizedFileRow {
  readonly fileId: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly sizeBytes: number;
  readonly createdAt: string | number | Date;
}

export function normalizeFileRows(value: unknown): NormalizedFileRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = normalizeFileRow(entry);
    return row ? [row] : [];
  });
}

export function formatFileRelativeDate(
  value: string | number | Date | null | undefined,
  now = new Date(),
): string {
  const date = safeFileDate(value);
  if (!date) return '—';
  const ts =
    typeof date === 'string'
      ? Date.parse(date)
      : typeof date === 'number'
        ? date
        : date.getTime();
  if (!Number.isFinite(ts)) return '—';
  const diff = now.getTime() - ts;
  const day = 24 * 3600 * 1000;
  if (diff < 0 || diff < day) return '今天';
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fileReferenceText(
  file: Pick<NormalizedFileRow, 'fileId' | 'filename' | 'mimetype' | 'sizeBytes'>,
): string {
  const filename = safeFileText(file.filename) || '未命名文件';
  const mimetype = safeFileMime(file.mimetype);
  const sizeBytes = safeFileSizeBytes(file.sizeBytes);
  return `请在任务中使用文件「${filename}」（fileId: ${file.fileId}，类型: ${mimetype}，大小: ${sizeBytes} bytes）。`;
}

function normalizeFileRow(value: unknown): NormalizedFileRow | null {
  if (!isRecord(value)) return null;
  const fileId = safeFileText(value.fileId);
  if (!fileId) return null;
  return {
    fileId,
    filename: safeFileText(value.filename) || '未命名文件',
    mimetype: safeFileMime(value.mimetype),
    sizeBytes: safeFileSizeBytes(value.sizeBytes),
    createdAt: safeFileDate(value.createdAt) ?? '',
  };
}

function safeFileMime(value: unknown): string {
  const mime = safeFileText(value).toLocaleLowerCase();
  return mime || 'application/octet-stream';
}

function safeFileSizeBytes(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

function safeFileDate(value: unknown): string | number | Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function safeFileText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

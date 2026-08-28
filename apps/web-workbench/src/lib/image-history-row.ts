import type { FileDownloadPayload } from '@/components/FileDownloadCard';
import { normaliseAttachmentDownloadUrl } from '@/lib/attachment-download-url';
import { downloadFileAvailability } from '@/lib/file-download-card-copy';
import type { ImageCreationOptions } from '@/types/image';
import type { UiTask, UiTerminalAttachment } from '@/types/task';

export type ImageHistoryFilter = 'all' | 'recent' | 'pinned';

export interface ImageHistoryRow {
  taskId: string;
  title: string | null;
  intent: string;
  status: 'completed' | 'partial_success';
  createdAt: Date;
  downloads: FileDownloadPayload[];
  imageOptions: ImageCreationOptions;
  subjectConsistency?: { checked: number; passed: number; failed: number };
  starred: boolean;
  starredAt: Date | null;
}

export interface ImageHistoryListInput {
  limit: number;
  cursor?: number;
  status: Array<'completed' | 'partial_success'>;
  starred?: true;
  dateFrom?: Date;
}

export function imageHistoryListInput(
  filter: ImageHistoryFilter,
  cursor?: number,
  now = Date.now(),
): ImageHistoryListInput {
  return {
    limit: 50,
    status: ['completed', 'partial_success'],
    ...(cursor === undefined ? {} : { cursor }),
    ...(filter === 'pinned' ? { starred: true as const } : {}),
    ...(filter === 'recent' ? { dateFrom: new Date(now - 7 * 24 * 60 * 60 * 1_000) } : {}),
  };
}

export function toImageHistoryRow(task: UiTask): ImageHistoryRow | null {
  if (task.executionMode !== 'image' || !isDownloadableImageStatus(task.status)) return null;
  if (!task.imageOptions) return null;
  const downloads = (task.attachments ?? []).flatMap((attachment) => {
    const download = imageDownload(attachment);
    return download ? [download] : [];
  });
  if (downloads.length === 0) return null;
  return {
    taskId: task.taskId,
    title: task.title,
    intent: task.intent,
    status: task.status,
    createdAt: task.createdAt,
    downloads,
    imageOptions: task.imageOptions,
    ...(task.subjectConsistency ? { subjectConsistency: task.subjectConsistency } : {}),
    starred: task.starred === true,
    starredAt: task.starredAt ?? null,
  };
}

export function imageResultActions(row: ImageHistoryRow, now = Date.now()) {
  const hasAvailableOutput = row.downloads.some(
    (download) =>
      download.unavailable !== true &&
      downloadFileAvailability(download.expiresAt, now) !== 'expired',
  );
  return {
    continueEdit: hasAvailableOutput,
    keepSubject: Boolean(row.imageOptions.subjectFileId),
    reuseSettings: true,
    download: hasAvailableOutput,
    saveToLibrary: hasAvailableOutput,
  };
}

export function imageHistoryDisplayTitle(row: ImageHistoryRow): string {
  return (
    row.title?.trim() ||
    row.imageOptions.visiblePrompt?.trim() ||
    row.intent.replace(/^生成图片[：:]\s*/u, '').trim() ||
    '图片作品'
  );
}

export function filterImageHistoryRows(
  rows: readonly ImageHistoryRow[],
  filter: ImageHistoryFilter,
  now = Date.now(),
): ImageHistoryRow[] {
  if (filter === 'pinned') return rows.filter((row) => row.starred);
  if (filter === 'recent') {
    const start = now - 7 * 24 * 60 * 60 * 1_000;
    return rows.filter((row) => row.createdAt.getTime() >= start);
  }
  return [...rows];
}

export interface ImageHistoryLoadState {
  rows: ImageHistoryRow[] | null;
  loading: boolean;
  error: boolean;
}

export type ImageHistoryLoadAction =
  | { type: 'reset' }
  | { type: 'start' }
  | { type: 'success'; rows: ImageHistoryRow[] }
  | { type: 'append'; rows: ImageHistoryRow[] }
  | { type: 'failure' }
  | {
      type: 'update_pin';
      taskId: string;
      starred: boolean;
      starredAt: Date | null;
    };

export function imageHistoryLoadReducer(
  state: ImageHistoryLoadState,
  action: ImageHistoryLoadAction,
): ImageHistoryLoadState {
  switch (action.type) {
    case 'reset':
      return { rows: null, loading: false, error: false };
    case 'start':
      return { ...state, loading: true, error: false };
    case 'success':
      return { rows: action.rows, loading: false, error: false };
    case 'append':
      return { ...state, rows: mergeImageHistoryRows(state.rows ?? [], action.rows) };
    case 'failure':
      return { ...state, loading: false, error: true };
    case 'update_pin':
      return {
        ...state,
        rows:
          state.rows?.map((row) =>
            row.taskId === action.taskId
              ? { ...row, starred: action.starred, starredAt: action.starredAt }
              : row,
          ) ?? null,
      };
  }
}

export function mergeImageHistoryRows(
  current: readonly ImageHistoryRow[],
  incoming: readonly ImageHistoryRow[],
): ImageHistoryRow[] {
  const seen = new Set(current.map(({ taskId }) => taskId));
  return [
    ...current,
    ...incoming.filter(({ taskId }) => {
      if (seen.has(taskId)) return false;
      seen.add(taskId);
      return true;
    }),
  ];
}

function imageDownload(attachment: UiTerminalAttachment): FileDownloadPayload | null {
  if (!isImageAttachment(attachment)) return null;
  const downloadUrl = normaliseAttachmentDownloadUrl(attachment.downloadUrl);
  if (!downloadUrl) return null;
  return {
    fileId: attachment.fileId,
    downloadUrl,
    filename: attachment.filename,
    size: attachment.sizeBytes,
    expiresAt: attachment.expiresAt,
    ...(attachment.availability === 'unavailable' ? { unavailable: true } : {}),
  };
}

function isDownloadableImageStatus(status: UiTask['status']): status is ImageHistoryRow['status'] {
  return status === 'completed' || status === 'partial_success';
}

function isImageAttachment(attachment: UiTerminalAttachment): boolean {
  return (
    attachment.mimetype.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(attachment.filename)
  );
}

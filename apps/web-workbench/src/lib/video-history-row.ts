import type { FileDownloadPayload } from '@/components/FileDownloadCard';

/**
 * Pure helpers for the /video 生成历史 list. Extracted from VideoPage so
 * the "only downloadable 成片 show up" filter is unit-testable without a DOM.
 */

/** Backend-stamped 成片 type (deriveVideoType in video-confirm-meta.ts). */
export type VideoType = 'normal' | 'pet' | 'ip_person';
export type CreativeHistoryMode = 'video' | 'image';
export type CreativeHistoryFilter = 'all' | 'recent' | 'pinned';

export interface VideoResultMeta {
  lane?: string;
  executionMode?: string;
  finalExecutionMode?: string;
  visualMode?: string;
  videoType?: string;
  attachments?: ReadonlyArray<{
    fileId?: string;
    downloadUrl?: string;
    filename?: string;
    mimetype?: string;
    sizeBytes?: number;
    posterUrl?: string;
  }>;
}

export interface VideoRow {
  taskId: string;
  intent: string;
  title: string | null;
  status: string;
  createdAt: string | number | Date;
  download?: FileDownloadPayload;
  /** Backend-stamped type — drives per-tab history isolation + the type chip. */
  videoType?: VideoType;
  /** First-frame poster (R2, Bearer-gated) — rendered as a lazy thumbnail. */
  posterUrl?: string;
  /** Server-persisted task pin state, reused by the creative history surface. */
  starred?: boolean;
  starredAt?: string | number | Date | null;
}

export interface CreativeHistoryLoadState {
  rows: VideoRow[] | null;
  loading: boolean;
  error: boolean;
}

export type CreativeHistoryLoadAction =
  | { type: 'reset' }
  | { type: 'start' }
  | { type: 'success'; rows: VideoRow[] }
  | { type: 'append'; rows: VideoRow[] }
  | { type: 'failure' }
  | {
      type: 'update_pin';
      taskId: string;
      starred: boolean;
      starredAt: VideoRow['starredAt'];
    };

export function creativeHistoryLoadReducer(
  state: CreativeHistoryLoadState,
  action: CreativeHistoryLoadAction,
): CreativeHistoryLoadState {
  switch (action.type) {
    case 'reset':
      return { rows: null, loading: false, error: false };
    case 'start':
      return { ...state, loading: true, error: false };
    case 'success':
      return { rows: action.rows, loading: false, error: false };
    case 'append':
      return {
        ...state,
        rows: mergeCreativeHistoryRows(state.rows ?? [], action.rows),
      };
    case 'failure':
      return { ...state, loading: false, error: true };
    case 'update_pin':
      return {
        ...state,
        rows:
          state.rows?.map((row) =>
            row.taskId === action.taskId
              ? {
                  ...row,
                  starred: action.starred,
                  starredAt: action.starredAt,
                }
              : row,
          ) ?? null,
      };
  }
}

export function mergeCreativeHistoryRows(
  current: readonly VideoRow[],
  incoming: readonly VideoRow[],
): VideoRow[] {
  const seen = new Set(current.map((row) => row.taskId));
  return [
    ...current,
    ...incoming.filter((row) => {
      if (seen.has(row.taskId)) return false;
      seen.add(row.taskId);
      return true;
    }),
  ];
}

export function nextCreativeHistoryVisibleCount(
  current: number,
  total: number,
  pageSize = 4,
): number {
  return Math.min(total, current + pageSize);
}

export function isVideoLane(lane: string | undefined): boolean {
  return typeof lane === 'string' && lane.startsWith('video_creation');
}

export function isImageLane(meta: VideoResultMeta | undefined): boolean {
  return meta?.executionMode === 'image' || meta?.finalExecutionMode === 'image';
}

/** Narrow an unknown metadata.videoType to the enum, else undefined. */
export function asVideoType(value: unknown): VideoType | undefined {
  return value === 'normal' || value === 'pet' || value === 'ip_person' ? value : undefined;
}

/**
 * Whether the 「图片版」 (confirm_image) option should show on a video_quote
 * card (B2). Static image is meaningless for 真人换口型 (you can't lip-sync a
 * still), so hide it for ip_person only — normal/pet keep it. Unknown type
 * (legacy / not-yet-hydrated) defaults to showing it (safe: only IP hides).
 */
export function showImageOption(videoType: VideoType | undefined): boolean {
  return videoType !== 'ip_person';
}

/**
 * Map a tasks.list row to a 生成历史 entry, or null to drop it.
 *
 * 生成历史显示已经产出真实文件的成片任务：`completed` / `partial_success`
 * 且带一条可下载附件。其余一律 drop：失败 / 取消 / `awaiting_user`（报价卡
 * stub，lane `video_creation_consumed`）/ `executing`（生成中）。这样失败任务
 * （如人脸检测失败的那条）和报价 stub 不再混进历史列表，同时不把“需复核但
 * 已有产物”的任务藏起来。
 */
export function toVideoRow(raw: unknown): VideoRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    taskId?: string;
    intent?: string;
    title?: string | null;
    status?: string;
    createdAt?: string | number | Date;
    starred?: boolean;
    starredAt?: string | number | Date | null;
    result?: { metadata?: VideoResultMeta } | null;
  };
  const meta = r.result?.metadata;
  if (!isVideoLane(meta?.lane)) return null;
  if (!r.taskId || !r.status) return null;
  if (!isDownloadableTerminalOutput(r.status)) return null;
  const att = meta?.attachments?.find(
    (a) => a.fileId && a.downloadUrl && a.filename && typeof a.sizeBytes === 'number',
  );
  if (!att?.fileId || !att.downloadUrl || !att.filename || typeof att.sizeBytes !== 'number') {
    return null;
  }
  const downloadUrl = normaliseAttachmentDownloadUrl(att.downloadUrl);
  if (!downloadUrl) return null;
  const videoType = asVideoType(meta?.videoType);
  const posterUrl =
    typeof att.posterUrl === 'string' && att.posterUrl.length > 0
      ? normaliseAttachmentDownloadUrl(att.posterUrl) ?? undefined
      : undefined;
  return {
    taskId: r.taskId,
    intent: r.intent ?? '',
    title: r.title ?? null,
    status: r.status,
    createdAt: r.createdAt ?? new Date(),
    download: {
      fileId: att.fileId,
      downloadUrl,
      filename: att.filename,
      size: att.sizeBytes,
    },
    ...(videoType ? { videoType } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    starred: r.starred === true,
    starredAt: r.starredAt ?? null,
  };
}

export function toImageRow(raw: unknown): VideoRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    taskId?: string;
    intent?: string;
    title?: string | null;
    status?: string;
    createdAt?: string | number | Date;
    starred?: boolean;
    starredAt?: string | number | Date | null;
    result?: { metadata?: VideoResultMeta } | null;
  };
  const meta = r.result?.metadata;
  if (!isImageLane(meta)) return null;
  if (!r.taskId || !r.status || !isDownloadableTerminalOutput(r.status)) return null;
  const att = meta?.attachments?.find((a) => {
    if (!a.fileId || !a.downloadUrl || !a.filename || typeof a.sizeBytes !== 'number') return false;
    if (typeof a.mimetype === 'string' && a.mimetype.startsWith('image/')) return true;
    return /\.(png|jpe?g|webp|gif)$/i.test(a.filename);
  });
  if (!att?.fileId || !att.downloadUrl || !att.filename || typeof att.sizeBytes !== 'number') {
    return null;
  }
  const downloadUrl = normaliseAttachmentDownloadUrl(att.downloadUrl);
  if (!downloadUrl) return null;
  return {
    taskId: r.taskId,
    intent: r.intent ?? '',
    title: r.title ?? null,
    status: r.status,
    createdAt: r.createdAt ?? new Date(),
    download: {
      fileId: att.fileId,
      downloadUrl,
      filename: att.filename,
      size: att.sizeBytes,
    },
    posterUrl: downloadUrl,
    starred: r.starred === true,
    starredAt: r.starredAt ?? null,
  };
}

export function filterCreativeHistoryRows(
  rows: readonly VideoRow[],
  {
    mode,
    videoType,
    filter,
    now = Date.now(),
  }: {
    mode: CreativeHistoryMode;
    videoType?: VideoType;
    filter: CreativeHistoryFilter;
    now?: number;
  },
): VideoRow[] {
  const scopedRows = rows.filter((row) => {
    const filename = row.download?.filename ?? '';
    const imageFile = /\.(png|jpe?g|webp|gif)$/i.test(filename);
    return mode === 'image'
      ? imageFile
      : !imageFile && (row.videoType ?? 'normal') === videoType;
  });
  if (filter === 'recent') {
    return scopedRows.filter((row) => isRecentCreativeHistoryRow(row.createdAt, now));
  }
  if (filter === 'pinned') return scopedRows.filter((row) => row.starred === true);
  return scopedRows;
}

export function creativeHistoryDisplayTitle(
  row: Pick<VideoRow, 'title' | 'intent'>,
  mode: CreativeHistoryMode,
): string {
  const source = row.title?.trim() || row.intent.trim();
  if (mode !== 'image') return source || '视频作品';
  const withoutInternalInstructions = source.split(/主体一致性要求[：:]/u, 1)[0]?.trim() ?? '';
  const withoutLanePrefix = withoutInternalInstructions
    .replace(/^生成(?:一张)?图片[：:]\s*/u, '')
    .trim();
  return withoutLanePrefix || '图片作品';
}

export function isLockedSubjectImageIntent(intent: string): boolean {
  return /主体一致性要求[：:]/u.test(intent);
}

function isDownloadableTerminalOutput(status: string): boolean {
  return status === 'completed' || status === 'partial_success';
}

function isRecentCreativeHistoryRow(
  value: string | number | Date,
  now: number,
): boolean {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return now - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

function normaliseAttachmentDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\/api\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return trimmed;
  if (/^\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return `/api${trimmed}`;
  return null;
}

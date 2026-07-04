import type { FileDownloadPayload } from '@/components/FileDownloadCard';

/**
 * Pure helpers for the /video 生成历史 list. Extracted from VideoPage so
 * the "only downloadable 成片 show up" filter is unit-testable without a DOM.
 */

/** Backend-stamped 成片 type (deriveVideoType in video-confirm-meta.ts). */
export type VideoType = 'normal' | 'pet' | 'ip_person';

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
  };
}

function isDownloadableTerminalOutput(status: string): boolean {
  return status === 'completed' || status === 'partial_success';
}

function normaliseAttachmentDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\/api\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return trimmed;
  if (/^\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return `/api${trimmed}`;
  return null;
}

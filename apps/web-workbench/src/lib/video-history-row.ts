import type { FileDownloadPayload } from '@/components/FileDownloadCard';

/**
 * Pure helpers for the /video 生成历史 list. Extracted from VideoPage so
 * the "only successful 成片 show up" filter is unit-testable without a DOM.
 */

export interface VideoResultMeta {
  lane?: string;
  visualMode?: string;
  attachments?: ReadonlyArray<{
    fileId?: string;
    downloadUrl?: string;
    filename?: string;
    sizeBytes?: number;
  }>;
}

export interface VideoRow {
  taskId: string;
  intent: string;
  title: string | null;
  status: string;
  createdAt: string | number | Date;
  download?: FileDownloadPayload;
}

export function isVideoLane(lane: string | undefined): boolean {
  return typeof lane === 'string' && lane.startsWith('video_creation');
}

/**
 * Map a tasks.list row to a 生成历史 entry, or null to drop it.
 *
 * 生成历史只显示**成功出片**的成片任务：`status==='completed'` 且带一条可
 * 下载的附件。其余一律 drop：失败 / 取消 / `awaiting_user`（报价卡 stub，
 * lane `video_creation_consumed`）/ `executing`（生成中）。这样失败任务
 * （如人脸检测失败的那条）和报价 stub 不再混进历史列表。
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
  // 只收成功出片的成片。
  if (r.status !== 'completed') return null;
  const att = meta?.attachments?.find(
    (a) => a.fileId && a.downloadUrl && a.filename && typeof a.sizeBytes === 'number',
  );
  if (!att?.fileId || !att.downloadUrl || !att.filename || typeof att.sizeBytes !== 'number') {
    return null;
  }
  return {
    taskId: r.taskId,
    intent: r.intent ?? '',
    title: r.title ?? null,
    status: r.status,
    createdAt: r.createdAt ?? new Date(),
    download: {
      fileId: att.fileId,
      downloadUrl: att.downloadUrl,
      filename: att.filename,
      size: att.sizeBytes,
    },
  };
}

import type { FileDownloadPayload } from '@/components/FileDownloadCard';
import type { UiTask, UiTerminalAttachment } from '@/types/task';

export interface ImageHistoryRow {
  taskId: string;
  title: string | null;
  intent: string;
  status: 'completed' | 'partial_success';
  createdAt: Date;
  download: FileDownloadPayload;
}

export function toImageHistoryRow(task: UiTask): ImageHistoryRow | null {
  if (!isDownloadableImageStatus(task.status)) return null;
  const imageAttachment = task.attachments?.find(isImageAttachment);
  if (!imageAttachment) return null;
  const looksLikeImageLane =
    task.executionMode === 'image' ||
    task.intent.includes('生成一张图片') ||
    task.intent.includes('图生图') ||
    task.intent.includes('图片编辑');
  if (!looksLikeImageLane) return null;
  return {
    taskId: task.taskId,
    title: task.title,
    intent: task.intent,
    status: task.status,
    createdAt: task.createdAt,
    download: {
      fileId: imageAttachment.fileId,
      downloadUrl: imageAttachment.downloadUrl,
      filename: imageAttachment.filename,
      size: imageAttachment.sizeBytes,
      expiresAt: imageAttachment.expiresAt,
      ...(imageAttachment.availability === 'unavailable'
        ? { unavailable: true }
        : {}),
    },
  };
}

function isDownloadableImageStatus(
  status: UiTask['status'],
): status is ImageHistoryRow['status'] {
  return status === 'completed' || status === 'partial_success';
}

function isImageAttachment(attachment: UiTerminalAttachment): boolean {
  return (
    attachment.mimetype.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(attachment.filename)
  );
}

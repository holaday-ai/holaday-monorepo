import { formatFileSize } from './file-size.js';

export type AttachmentChipTone = 'loading' | 'ready' | 'error';

export interface AttachmentChipCopyInput {
  readonly filename: string;
  readonly size: number;
  readonly status: 'uploading' | 'ready' | 'error';
  readonly errorMessage?: string;
}

export interface AttachmentChipCopy {
  readonly tone: AttachmentChipTone;
  readonly statusText: string;
  readonly detailText: string;
  readonly title: string;
  readonly removeLabel: string;
}

export function attachmentChipCopy(input: AttachmentChipCopyInput): AttachmentChipCopy {
  const filename = input.filename.trim() || '未命名附件';
  if (input.status === 'error') {
    const detailText = input.errorMessage?.trim() || '上传失败，请移除后重试';
    return {
      tone: 'error',
      statusText: '上传失败',
      detailText,
      title: `${filename} · ${detailText}`,
      removeLabel: `移除附件：${filename}`,
    };
  }

  if (input.status === 'uploading') {
    return {
      tone: 'loading',
      statusText: '上传中',
      detailText: '正在上传',
      title: `${filename} · 上传中`,
      removeLabel: `移除附件：${filename}`,
    };
  }

  const detailText = formatFileSize(input.size);
  return {
    tone: 'ready',
    statusText: '已就绪',
    detailText,
    title: `${filename} · ${detailText}`,
    removeLabel: `移除附件：${filename}`,
  };
}

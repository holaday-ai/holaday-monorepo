import { describe, expect, it } from 'vitest';
import { attachmentChipCopy } from './attachment-chip-copy.js';

describe('attachment-chip-copy', () => {
  it('shows ready attachments with compact file size', () => {
    expect(
      attachmentChipCopy({
        filename: 'report.csv',
        size: 2048,
        status: 'ready',
      }),
    ).toEqual({
      tone: 'ready',
      statusText: '已就绪',
      detailText: '2 KB',
      title: 'report.csv · 2 KB',
      removeLabel: '移除附件：report.csv',
    });
  });

  it('labels uploading attachments clearly', () => {
    expect(
      attachmentChipCopy({
        filename: 'photo.png',
        size: 900,
        status: 'uploading',
      }),
    ).toMatchObject({
      tone: 'loading',
      statusText: '上传中',
      detailText: '正在上传',
      title: 'photo.png · 上传中',
    });
  });

  it('surfaces upload error details with a fallback', () => {
    expect(
      attachmentChipCopy({
        filename: 'huge.pdf',
        size: 1,
        status: 'error',
        errorMessage: '文件超过 20MB 上限',
      }),
    ).toMatchObject({
      tone: 'error',
      statusText: '上传失败',
      detailText: '文件超过 20MB 上限',
      title: 'huge.pdf · 文件超过 20MB 上限',
    });

    expect(
      attachmentChipCopy({
        filename: '',
        size: 1,
        status: 'error',
      }).removeLabel,
    ).toBe('移除附件：未命名附件');
  });
});

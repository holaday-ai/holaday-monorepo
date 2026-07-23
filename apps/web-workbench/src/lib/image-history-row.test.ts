import { describe, expect, it } from 'vitest';
import { toImageHistoryRow } from './image-history-row';
import type { UiTask } from '@/types/task';

const imageAttachment = {
  fileId: 'file_img',
  downloadUrl: '/api/files/file_img/download',
  filename: 'holaday-image.jpg',
  mimetype: 'image/jpeg',
  sizeBytes: 418_513,
  expiresAt: '2026-07-02T00:00:00.000Z',
  kind: 'output',
};

function task(overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId: 'tsk_image',
    intent: '生成一张图片：HOLA DAY 产品插画',
    title: null,
    status: 'completed',
    tickCount: 0,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    executionMode: 'image',
    attachments: [imageAttachment],
    ...overrides,
  };
}

describe('toImageHistoryRow', () => {
  it('keeps completed image outputs with a downloadable attachment', () => {
    const row = toImageHistoryRow(task({ title: '产品插画' }));
    expect(row).toMatchObject({
      taskId: 'tsk_image',
      title: '产品插画',
      status: 'completed',
      download: {
        fileId: 'file_img',
        downloadUrl: '/api/files/file_img/download',
        filename: 'holaday-image.jpg',
        size: 418_513,
        expiresAt: '2026-07-02T00:00:00.000Z',
      },
    });
  });

  it('keeps review-needed image outputs when the artifact exists', () => {
    const row = toImageHistoryRow(task({ status: 'partial_success' }));
    expect(row?.status).toBe('partial_success');
    expect(row?.download.filename).toBe('holaday-image.jpg');
  });

  it('preserves server-confirmed unavailability for the history card', () => {
    const row = toImageHistoryRow(
      task({
        attachments: [
          { ...imageAttachment, availability: 'unavailable' },
        ],
      }),
    );

    expect(row?.download.unavailable).toBe(true);
  });

  it('drops failed, running, non-image, and missing-artifact rows', () => {
    expect(toImageHistoryRow(task({ status: 'failed' }))).toBeNull();
    expect(toImageHistoryRow(task({ status: 'executing' }))).toBeNull();
    expect(toImageHistoryRow(task({ executionMode: 'browser', intent: '帮我查资料' }))).toBeNull();
    expect(toImageHistoryRow(task({ attachments: [] }))).toBeNull();
  });

  it('accepts image filenames when mimetype is generic', () => {
    const row = toImageHistoryRow(
      task({
        attachments: [{ ...imageAttachment, mimetype: 'application/octet-stream', filename: 'out.webp' }],
      }),
    );
    expect(row?.download.filename).toBe('out.webp');
  });
});

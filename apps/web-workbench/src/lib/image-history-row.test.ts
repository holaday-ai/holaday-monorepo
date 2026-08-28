import type { UiTask } from '@/types/task';
import { describe, expect, it } from 'vitest';
import {
  imageHistoryLoadReducer,
  imageResultActions,
  mergeImageHistoryRows,
  toImageHistoryRow,
} from './image-history-row';

const imageAttachment = {
  fileId: 'file_img_1',
  downloadUrl: '/api/files/file_img_1/download',
  filename: 'holaday-image-1.jpg',
  mimetype: 'image/jpeg',
  sizeBytes: 418_513,
  expiresAt: '2026-09-02T00:00:00.000Z',
  kind: 'output',
};

function task(overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId: 'tsk_image',
    intent: '生成图片：把背景换成海边',
    title: null,
    status: 'completed',
    tickCount: 0,
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    executionMode: 'image',
    starred: false,
    starredAt: null,
    imageOptions: {
      goal: 'lock_subject',
      mode: 'lock_subject',
      model: 'nano_banana_pro',
      style: 'vibrant',
      aspectRatio: '3:4',
      imageCount: 2,
      subjectFileId: 'file_subject',
      changeTargets: ['background'],
      visiblePrompt: '把背景换成海边',
    },
    subjectConsistency: { checked: 2, passed: 1, failed: 1 },
    attachments: [
      imageAttachment,
      {
        ...imageAttachment,
        fileId: 'file_img_2',
        downloadUrl: '/api/files/file_img_2/download',
        filename: 'holaday-image-2.webp',
        mimetype: 'image/webp',
      },
    ],
    ...overrides,
  };
}

function mappedRow(overrides: Partial<UiTask> = {}) {
  const row = toImageHistoryRow(task(overrides));
  if (!row) throw new Error('expected image history row');
  return row;
}

describe('toImageHistoryRow', () => {
  it('keeps every valid image output in server order with truthful task metadata', () => {
    const row = toImageHistoryRow(task({ title: '海边主角图', starred: true }));

    expect(row).toMatchObject({
      taskId: 'tsk_image',
      title: '海边主角图',
      status: 'completed',
      starred: true,
      imageOptions: {
        goal: 'lock_subject',
        mode: 'lock_subject',
        style: 'vibrant',
        visiblePrompt: '把背景换成海边',
      },
      subjectConsistency: { checked: 2, passed: 1, failed: 1 },
      downloads: [
        { fileId: 'file_img_1', filename: 'holaday-image-1.jpg' },
        { fileId: 'file_img_2', filename: 'holaday-image-2.webp' },
      ],
    });
  });

  it('keeps the real output count for partial success without inventing missing images', () => {
    const row = toImageHistoryRow(
      task({ status: 'partial_success', attachments: [imageAttachment] }),
    );

    expect(row?.status).toBe('partial_success');
    expect(row?.downloads).toHaveLength(1);
    expect(row?.imageOptions.imageCount).toBe(2);
  });

  it('preserves server-confirmed unavailability per output', () => {
    const row = toImageHistoryRow(
      task({ attachments: [{ ...imageAttachment, availability: 'unavailable' }] }),
    );

    expect(row?.downloads[0]?.unavailable).toBe(true);
  });

  it('drops non-image lanes, non-terminal rows, missing metadata, and missing artifacts', () => {
    expect(toImageHistoryRow(task({ status: 'failed' }))).toBeNull();
    expect(toImageHistoryRow(task({ status: 'executing' }))).toBeNull();
    expect(toImageHistoryRow(task({ executionMode: 'browser' }))).toBeNull();
    expect(toImageHistoryRow(task({ imageOptions: undefined }))).toBeNull();
    expect(toImageHistoryRow(task({ attachments: [] }))).toBeNull();
  });

  it('accepts image filenames when mimetype is generic and rejects unsafe URLs', () => {
    const row = toImageHistoryRow(
      task({
        attachments: [
          {
            ...imageAttachment,
            mimetype: 'application/octet-stream',
            filename: 'out.webp',
          },
          {
            ...imageAttachment,
            fileId: 'file_bad',
            downloadUrl: 'https://evil.example/out.png',
          },
        ],
      }),
    );
    expect(row?.downloads.map(({ filename }) => filename)).toEqual(['out.webp']);
  });
});

describe('image result actions', () => {
  it('keeps subject/settings actions when the output expired but disables stale output actions', () => {
    const row = mappedRow();
    row.downloads = row.downloads.map((download) => ({
      ...download,
      expiresAt: '2026-08-27T00:00:00.000Z',
    }));

    expect(imageResultActions(row, Date.parse('2026-08-28T00:00:00.000Z'))).toEqual({
      continueEdit: false,
      keepSubject: true,
      reuseSettings: true,
      download: false,
      saveToLibrary: false,
    });
  });

  it('disables subject reuse only when no subject was persisted', () => {
    const row = mappedRow({
      imageOptions: {
        model: 'nano_banana_pro',
        style: 'vibrant',
        aspectRatio: '3:4',
        imageCount: 2,
        goal: 'lock_subject',
        mode: 'lock_subject',
        changeTargets: ['background'],
        visiblePrompt: '把背景换成海边',
      },
    });

    expect(imageResultActions(row, Date.parse('2026-08-28T00:00:00.000Z'))).toMatchObject({
      continueEdit: true,
      keepSubject: false,
      reuseSettings: true,
      download: true,
    });
  });
});

describe('image history state', () => {
  it('deduplicates task rows across paginated scans', () => {
    const first = mappedRow();
    const second = { ...first, taskId: 'tsk_second' };
    expect(mergeImageHistoryRows([first], [first, second]).map(({ taskId }) => taskId)).toEqual([
      'tsk_image',
      'tsk_second',
    ]);
  });

  it('keeps the last successful rows when a refresh fails and rolls back an optimistic pin', () => {
    const row = mappedRow();
    const loaded = imageHistoryLoadReducer(
      { rows: null, loading: false, error: false },
      { type: 'success', rows: [row] },
    );
    const pinned = imageHistoryLoadReducer(loaded, {
      type: 'update_pin',
      taskId: row.taskId,
      starred: true,
      starredAt: new Date('2026-08-28T01:00:00.000Z'),
    });
    const rolledBack = imageHistoryLoadReducer(pinned, {
      type: 'update_pin',
      taskId: row.taskId,
      starred: false,
      starredAt: null,
    });
    const failed = imageHistoryLoadReducer(rolledBack, { type: 'failure' });

    expect(failed.rows?.[0]).toMatchObject({ taskId: row.taskId, starred: false });
    expect(failed.error).toBe(true);
  });
});

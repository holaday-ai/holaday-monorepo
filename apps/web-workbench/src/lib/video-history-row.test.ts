import { describe, expect, it } from 'vitest';
import { isVideoLane, toVideoRow } from './video-history-row';

const ATT = {
  fileId: 'file_x',
  downloadUrl: '/api/files/file_x/download',
  filename: 'holaday-video.mp4',
  sizeBytes: 6_000_000,
};

function row(over: Record<string, unknown> = {}): unknown {
  return {
    taskId: 'tsk_1',
    intent: '夏天防晒',
    title: null,
    status: 'completed',
    createdAt: '2026-06-19T00:00:00.000Z',
    result: { metadata: { lane: 'video_creation', attachments: [ATT] } },
    ...over,
  };
}

describe('isVideoLane', () => {
  it('matches video_creation* lanes only', () => {
    expect(isVideoLane('video_creation')).toBe(true);
    expect(isVideoLane('video_creation_consumed')).toBe(true);
    expect(isVideoLane('generate')).toBe(false);
    expect(isVideoLane(undefined)).toBe(false);
  });
});

describe('toVideoRow — 生成历史 only lists completed 成片 with an attachment', () => {
  it('completed + valid attachment → row carrying the download', () => {
    const out = toVideoRow(row());
    expect(out).not.toBeNull();
    expect(out?.taskId).toBe('tsk_1');
    expect(out?.download).toEqual({
      fileId: 'file_x',
      downloadUrl: '/api/files/file_x/download',
      filename: 'holaday-video.mp4',
      size: 6_000_000,
    });
  });

  it('DROPS failed (the face-detection failure no longer pollutes history)', () => {
    expect(toVideoRow(row({ status: 'failed', result: { metadata: { lane: 'video_creation' } } }))).toBeNull();
  });

  it('DROPS cancelled', () => {
    expect(toVideoRow(row({ status: 'cancelled' }))).toBeNull();
  });

  it('DROPS awaiting_user 报价 stub (lane video_creation_consumed, no attachment)', () => {
    expect(
      toVideoRow({
        taskId: 'tsk_q',
        status: 'awaiting_user',
        result: { metadata: { lane: 'video_creation_consumed' } },
      }),
    ).toBeNull();
  });

  it('DROPS executing (still generating)', () => {
    expect(toVideoRow(row({ status: 'executing', result: { metadata: { lane: 'video_creation' } } }))).toBeNull();
  });

  it('DROPS completed but NO attachment', () => {
    expect(toVideoRow(row({ result: { metadata: { lane: 'video_creation', attachments: [] } } }))).toBeNull();
    expect(toVideoRow(row({ result: { metadata: { lane: 'video_creation' } } }))).toBeNull();
  });

  it('DROPS completed attachment missing sizeBytes (incomplete payload)', () => {
    const bad = { fileId: 'f', downloadUrl: '/api/files/f/download', filename: 'v.mp4' };
    expect(toVideoRow(row({ result: { metadata: { lane: 'video_creation', attachments: [bad] } } }))).toBeNull();
  });

  it('DROPS non-video lane even when completed with an attachment', () => {
    expect(toVideoRow(row({ result: { metadata: { lane: 'generate', attachments: [ATT] } } }))).toBeNull();
  });

  it('DROPS junk input', () => {
    expect(toVideoRow(null)).toBeNull();
    expect(toVideoRow('nope')).toBeNull();
    expect(toVideoRow({})).toBeNull();
  });
});

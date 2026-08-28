import { describe, expect, it, vi } from 'vitest';
import {
  canCombineVideoRows,
  canContinueEditing,
  createVideoEditingProject,
  type VideoEditingEntryArtifact,
} from './video-edit-entry';

const ACTIVE_VIDEO: VideoEditingEntryArtifact = {
  fileId: 'file_video',
  mimetype: 'video/mp4',
  availability: 'active',
  expiresAt: '2026-08-29T00:00:00.000Z',
};

describe('canContinueEditing', () => {
  const now = Date.parse('2026-08-28T00:00:00.000Z');

  it('shows only for enabled, active, downloadable terminal videos', () => {
    expect(
      canContinueEditing({ capabilityEnabled: true, artifact: ACTIVE_VIDEO, taskStatus: 'completed', now }),
    ).toBe(true);
    expect(
      canContinueEditing({ capabilityEnabled: true, artifact: ACTIVE_VIDEO, taskStatus: 'partial_success', now }),
    ).toBe(true);
  });

  it('hides failed, expired, unavailable, non-video, and gated artifacts', () => {
    expect(
      canContinueEditing({ capabilityEnabled: false, artifact: ACTIVE_VIDEO, taskStatus: 'completed', now }),
    ).toBe(false);
    expect(
      canContinueEditing({ capabilityEnabled: true, artifact: ACTIVE_VIDEO, taskStatus: 'failed', now }),
    ).toBe(false);
    expect(
      canContinueEditing({
        capabilityEnabled: true,
        artifact: { ...ACTIVE_VIDEO, expiresAt: '2026-08-27T23:59:59.000Z' },
        taskStatus: 'completed',
        now,
      }),
    ).toBe(false);
    expect(
      canContinueEditing({
        capabilityEnabled: true,
        artifact: { ...ACTIVE_VIDEO, availability: 'unavailable' },
        taskStatus: 'completed',
        now,
      }),
    ).toBe(false);
    expect(
      canContinueEditing({
        capabilityEnabled: true,
        artifact: { ...ACTIVE_VIDEO, mimetype: 'image/png' },
        taskStatus: 'completed',
        now,
      }),
    ).toBe(false);
  });
});

describe('canCombineVideoRows', () => {
  it('preserves selection order for distinct compatible videos', () => {
    expect(
      canCombineVideoRows([
        { ...ACTIVE_VIDEO, fileId: 'file_b' },
        { ...ACTIVE_VIDEO, fileId: 'file_a' },
      ]),
    ).toEqual({
      compatible: true,
      sourceFileIds: ['file_b', 'file_a'],
      reason: null,
    });
  });

  it('returns an explainable reason for too few, duplicate, or unsupported selections', () => {
    expect(canCombineVideoRows([ACTIVE_VIDEO])).toMatchObject({
      compatible: false,
      reason: '至少选择 2 段视频',
    });
    expect(canCombineVideoRows([ACTIVE_VIDEO, ACTIVE_VIDEO])).toMatchObject({
      compatible: false,
      reason: '不能重复选择同一段视频',
    });
    expect(
      canCombineVideoRows([ACTIVE_VIDEO, { ...ACTIVE_VIDEO, fileId: 'file_mov', codec: 'unsupported' }]),
    ).toMatchObject({ compatible: false, reason: '所选视频包含暂不支持的编码' });
  });
});

describe('createVideoEditingProject', () => {
  it('uses the server result as the only navigation id', async () => {
    const create = vi.fn().mockResolvedValue({ project: { id: 'ved_server' } });
    await expect(
      createVideoEditingProject({ sourceFileIds: ['file_a', 'file_b'], create }),
    ).resolves.toEqual({ projectId: 'ved_server' });
    expect(create).toHaveBeenCalledWith({ sourceFileIds: ['file_a', 'file_b'] });
  });
});

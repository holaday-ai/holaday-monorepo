import { describe, expect, it, vi } from 'vitest';
import type { MediaIntegrityReport } from '../../agent/video/ffmpeg-exec.js';
import {
  enrollMimeFor,
  resolveOnboardingStatus,
  validateBaseVideoReport,
} from './video-onboarding.js';

describe('enrollMimeFor — onboarding 语音样本格式闸 (Phase 3 阶段1)', () => {
  it('maps WAV variants → audio/wav', () => {
    expect(enrollMimeFor('audio/wav')).toBe('audio/wav');
    expect(enrollMimeFor('audio/x-wav')).toBe('audio/wav');
    expect(enrollMimeFor('audio/wave')).toBe('audio/wav');
    expect(enrollMimeFor('AUDIO/WAV')).toBe('audio/wav'); // case-insensitive
  });

  it('maps MP3 → audio/mpeg, M4A variants → audio/mp4', () => {
    expect(enrollMimeFor('audio/mpeg')).toBe('audio/mpeg');
    expect(enrollMimeFor('audio/mp3')).toBe('audio/mpeg');
    expect(enrollMimeFor('audio/mp4')).toBe('audio/mp4');
    expect(enrollMimeFor('audio/x-m4a')).toBe('audio/mp4');
  });

  it('rejects unsupported types (aac/ogg/video) → null', () => {
    expect(enrollMimeFor('audio/aac')).toBeNull(); // Qwen clone 仅 WAV/MP3/M4A
    expect(enrollMimeFor('audio/ogg')).toBeNull();
    expect(enrollMimeFor('video/mp4')).toBeNull();
    expect(enrollMimeFor('image/png')).toBeNull();
  });
});

describe('resolveOnboardingStatus — durable asset readiness', () => {
  it('does not report a stale base-video id as ready', async () => {
    const isReadableForUser = vi.fn(async () => false);

    await expect(
      resolveOnboardingStatus(
        {
          id: 7,
          qwenVoiceId: 'voice_ready',
          baseVideoFileId: 'file_stale',
          videoSelfUseAuthorizedAt: new Date('2026-07-28T00:00:00.000Z'),
        },
        { isReadableForUser },
      ),
    ).resolves.toMatchObject({
      hasVoice: true,
      hasBaseVideo: false,
      authorized: true,
    });
    expect(isReadableForUser).toHaveBeenCalledWith('file_stale', 7);
  });

  it('reports a base video ready only when the stored object is readable', async () => {
    const isReadableForUser = vi.fn(async () => true);

    await expect(
      resolveOnboardingStatus(
        {
          id: 7,
          qwenVoiceId: null,
          baseVideoFileId: 'file_ready',
          videoSelfUseAuthorizedAt: null,
        },
        { isReadableForUser },
      ),
    ).resolves.toEqual({
      hasVoice: false,
      hasBaseVideo: true,
      authorized: false,
      authorizedAt: null,
      baseVideoIssue: null,
    });
  });
});

describe('validateBaseVideoReport — reject unusable IP base before retention', () => {
  const movingBase: MediaIntegrityReport = {
    durationMs: 9_000,
    hasVideo: true,
    hasAudio: true,
    frozenRatio: 0.12,
    audioMeanVolumeDb: -24,
    audioMaxVolumeDb: -8,
  };

  it('accepts a 2–60 second video with visible motion', () => {
    expect(validateBaseVideoReport(movingBase)).toBeNull();
  });

  it('rejects a still-image video before it can be marked ready', () => {
    expect(
      validateBaseVideoReport({
        ...movingBase,
        frozenRatio: 0.99,
      }),
    ).toBe('出镜底版几乎全程静止，请上传有眨眼、说话或肢体动作的视频');
  });

  it('rejects missing video and out-of-range duration with actionable copy', () => {
    expect(validateBaseVideoReport({ ...movingBase, hasVideo: false })).toBe(
      '无法识别出镜底版中的视频画面，请重新上传 MP4 / MOV 文件',
    );
    expect(validateBaseVideoReport({ ...movingBase, durationMs: 1_999 })).toBe(
      '本人出镜底版需为 2 到 60 秒的视频',
    );
    expect(validateBaseVideoReport({ ...movingBase, durationMs: 60_001 })).toBe(
      '本人出镜底版需为 2 到 60 秒的视频',
    );
  });
});

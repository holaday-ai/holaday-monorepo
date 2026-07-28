import { describe, expect, it, vi } from 'vitest';
import {
  probeCloneReferenceDurationSeconds,
  probeCloneReferenceQuoteFacts,
} from './video-clone-reference.js';

describe('probeCloneReferenceDurationSeconds', () => {
  it('uses server-probed media duration for pricing', async () => {
    const probe = vi.fn(async () => 8_240);
    await expect(
      probeCloneReferenceDurationSeconds('https://storage.example/reference.mp4', probe),
    ).resolves.toBe(8.2);
    expect(probe).toHaveBeenCalledWith('https://storage.example/reference.mp4');
  });

  it('rejects media outside the provider 2-30 second window', async () => {
    await expect(
      probeCloneReferenceDurationSeconds('https://storage.example/short.mp4', async () => 1_900),
    ).rejects.toThrow(/2.*30/);
    await expect(
      probeCloneReferenceDurationSeconds('https://storage.example/long.mp4', async () => 30_100),
    ).rejects.toThrow(/2.*30/);
  });
});

describe('probeCloneReferenceQuoteFacts', () => {
  it('returns the measured duration and audible-audio fact used by the quote', async () => {
    const probe = vi.fn(async () => ({
      durationMs: 8_240,
      hasVideo: true,
      hasAudio: true,
      frozenRatio: 0.1,
      audioMeanVolumeDb: -21,
      audioMaxVolumeDb: -7,
    }));

    await expect(
      probeCloneReferenceQuoteFacts('https://storage.example/reference.mp4', probe),
    ).resolves.toEqual({
      durationSeconds: 8.2,
      hasAudibleAudio: true,
    });
  });

  it('does not bill lip-sync for a silent audio track', async () => {
    await expect(
      probeCloneReferenceQuoteFacts('https://storage.example/reference.mp4', async () => ({
        durationMs: 8_240,
        hasVideo: true,
        hasAudio: true,
        frozenRatio: 0.1,
        audioMeanVolumeDb: -80,
        audioMaxVolumeDb: -60,
      })),
    ).resolves.toEqual({
      durationSeconds: 8.2,
      hasAudibleAudio: false,
    });
  });
});

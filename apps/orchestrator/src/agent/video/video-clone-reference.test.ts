import { describe, expect, it, vi } from 'vitest';
import { probeCloneReferenceDurationSeconds } from './video-clone-reference.js';

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

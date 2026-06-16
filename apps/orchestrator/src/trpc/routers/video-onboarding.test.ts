import { describe, expect, it } from 'vitest';
import { enrollMimeFor } from './video-onboarding.js';

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

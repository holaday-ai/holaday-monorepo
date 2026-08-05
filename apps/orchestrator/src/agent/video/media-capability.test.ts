import { describe, expect, it } from 'vitest';
import { mediaCapabilityIssue } from './media-capability.js';

const ready = {
  hasDashscope: true,
  hasFal: true,
  hasGemini: true,
};

describe('mediaCapabilityIssue', () => {
  it('requires Gemini for explicit image generation', () => {
    expect(
      mediaCapabilityIssue({ kind: 'image' }, { ...ready, hasGemini: false }),
    ).toContain('图片生成服务');
  });

  it('requires the provider selected by a normal video task', () => {
    expect(
      mediaCapabilityIssue(
        { kind: 'video', tab: 'normal', model: 'veo_fast' },
        { ...ready, hasGemini: false },
      ),
    ).toContain('Veo');
    expect(
      mediaCapabilityIssue(
        { kind: 'video', tab: 'normal', model: 'happyhorse' },
        { ...ready, hasDashscope: false },
      ),
    ).toContain('Happy Horse');
    expect(
      mediaCapabilityIssue(
        { kind: 'video', tab: 'normal', model: 'wanxiang' },
        { ...ready, hasDashscope: false },
      ),
    ).toContain('Wan');
  });

  it('requires generation and lip-sync providers for clone and IP video', () => {
    expect(
      mediaCapabilityIssue(
        { kind: 'video', tab: 'pet', model: 'happyhorse' },
        { ...ready, hasFal: false },
      ),
    ).toContain('复刻视频');
    expect(
      mediaCapabilityIssue(
        { kind: 'video', tab: 'ip_person', model: 'happyhorse' },
        { ...ready, hasDashscope: false },
      ),
    ).toContain('IP 人物视频');
  });

  it('requires Gemini when a video quote is confirmed as an image', () => {
    expect(
      mediaCapabilityIssue(
        { kind: 'video_confirmation', choice: 'image' },
        { ...ready, hasGemini: false },
      ),
    ).toContain('图片版');
  });

  it('returns null when the selected lane is ready', () => {
    expect(
      mediaCapabilityIssue({ kind: 'video', tab: 'normal', model: 'veo_standard' }, ready),
    ).toBeNull();
  });
});

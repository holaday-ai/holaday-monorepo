import { describe, expect, it } from 'vitest';
import { mediaCapabilityIssue } from './media-capability.js';

const ready = {
  hasDashscope: true,
  hasFal: true,
  hasGemini: true,
};

describe('mediaCapabilityIssue', () => {
  it('requires a production image provider (DashScope or fal) for image generation', () => {
    expect(
      mediaCapabilityIssue({ kind: 'image' }, { ...ready, hasDashscope: false, hasFal: false }),
    ).toContain('图片生成服务');
    expect(
      mediaCapabilityIssue({ kind: 'image' }, { ...ready, hasDashscope: false }),
    ).toBeNull();
    expect(mediaCapabilityIssue({ kind: 'image' }, { ...ready, hasFal: false })).toBeNull();
  });

  it('no longer depends on the dormant Gemini key', () => {
    const noGemini = { ...ready, hasGemini: false };
    expect(mediaCapabilityIssue({ kind: 'image' }, noGemini)).toBeNull();
    expect(
      mediaCapabilityIssue({ kind: 'video', tab: 'normal', model: 'veo_fast' }, noGemini),
    ).toBeNull();
    expect(
      mediaCapabilityIssue({ kind: 'video_confirmation', choice: 'image' }, noGemini),
    ).toBeNull();
  });

  it('requires the provider selected by a normal video task', () => {
    expect(
      mediaCapabilityIssue(
        { kind: 'video', tab: 'normal', model: 'veo_fast' },
        { ...ready, hasFal: false },
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

  it('requires an image provider when a video quote is confirmed as an image', () => {
    expect(
      mediaCapabilityIssue(
        { kind: 'video_confirmation', choice: 'image' },
        { ...ready, hasDashscope: false, hasFal: false },
      ),
    ).toContain('图片版');
  });

  it('returns null when the selected lane is ready', () => {
    expect(
      mediaCapabilityIssue({ kind: 'video', tab: 'normal', model: 'veo_standard' }, ready),
    ).toBeNull();
  });
});

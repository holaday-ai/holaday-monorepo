import { describe, expect, it } from 'vitest';
import {
  VIDEO_CREATION_SCENARIOS,
  scenarioForVideoTab,
  videoTabForScenario,
} from './video-creation-scenarios';

describe('video creation scenarios', () => {
  it('maps four user goals onto the existing three production video lanes', () => {
    expect(videoTabForScenario('product_highlight')).toBe('normal');
    expect(videoTabForScenario('lifestyle_vlog')).toBe('normal');
    expect(videoTabForScenario('action_remake')).toBe('pet');
    expect(videoTabForScenario('ip_presenter')).toBe('ip');
  });

  it('keeps the preferred normal-video scenario when returning from another lane', () => {
    expect(scenarioForVideoTab('normal', 'lifestyle_vlog')).toBe('lifestyle_vlog');
    expect(scenarioForVideoTab('normal', 'action_remake')).toBe('product_highlight');
    expect(scenarioForVideoTab('pet')).toBe('action_remake');
    expect(scenarioForVideoTab('ip')).toBe('ip_presenter');
  });

  it('provides real imagery, a useful starting prompt, and three storyboard beats per goal', () => {
    expect(VIDEO_CREATION_SCENARIOS).toHaveLength(4);
    for (const scenario of VIDEO_CREATION_SCENARIOS) {
      expect(scenario.image).toMatch(/^\/design-ref\/video-scenario-.+\.jpg$/);
      expect(scenario.defaultPrompt.length).toBeGreaterThan(12);
      expect(scenario.storyboard).toHaveLength(3);
    }
  });

  it('shows only durations supported by the connected production lanes', () => {
    expect(VIDEO_CREATION_SCENARIOS.map(({ id, duration }) => [id, duration])).toEqual([
      ['product_highlight', '8 秒'],
      ['lifestyle_vlog', '8 秒'],
      ['action_remake', '2–30 秒参考'],
      ['ip_presenter', '≤40 秒口播'],
    ]);
  });

  it('keeps each normal-video storyboard inside the real 8-second output', () => {
    const normalStoryboards = VIDEO_CREATION_SCENARIOS.filter(
      ({ videoTab }) => videoTab === 'normal',
    ).map(({ storyboard }) => storyboard.map(({ duration }) => duration));

    expect(normalStoryboards).toEqual([
      ['2 秒', '4 秒', '2 秒'],
      ['2 秒', '4 秒', '2 秒'],
    ]);
  });

  it('uses distinct campaign frames for the default product storyboard', () => {
    const product = VIDEO_CREATION_SCENARIOS.find(({ id }) => id === 'product_highlight');
    expect(product?.storyboard.map(({ image }) => image)).toEqual([
      '/design-ref/video-scenario-product.jpg',
      '/design-ref/video-storyboard-product-detail.jpg',
      '/design-ref/video-storyboard-product-close.jpg',
    ]);
  });
});

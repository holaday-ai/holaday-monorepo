import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_COUNT,
  buildImageCreationOptions,
  buildCloneVideoIntent,
  buildImageIntentForSubmit,
  buildImageIntentWithMode,
  buildIpVideoIntent,
  buildVideoIntentWithCreativeStyles,
  inferVideoStyleOption,
  normalVideoParametersAfterTabReturn,
} from './VideoPage';

describe('video creative style state', () => {
  it('keeps ignored IP engine and identity summaries out of the parameter bar', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('label="生成引擎"');
    expect(source).not.toContain('label="人物一致性"');
  });

  it('keeps history details readable in narrow workbench panes and exposes the real video', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain(
      'grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]',
    );
    expect(source).not.toContain("md:grid-cols-[minmax(260px,520px)_1fr]");
    expect(source).toContain('播放成片');
    expect(source).toContain('未记录当前质检');
  });

  it('defaults image generation to one output to avoid silent duplicate spend', () => {
    expect(DEFAULT_IMAGE_COUNT).toBe(1);
    expect(buildImageCreationOptions('nano_banana_2', '1:1')).toEqual({
      model: 'nano_banana_2',
      aspectRatio: '1:1',
      imageCount: 1,
    });
  });

  it('preserves an explicit multi-image selection', () => {
    expect(buildImageCreationOptions('nano_banana_pro', '4:3', 3)).toEqual({
      model: 'nano_banana_pro',
      aspectRatio: '4:3',
      imageCount: 3,
    });
  });

  it('keeps randomized style choices out of the user prompt', () => {
    expect(
      buildVideoIntentWithCreativeStyles('拍一条新品介绍短视频', {
        vibe: 'random',
        lighting: 'random',
        color: 'random',
      }),
    ).toBe('拍一条新品介绍短视频');
  });

  it('reconciles a clone-only 1080p + 6s selection when returning to normal video', () => {
    expect(normalVideoParametersAfterTabReturn('wan_animate_std', '1080p', 6)).toEqual({
      model: 'veo_fast',
      resolution: '1080p',
      durationSeconds: 8,
    });
  });

  it('maps visual style picks onto supported backend style buckets', () => {
    expect(
      inferVideoStyleOption('auto', {
        vibe: 'sci_fi',
        lighting: 'random',
        color: 'random',
      }),
    ).toBe('science');
    expect(
      inferVideoStyleOption('auto', {
        vibe: 'random',
        lighting: 'golden_hour',
        color: 'warm',
      }),
    ).toBe('atmospheric');
  });

  it('keeps clone-video notes honest about what changes the provider input', () => {
    expect(buildCloneVideoIntent('保留原视频舞步，主角换成我的狗').split('\n')).toEqual([
      '复刻视频：使用上传照片替换参考视频中的主角，并保留参考视频的动作、镜头、节奏和音频。',
      '任务备注（仅用于记录，不改变本次模型输入）：保留原视频舞步，主角换成我的狗',
    ]);
  });

  it('keeps IP narration copy free of visual style instructions', () => {
    expect(
      buildIpVideoIntent('大家好，欢迎来到今天的产品介绍。', {
        vibe: 'sci_fi',
        lighting: 'golden_hour',
        color: 'warm',
      }),
    ).toBe('大家好，欢迎来到今天的产品介绍。');
  });

  it('keeps normal image prompts lightweight in free mode', () => {
    expect(buildImageIntentWithMode('生成一张夏日海报', 'random', 'free')).toBe('生成一张夏日海报');
  });

  it('keeps internal model metadata out of the image prompt', () => {
    expect(buildImageIntentForSubmit('生成一张夏日海报', 'random', 'free')).toBe(
      '生成一张夏日海报',
    );
  });

  it('adds subject consistency constraints for locked-subject image mode', () => {
    const result = buildImageIntentWithMode('把这只狗放到雪山背景里', 'cinematic', 'lock_subject');

    expect(result).toContain('图片风格要求：电影感构图');
    expect(result).toContain('主体一致性要求：请以用户上传的第一张图片作为锁定主角。');
    expect(result).toContain('保持主角身份');
    expect(result).toContain('只根据用户描述改变背景、风格、光线、场景、动作、姿态、构图和系列化画面。');
  });
});

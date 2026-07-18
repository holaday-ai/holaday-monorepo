import { describe, expect, it } from 'vitest';
import {
  buildCloneVideoIntent,
  buildImageIntentForSubmit,
  buildImageIntentWithMode,
  buildVideoIntentWithCreativeStyles,
  inferVideoStyleOption,
} from './VideoPage';

describe('video creative style state', () => {
  it('keeps randomized style choices out of the user prompt', () => {
    expect(
      buildVideoIntentWithCreativeStyles('拍一条新品介绍短视频', {
        vibe: 'random',
        lighting: 'random',
        color: 'random',
      }),
    ).toBe('拍一条新品介绍短视频');
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

  it('builds a clone-video instruction around the uploaded reference video', () => {
    expect(buildCloneVideoIntent('保留原视频舞步，主角换成我的狗').split('\n')).toEqual([
      '复刻视频：请参考上传的视频作为动作、镜头节奏、构图和时长参考。',
      '将视频主角替换为上传照片中的主角，尽量生成相同动作和相同画面节奏的视频。',
      '补充描述：保留原视频舞步，主角换成我的狗',
    ]);
  });

  it('keeps normal image prompts lightweight in free mode', () => {
    expect(buildImageIntentWithMode('生成一张夏日海报', 'random', 'free')).toBe('生成一张夏日海报');
  });

  it('adds the selected Nano Banana 2 model directive for image submits', () => {
    expect(buildImageIntentForSubmit('生成一张夏日海报', 'random', 'free', 'nano_banana_2')).toContain(
      '图片模型要求：使用 Nano Banana 2。',
    );
  });

  it('adds the selected Nano Banana Pro model directive for image submits', () => {
    expect(buildImageIntentForSubmit('生成一张夏日海报', 'random', 'free', 'nano_banana_pro')).toContain(
      '图片模型要求：使用 Nano Banana Pro。',
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

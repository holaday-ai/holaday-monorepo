import { describe, expect, it } from 'vitest';
import { type ProductImageModelKey, pickImageModelForTask } from './model-router.js';

const ALL: ProductImageModelKey[] = ['qwen_image', 'wan_image', 'nano_banana_2'];
const base = { available: ALL, defaultModel: 'nano_banana_2' as const, hasInputs: false };

describe('pickImageModelForTask — route by task type', () => {
  it('routes posters / on-image Chinese text to Qwen Image with the text-grade tier', () => {
    const route = pickImageModelForTask('做一张开业海报，标题写"开业大吉"', base);
    expect(route).toMatchObject({ primary: 'qwen_image', tier: 'pro' });
    expect(route?.fallbacks).toEqual(['wan_image', 'nano_banana_2']);
  });

  it('routes reference-image edits and lock_subject to Wan 2.7 Image', () => {
    expect(pickImageModelForTask('把背景换成海边', { ...base, hasInputs: true })?.primary).toBe(
      'wan_image',
    );
    expect(
      pickImageModelForTask('换个风格', { ...base, mode: 'lock_subject' })?.primary,
    ).toBe('wan_image');
  });

  it('routes general asks to the configured default, then the rest', () => {
    expect(pickImageModelForTask('画一只橘猫', base)).toMatchObject({
      primary: 'nano_banana_2',
      fallbacks: ['wan_image', 'qwen_image'],
      tier: 'flash',
    });
    expect(
      pickImageModelForTask('画一只橘猫', { ...base, defaultModel: 'wan_image' })?.primary,
    ).toBe('wan_image');
  });

  it('honours an explicit, usable UI selection over the task heuristic', () => {
    const route = pickImageModelForTask('做一张海报', { ...base, preferredModel: 'nano_banana_2' });
    expect(route?.primary).toBe('nano_banana_2');
    expect(route?.reason).toContain('用户选择');
    expect(route?.preferredUnavailable).toBeUndefined();
  });

  it('falls back (and flags it) when the selected model is not configured', () => {
    const route = pickImageModelForTask('画一只橘猫', {
      ...base,
      available: ['qwen_image', 'wan_image'],
      preferredModel: 'nano_banana_2',
    });
    expect(route?.primary).toBe('wan_image');
    expect(route?.preferredUnavailable).toBe(true);
  });

  it('treats auto / legacy values as no preference', () => {
    expect(
      pickImageModelForTask('做一张海报', { ...base, preferredModel: 'auto' })?.primary,
    ).toBe('qwen_image');
    expect(
      pickImageModelForTask('做一张海报', { ...base, preferredModel: 'nano_banana_pro' })
        ?.preferredUnavailable,
    ).toBeUndefined();
  });

  it('returns null when no provider is configured', () => {
    expect(pickImageModelForTask('画猫', { ...base, available: [] })).toBeNull();
  });
});

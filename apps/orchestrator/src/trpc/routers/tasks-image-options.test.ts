import { describe, expect, it } from 'vitest';
import { imageCreationOptionsInput } from './tasks.js';

describe('image creation studio input', () => {
  it('accepts the bounded goal-first metadata contract', () => {
    expect(
      imageCreationOptionsInput.parse({
        model: 'nano_banana_pro',
        style: 'vibrant',
        aspectRatio: '3:4',
        imageCount: 1,
        goal: 'commercial',
        commercialUse: 'poster',
        changeTargets: ['background', 'lighting'],
        visiblePrompt: '做一张夏日新品海报',
      }),
    ).toMatchObject({
      goal: 'commercial',
      commercialUse: 'poster',
      changeTargets: ['background', 'lighting'],
    });
  });

  it.each([
    { commercialUse: 'unknown' },
    { style: 'unknown' },
    { changeTargets: ['background', 'style', 'lighting', 'action', 'composition', 'extra'] },
    { visiblePrompt: 'x'.repeat(4_001) },
  ])('rejects unsupported or oversized metadata: %o', (invalid) => {
    expect(() =>
      imageCreationOptionsInput.parse({
        aspectRatio: '1:1',
        imageCount: 1,
        goal: 'commercial',
        ...invalid,
      }),
    ).toThrow();
  });
});

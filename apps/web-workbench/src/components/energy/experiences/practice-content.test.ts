import { describe, expect, it } from 'vitest';
import { ENERGY_PRACTICE_IDS } from '../energy-content-target';
import { PRACTICE_CONTENT } from './practice-content';

describe('practice content', () => {
  it('defines two to four actionable steps and bounded feedback for all six practices', () => {
    expect(PRACTICE_CONTENT.map((practice) => practice.id)).toEqual(ENERGY_PRACTICE_IDS);

    for (const practice of PRACTICE_CONTENT) {
      expect(practice.steps.length).toBeGreaterThanOrEqual(2);
      expect(practice.steps.length).toBeLessThanOrEqual(4);
      expect(practice.estimatedSeconds).toBeGreaterThanOrEqual(30);
      expect(practice.estimatedSeconds).toBeLessThanOrEqual(120);
      expect(practice.steps.every((step) => step.title.length > 0 && step.body.length > 0)).toBe(true);
      expect(practice.completionTitle.length).toBeGreaterThan(0);
      expect(practice.completionAction.length).toBeGreaterThan(0);
    }
  });
});

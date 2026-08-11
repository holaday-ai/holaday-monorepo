import { describe, expect, it } from 'vitest';
import { energyResponseForMood, recommendExperience } from './energy-recommendation';
import { activeEnergyExperiences } from './experience-registry';

describe('energy recommendations', () => {
  it.each([
    ['good', 'light-test'],
    ['tired', 'tarot'],
    ['stressed', 'tarot'],
    ['unwind', 'light-test'],
  ] as const)('maps %s to one actionable recommendation', (mood, expected) => {
    const recommendation = recommendExperience(mood);

    expect(recommendation.id).toBe(expected);
    expect(activeEnergyExperiences()).toContainEqual(recommendation);
    expect(energyResponseForMood(mood).action.length).toBeGreaterThan(0);
  });

  it('keeps the response deterministic for the same mood', () => {
    expect(energyResponseForMood('stressed')).toEqual(energyResponseForMood('stressed'));
    expect(recommendExperience('stressed')).toEqual(recommendExperience('stressed'));
  });
});

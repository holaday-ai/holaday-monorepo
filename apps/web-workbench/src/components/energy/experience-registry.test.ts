import { describe, expect, it } from 'vitest';
import { activeEnergyExperiences, ENERGY_EXPERIENCES } from './experience-registry';

describe('energy registry', () => {
  it('has stable unique ids and excludes games from actionable entries', () => {
    expect(new Set(ENERGY_EXPERIENCES.map((item) => item.id)).size).toBe(4);
    expect(activeEnergyExperiences().map((item) => item.id)).toEqual([
      'tarot',
      'light-test',
      'horoscope',
    ]);
    expect(ENERGY_EXPERIENCES.find((item) => item.id === 'games')).toMatchObject({
      status: 'coming-soon',
      actionable: false,
    });
  });

  it('returns a fresh list of active experiences', () => {
    const first = activeEnergyExperiences();
    const second = activeEnergyExperiences();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

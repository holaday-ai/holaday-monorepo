import { describe, expect, it, vi } from 'vitest';
import { ENERGY_EXPERIENCES, activeEnergyExperiences } from './experience-registry';

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

  it('does not load an experience module until its loader is called', async () => {
    const tarot = ENERGY_EXPERIENCES.find((experience) => experience.id === 'tarot');
    expect(tarot?.load).toBeTypeOf('function');
    if (!tarot?.load) throw new Error('expected tarot loader');
    const load = vi.fn(tarot.load);

    activeEnergyExperiences();
    expect(load).not.toHaveBeenCalled();

    const module = await load();
    expect(load).toHaveBeenCalledOnce();
    expect(module.default).toBeTypeOf('function');
  });
});

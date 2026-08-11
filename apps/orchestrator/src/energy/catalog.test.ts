import { describe, expect, it } from 'vitest';
import { buildEnergyHome } from './catalog.js';

describe('buildEnergyHome', () => {
  it('returns the active recharge modes and one non-interactive coming-soon game', () => {
    const home = buildEnergyHome();

    expect(home.experiences.map((item) => [item.id, item.status])).toEqual([
      ['recharge', 'active'],
      ['tarot', 'active'],
      ['light-test', 'active'],
      ['horoscope', 'active'],
      ['games', 'coming-soon'],
    ]);
    expect(home.experiences.find((item) => item.id === 'games')?.actionable).toBe(false);
  });

  it('does not expose profile values or free-form payload fields', () => {
    expect(JSON.stringify(buildEnergyHome())).not.toMatch(/birthday|birthPlace|answerText/);
  });

  it('returns a fresh catalog copy for every request', () => {
    const first = buildEnergyHome();
    const firstItem = first.experiences[0];
    expect(firstItem).toBeDefined();
    if (!firstItem) throw new Error('expected an energy experience');
    firstItem.title = 'mutated';

    expect(buildEnergyHome().experiences[0]?.title).toBe('30 秒补给');
  });
});

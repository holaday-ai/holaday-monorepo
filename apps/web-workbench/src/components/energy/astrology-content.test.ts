import { describe, expect, it } from 'vitest';
import { luckyInsightGroups, periodSections } from './astrology-content';
import type { EnergyPeriodReading } from './useEnergyAstrology';

function reading(scores: Array<number | null>): EnergyPeriodReading {
  const keys = ['personal', 'health', 'profession', 'emotions', 'travel', 'luck'] as const;
  return {
    period: 'daily',
    provider: 'divineapi',
    source: 'divineapi',
    freshness: 'fresh',
    providerRefreshPending: false,
    zodiacSign: 'aries',
    zodiacLabel: '白羊座',
    rangeLabel: '2026-08-12',
    rangeKey: 'today',
    summary: '今天适合把清楚的一步先做完。',
    dimensions: keys.map((key, index) => ({
      key,
      label: key,
      body: `${key} body`,
      score: scores[index] ?? null,
    })),
    luckyColors: ['#ff7d8d'],
    luckyNumbers: ['3', '7'],
    luckyLetters: [],
    suitableTimes: ['10:00 - 11:00'],
    sevenDayTrend: null,
    cosmicTip: null,
    singlesTip: null,
    couplesTip: null,
  };
}

describe('astrology content mapping', () => {
  it('orders the six dimensions without inventing missing scores', () => {
    expect(periodSections(reading([1, 2, 3, 4, 5, 6])).map((item) => item.key)).toEqual([
      'profession',
      'personal',
      'health',
      'emotions',
      'travel',
      'luck',
    ]);
    expect(periodSections(reading([])).every((item) => item.score === null)).toBe(true);
  });

  it('returns only non-empty lucky insight groups', () => {
    expect(luckyInsightGroups(reading([])).map((group) => group.key)).toEqual([
      'colors',
      'numbers',
      'times',
    ]);
  });
});

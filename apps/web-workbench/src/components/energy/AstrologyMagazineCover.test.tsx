// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AstrologyMagazineCover } from './AstrologyMagazineCover';
import type { EnergyPeriodReading } from './useEnergyAstrology';

const reading: EnergyPeriodReading = {
  period: 'daily',
  provider: 'divineapi',
  source: 'divineapi',
  freshness: 'fresh',
  zodiacSign: 'aries',
  zodiacLabel: '白羊座',
  rangeLabel: '2026-08-12',
  rangeKey: 'today',
  summary: '今日提示',
  dimensions: [],
  luckyColors: ['#ff7d8d'],
  luckyNumbers: [],
  luckyLetters: [],
  suitableTimes: ['10:00 - 11:00'],
  sevenDayTrend: null,
  cosmicTip: null,
  singlesTip: null,
  couplesTip: null,
};

afterEach(cleanup);

describe('AstrologyMagazineCover', () => {
  it('renders one zodiac cover with color, time, period and source facts', () => {
    render(<AstrologyMagazineCover reading={reading} sourceLabel="DivineAPI 内容" />);
    expect(screen.getAllByRole('img', { name: '白羊座马卡龙专刊封面' })).toHaveLength(1);
    expect(screen.getByText('#ff7d8d')).toBeTruthy();
    expect(screen.getByText('10:00 - 11:00')).toBeTruthy();
    expect(screen.getByText('2026-08-12')).toBeTruthy();
    expect(screen.getByText('DivineAPI 内容')).toBeTruthy();
  });

  it('uses a visible cover fallback after image failure', () => {
    render(<AstrologyMagazineCover reading={reading} sourceLabel="DivineAPI 内容" />);
    fireEvent.error(screen.getByRole('img', { name: '白羊座马卡龙专刊封面' }));
    expect(screen.getByTestId('zodiac-cover-fallback')).toBeTruthy();
  });
});

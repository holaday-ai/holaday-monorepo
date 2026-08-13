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
  luckyColors: ['#FF7E00'],
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
  it('renders provider hex colors as a human label with the original color swatch', () => {
    render(<AstrologyMagazineCover reading={reading} sourceLabel="DivineAPI 内容" />);
    expect(screen.getAllByRole('img', { name: '白羊座马卡龙专刊封面' })).toHaveLength(1);
    expect(screen.getByText('金橙')).toBeTruthy();
    expect(screen.queryByText('#FF7E00')).toBeNull();
    const swatch = screen.getByTitle('#FF7E00');
    expect(swatch.getAttribute('style')).toContain(
      'background-color: #FF7E00',
    );
    expect(screen.getByText('10:00 - 11:00')).toBeTruthy();
    expect(screen.getByText('2026-08-12')).toBeTruthy();
    expect(screen.getByText('DivineAPI 内容')).toBeTruthy();
  });

  it('uses a warm semantic label for another provider gold tone', () => {
    render(
      <AstrologyMagazineCover
        reading={{ ...reading, luckyColors: ['#FFBF00'] }}
        sourceLabel="DivineAPI 内容"
      />,
    );

    expect(screen.getByText('琥珀金')).toBeTruthy();
    expect(screen.queryByText('#FFBF00')).toBeNull();
    expect(screen.getByTitle('#FFBF00')).toBeTruthy();
  });

  it('uses a visible cover fallback after image failure', () => {
    render(<AstrologyMagazineCover reading={reading} sourceLabel="DivineAPI 内容" />);
    fireEvent.error(screen.getByRole('img', { name: '白羊座马卡龙专刊封面' }));
    expect(screen.getByTestId('zodiac-cover-fallback')).toBeTruthy();
  });
});

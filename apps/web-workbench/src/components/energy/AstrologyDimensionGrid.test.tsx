// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AstrologyDimensionGrid } from './AstrologyDimensionGrid';
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
  dimensions: [
    { key: 'personal', label: '个人', body: '个人提示', score: 80 },
    { key: 'health', label: '健康', body: '健康提示', score: 70 },
    { key: 'profession', label: '工作', body: '工作提示', score: 90 },
    { key: 'emotions', label: '情绪', body: '情绪提示', score: 75 },
    { key: 'travel', label: '出行', body: '出行提示', score: 60 },
    { key: 'luck', label: '好运', body: '好运提示', score: 85 },
  ],
  luckyColors: [],
  luckyNumbers: [],
  luckyLetters: [],
  suitableTimes: [],
  sevenDayTrend: null,
  cosmicTip: null,
  singlesTip: null,
  couplesTip: null,
};

afterEach(cleanup);

describe('AstrologyDimensionGrid', () => {
  it('shows three image previews, expands one body, then reveals six unique scenes', async () => {
    const user = userEvent.setup();
    const { container } = render(<AstrologyDimensionGrid reading={reading} />);

    expect(container.querySelector('[data-dimension="profession"][data-tone="peach"]')).toBeTruthy();
    expect(container.querySelector('[data-dimension="health"][data-tone="mint"]')).toBeTruthy();
    expect(container.querySelectorAll('img[data-dimension-art]')).toHaveLength(3);
    expect(container.querySelector('[data-dimension-body]')).toBeNull();

    await user.click(screen.getByRole('button', { name: '展开个人完整提示' }));
    expect(container.querySelector('[data-dimension-body]')?.textContent).toContain('个人提示');

    await user.click(screen.getByRole('button', { name: '展开全部六项' }));

    const images = [
      ...container.querySelectorAll<HTMLImageElement>('img[data-dimension-art]'),
    ];
    expect(images).toHaveLength(6);
    expect(new Set(images.map((image) => image.src)).size).toBe(6);
  });
});

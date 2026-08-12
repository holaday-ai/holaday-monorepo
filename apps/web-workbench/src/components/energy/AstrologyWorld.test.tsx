// @vitest-environment happy-dom

import { buildAstroReading, createProfileFromBirthday } from '@/lib/astrology';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstrologyWorld } from './AstrologyWorld';
import type {
  EnergyAstrologyState,
  EnergyPeriodReading,
  EnergyPeriodState,
} from './useEnergyAstrology';

const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
const legacyReading = buildAstroReading(profile, new Date('2026-08-12T12:00:00+09:00'));

function periodReading(
  period: EnergyPeriodReading['period'],
  overrides: Partial<EnergyPeriodReading> = {},
): EnergyPeriodReading {
  return {
    period,
    provider: 'divineapi',
    source: 'divineapi',
    freshness: 'fresh',
    zodiacSign: 'aries',
    zodiacLabel: '白羊座',
    rangeLabel: period === 'daily' ? '2026-08-12' : `2026 ${period}`,
    rangeKey: period === 'daily' ? 'today' : 'current',
    summary: `${period} summary`,
    dimensions: [
      { key: 'personal', label: '个人', body: '个人提示', score: 80 },
      { key: 'health', label: '健康', body: '健康提示', score: 70 },
      { key: 'profession', label: '工作', body: '工作提示', score: 90 },
      { key: 'emotions', label: '情绪', body: '情绪提示', score: 75 },
      { key: 'travel', label: '出行', body: '出行提示', score: 60 },
      { key: 'luck', label: '好运', body: '好运提示', score: 85 },
    ],
    luckyColors: ['#ff7d8d'],
    luckyNumbers: ['3', '7'],
    luckyLetters: ['A'],
    suitableTimes: ['10:00 - 11:00'],
    sevenDayTrend: null,
    cosmicTip: null,
    singlesTip: null,
    couplesTip: null,
    ...overrides,
  };
}

function periodState(
  period: EnergyPeriodReading['period'],
  overrides: Partial<EnergyPeriodState> = {},
): EnergyPeriodState {
  const reading = periodReading(period);
  return {
    reading,
    source: reading.source,
    loading: false,
    loaded: period === 'daily' || period === 'weekly',
    error: null,
    ...overrides,
  };
}

function state(overrides: Partial<EnergyAstrologyState> = {}): EnergyAstrologyState {
  return {
    reading: legacyReading,
    tarot: { title: 'The Star', subtitle: '提示', body: '卡片内容' },
    weekly: {
      weekLabel: '本周',
      personal: '个人',
      health: '健康',
      profession: '工作',
      emotions: '情绪',
      travel: '出行',
      luck: '好运',
      luckyColors: ['#ff7d8d'],
    },
    yesNoTarot: null,
    yesNoLoading: false,
    source: 'provider',
    loading: false,
    error: null,
    periods: {
      daily: periodState('daily'),
      weekly: periodState('weekly'),
      monthly: periodState('monthly'),
      yearly: periodState('yearly'),
    },
    capabilities: {},
    ranking: { complete: false, items: [], loaded: false, loading: false, error: null },
    signPreview: null,
    loadPeriod: vi.fn().mockResolvedValue(undefined),
    refreshPeriod: vi.fn().mockResolvedValue(undefined),
    loadRanking: vi.fn().mockResolvedValue(undefined),
    loadSignPreview: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    drawYesNoTarot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe('AstrologyWorld', () => {
  it('shows the active zodiac artwork and real lucky bubbles', () => {
    render(
      <AstrologyWorld
        astrology={state()}
        onOpenEnergyCard={vi.fn()}
        onOpenLightTest={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('img', { name: '白羊座马卡龙插画' }).getAttribute('src'),
    ).toBe('/energy/aries-badge.jpg');
    expect(screen.getAllByText('幸运色').length).toBeGreaterThan(1);
    expect(screen.getAllByText('#ff7d8d').length).toBeGreaterThan(0);
    expect(screen.getAllByText('顺手时段').length).toBeGreaterThan(1);
    expect(screen.getAllByText('10:00 - 11:00').length).toBeGreaterThan(0);
  });

  it('hides broken zodiac artwork so the visual stage can fall back cleanly', () => {
    render(
      <AstrologyWorld
        astrology={state()}
        onOpenEnergyCard={vi.fn()}
        onOpenLightTest={vi.fn()}
      />,
    );
    const image = screen.getByRole('img', { name: '白羊座马卡龙插画' });

    fireEvent.error(image);

    expect((image as HTMLImageElement).hidden).toBe(true);
  });

  it('loads month only when the month tab is opened', async () => {
    const user = userEvent.setup();
    const loadPeriod = vi.fn().mockResolvedValue(undefined);
    render(
      <AstrologyWorld
        astrology={state({ loadPeriod })}
        onOpenEnergyCard={vi.fn()}
        onOpenLightTest={vi.fn()}
      />,
    );

    expect(loadPeriod).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: '本月' }));
    expect(loadPeriod).toHaveBeenCalledWith('monthly', 'current');
  });

  it('never renders an invented ranking or seven-day chart', async () => {
    const user = userEvent.setup();
    const loadRanking = vi.fn().mockResolvedValue(undefined);
    render(
      <AstrologyWorld
        astrology={state({
          loadRanking,
          ranking: { complete: false, items: [], loaded: true, loading: false, error: null },
        })}
        onOpenEnergyCard={vi.fn()}
        onOpenLightTest={vi.fn()}
      />,
    );

    expect(screen.queryByText('十二星座今日能量排行')).toBeNull();
    expect(screen.queryByRole('img', { name: '七日能量趋势' })).toBeNull();
    expect(screen.getByText('暂未获得可验证的七日趋势')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '查看十二星座排行' }));
    expect(loadRanking).toHaveBeenCalledOnce();
    expect(screen.getByText('Provider 数据尚不完整，暂不展示本地拼接排行。')).toBeTruthy();
  });

  it('offers card, test, and sign-preview continuation paths', async () => {
    const user = userEvent.setup();
    const onOpenEnergyCard = vi.fn();
    const onOpenLightTest = vi.fn();
    const loadSignPreview = vi.fn().mockResolvedValue(undefined);
    render(
      <AstrologyWorld
        astrology={state({ loadSignPreview })}
        onOpenEnergyCard={onOpenEnergyCard}
        onOpenLightTest={onOpenLightTest}
      />,
    );

    const ranking = screen.getByRole('button', { name: '查看十二星座排行' });
    const sign = screen.getByRole('button', { name: '换个星座看看' });
    const card = screen.getByRole('button', { name: '抽一张相关能量牌' });
    const test = screen.getByRole('button', { name: '测个相关主题' });
    expect(ranking.getAttribute('data-tone')).toBe('lavender');
    expect(sign.getAttribute('data-tone')).toBe('sky');
    expect(card.getAttribute('data-tone')).toBe('peach');
    expect(test.getAttribute('data-tone')).toBe('mint');
    expect(screen.getByText('看看谁更有行动力')).toBeTruthy();
    expect(screen.getByText('切换视角，不改资料')).toBeTruthy();
    expect(screen.getByText('给当下一个轻提示')).toBeTruthy();
    expect(screen.getByText('一分钟看见状态')).toBeTruthy();

    await user.click(sign);
    await user.click(screen.getByRole('button', { name: '金牛座' }));
    expect(loadSignPreview).toHaveBeenCalledWith('taurus');
    await user.click(card);
    await user.click(test);
    expect(onOpenEnergyCard).toHaveBeenCalledOnce();
    expect(onOpenLightTest).toHaveBeenCalledOnce();
  });
});

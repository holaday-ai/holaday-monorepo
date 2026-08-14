// @vitest-environment happy-dom

import { buildAstroReading, createProfileFromBirthday } from '@/lib/astrology';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EnergyAstrologyState,
  EnergyPeriodReading,
  EnergyPeriodState,
} from '../useEnergyAstrology';
import { HoroscopeExperience } from './HoroscopeExperience';

afterEach(cleanup);

const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
const reading = buildAstroReading(profile, new Date('2026-08-11T12:00:00+09:00'));

function periodReading(
  period: EnergyPeriodReading['period'],
  source: EnergyPeriodReading['source'],
  providerRefreshPending = false,
): EnergyPeriodReading {
  return {
    period,
    provider: source === 'divineapi' ? 'divineapi' : 'mock',
    source,
    freshness: source === 'divineapi' ? 'fresh' : 'local',
    providerRefreshPending,
    zodiacSign: 'aries',
    zodiacLabel: '白羊座',
    rangeLabel: period === 'daily' ? '2026-08-11' : `2026 ${period}`,
    rangeKey: period === 'daily' ? 'today' : 'current',
    summary: `${period} summary`,
    dimensions: [],
    luckyColors: ['#FFB86B'],
    luckyNumbers: ['3'],
    luckyLetters: ['A'],
    suitableTimes: ['10:00 - 11:00'],
    sevenDayTrend: null,
    cosmicTip: null,
    singlesTip: null,
    couplesTip: null,
  };
}

function periodState(
  period: EnergyPeriodReading['period'],
  source: EnergyPeriodReading['source'],
  providerRefreshPending = false,
): EnergyPeriodState {
  return {
    reading: periodReading(period, source, providerRefreshPending),
    source,
    loading: false,
    loaded: true,
    error: source === 'local-fallback' ? '暂时使用本地提示' : null,
  };
}

function astrologyState(source: EnergyAstrologyState['source'] = 'provider'): EnergyAstrologyState {
  const periodSource = source === 'provider' ? 'divineapi' : 'local-fallback';
  return {
    reading,
    tarot: { title: 'The Star', subtitle: '提示', body: '卡片内容' },
    weekly: {
      weekLabel: '8月10日 - 8月16日',
      personal: '给关系留一点空间。',
      health: '保持轻缓节奏。',
      profession: '先完成最重要的草稿。',
      emotions: '先看见自己的感受。',
      travel: '给安排保留弹性。',
      luck: '小实验会带来好运。',
      luckyColors: ['#FFB86B'],
    },
    yesNoTarot: null,
    yesNoLoading: false,
    source,
    loading: false,
    initialLoading: false,
    error: source === 'local-fallback' ? '暂时使用本地提示' : null,
    periods: {
      daily: periodState('daily', periodSource),
      weekly: periodState('weekly', periodSource),
      monthly: periodState('monthly', periodSource),
      yearly: periodState('yearly', periodSource),
    },
    capabilities: {},
    ranking: { complete: false, items: [], loaded: false, loading: false, error: null },
    signPreview: null,
    activatePeriod: vi.fn(),
    loadPeriod: vi.fn(),
    refreshPeriod: vi.fn(),
    loadRanking: vi.fn(),
    loadSignPreview: vi.fn(),
    refresh: vi.fn(),
    drawYesNoTarot: vi.fn(),
  };
}

describe('HoroscopeExperience', () => {
  it('shows provider hex colors as a human label with the original color swatch', () => {
    const astrology = astrologyState();
    astrology.reading = { ...astrology.reading, luckyColor: '#FF7E00' };

    render(
      <HoroscopeExperience
        profile={profile}
        astrology={astrology}
        phase="active"
        onPhaseChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText('金橙')).toBeTruthy();
    expect(screen.queryByText('#FF7E00')).toBeNull();
    const swatch = screen.getByTitle('#FF7E00');
    expect(swatch.getAttribute('style')).toContain('background-color: #FF7E00');
  });

  it('switches between honest daily and provider weekly sections', async () => {
    const user = userEvent.setup();
    render(
      <HoroscopeExperience
        profile={profile}
        astrology={astrologyState()}
        phase="active"
        onPhaseChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '今日提示' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('heading', { name: reading.headline, level: 3 })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '本周运势' }));

    expect(screen.getByText('8月10日 - 8月16日')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '工作' })).toBeTruthy();
    expect(screen.getByText('先完成最重要的草稿。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '人际' })).toBeTruthy();
    expect(screen.queryByText(/月亮倾向|上升倾向|流年提醒/)).toBeNull();
  });

  it('completes only after the user collects the reading', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onPhaseChange = vi.fn();
    render(
      <HoroscopeExperience
        profile={profile}
        astrology={astrologyState()}
        phase="active"
        onPhaseChange={onPhaseChange}
        onComplete={onComplete}
      />,
    );

    await user.click(screen.getByRole('button', { name: '收下今天的星座提示' }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onPhaseChange).toHaveBeenCalledWith('result');
  });

  it('shows a low-noise fallback note instead of an error panel', () => {
    render(
      <HoroscopeExperience
        profile={profile}
        astrology={astrologyState('local-fallback')}
        phase="active"
        onPhaseChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText('暂时使用本地提示')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains that a pending local reading will be replaced automatically', () => {
    const astrology = astrologyState('local-fallback');
    astrology.periods.daily = periodState('daily', 'local-fallback', true);

    render(
      <HoroscopeExperience
        profile={profile}
        astrology={astrology}
        phase="active"
        onPhaseChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText('真实星座内容更新中，将自动替换')).toBeTruthy();
    expect(screen.queryByText('暂时使用本地提示')).toBeNull();
  });

  it('hides local fallback content while the first provider request is pending', () => {
    const astrology = astrologyState('local-fallback');
    astrology.initialLoading = true;
    astrology.loading = true;

    const { container } = render(
      <HoroscopeExperience
        profile={profile}
        astrology={astrology}
        phase="active"
        onPhaseChange={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByText('正在读取星座能量')).toBeTruthy();
    expect(screen.queryByText('暂时使用本地提示')).toBeNull();
    expect(screen.queryByText(astrology.reading.headline)).toBeNull();
    expect(screen.queryByText(`${astrology.reading.energyScore}%`)).toBeNull();
    expect(container.querySelector('.energy-horoscope-loading')?.getAttribute('aria-busy')).toBe(
      'true',
    );
  });
});

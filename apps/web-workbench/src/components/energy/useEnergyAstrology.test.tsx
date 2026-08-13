// @vitest-environment happy-dom

import { createProfileFromBirthday } from '@/lib/astrology';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEnergyAstrology } from './useEnergyAstrology';

const trpcMocks = vi.hoisted(() => ({
  status: vi.fn(),
  daily: vi.fn(),
  weekly: vi.fn(),
  monthly: vi.fn(),
  yearly: vi.fn(),
  ranking: vi.fn(),
  tarot: vi.fn(),
  yesNoTarot: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    astrology: {
      status: { query: trpcMocks.status },
      daily: { query: trpcMocks.daily },
      weekly: { query: trpcMocks.weekly },
      monthly: { query: trpcMocks.monthly },
      yearly: { query: trpcMocks.yearly },
      ranking: { query: trpcMocks.ranking },
      tarot: { query: trpcMocks.tarot },
      yesNoTarot: { query: trpcMocks.yesNoTarot },
    },
  },
}));

const dimensions = [
  { key: 'personal', label: '个人', body: '个人提示', score: 81 },
  { key: 'health', label: '健康', body: '保持轻缓节奏。', score: 72 },
  { key: 'profession', label: '工作', body: '先完成最重要的草稿。', score: 88 },
  { key: 'emotions', label: '情绪', body: '先看见自己的感受。', score: 76 },
  { key: 'travel', label: '出行', body: '给安排保留弹性。', score: 68 },
  { key: 'luck', label: '好运', body: '小实验会带来好运。', score: 84 },
] as const;

function normalizedPeriod(
  period: 'daily' | 'weekly' | 'monthly' | 'yearly',
  zodiacSign: 'aries' | 'taurus' = 'aries',
) {
  return {
    period,
    provider: 'divineapi' as const,
    source: 'divineapi' as const,
    freshness: 'fresh' as const,
    zodiacSign,
    zodiacLabel: zodiacSign === 'aries' ? '白羊座' : '金牛座',
    rangeLabel: period === 'daily' ? '2026-08-12' : `2026 ${period}`,
    rangeKey: period === 'daily' ? ('today' as const) : ('current' as const),
    summary: '远端周期提示',
    dimensions: [...dimensions],
    luckyColors: ['#FFB86B'],
    luckyNumbers: ['3', '7'],
    luckyLetters: ['A'],
    suitableTimes: [],
    sevenDayTrend: null,
    cosmicTip: null,
    singlesTip: null,
    couplesTip: null,
  };
}

function remoteReading(zodiacSign: 'aries' | 'taurus', headline: string) {
  return {
    ...normalizedPeriod('daily', zodiacSign),
    apiConfigured: true,
    dateLabel: '8月12日星期三',
    headline,
    workNote: `${headline}的工作提示`,
    energyScore: zodiacSign === 'aries' ? 81 : 73,
    luckyColor: zodiacSign === 'aries' ? '远端红' : '远端绿',
    luckyWindow: '10:00 - 11:00',
    weekly: [],
  };
}

function remoteWeekly(zodiacSign: 'aries' | 'taurus' = 'aries') {
  return {
    ...normalizedPeriod('weekly', zodiacSign),
    apiConfigured: true,
    weekLabel: '8月10日 - 8月16日',
    personal: '给关系留一点空间。',
    health: '保持轻缓节奏。',
    profession: '先完成最重要的草稿。',
    emotions: '先看见自己的感受。',
    travel: '给安排保留弹性。',
    luck: '小实验会带来好运。',
  };
}

function capabilityStatus(enabled: string[] = ['daily-horoscope', 'weekly-horoscope']) {
  return {
    enabled: true,
    provider: 'divineapi' as const,
    apiConfigured: true,
    cacheTtlMs: 60_000,
    cacheEntries: 0,
    capabilities: enabled.map((capability) => ({
      capability,
      available: true,
      checkedAt: '2026-08-12T00:00:00.000Z',
    })),
    endpoints: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  for (const mock of Object.values(trpcMocks)) mock.mockReset();
  trpcMocks.status.mockResolvedValue(capabilityStatus());
  trpcMocks.weekly.mockResolvedValue(remoteWeekly());
  trpcMocks.ranking.mockResolvedValue({ complete: false, items: [] });
});

afterEach(cleanup);

describe('useEnergyAstrology', () => {
  it('marks automatic provider periods as initial loading before either request resolves', () => {
    const daily = deferred<ReturnType<typeof remoteReading>>();
    const weekly = deferred<ReturnType<typeof remoteWeekly>>();
    trpcMocks.daily.mockReturnValue(daily.promise);
    trpcMocks.weekly.mockReturnValue(weekly.promise);
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });

    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    expect(result.current.initialLoading).toBe(true);
    expect(result.current.periods.daily).toMatchObject({ loading: true, loaded: false });
    expect(result.current.periods.weekly).toMatchObject({ loading: true, loaded: false });
  });

  it('uses distinct local copy for daily weekly monthly and yearly ranges', () => {
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
    const { result } = renderHook(() => useEnergyAstrology(profile, false));
    const summaries = Object.values(result.current.periods).map((period) => period.reading.summary);
    const workBodies = Object.values(result.current.periods).map(
      (period) => period.reading.dimensions.find((item) => item.key === 'profession')?.body,
    );

    expect(new Set(summaries).size).toBe(4);
    expect(new Set(workBodies).size).toBe(4);
  });

  it('loads daily and weekly independently without eager tarot calls', async () => {
    trpcMocks.daily.mockResolvedValue(remoteReading('aries', '远端今日提示'));
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });

    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.periods.daily.loading).toBe(false));
    await waitFor(() => expect(result.current.periods.weekly.loading).toBe(false));
    expect(result.current.periods.daily.source).toBe('divineapi');
    expect(result.current.periods.weekly.source).toBe('divineapi');
    expect(result.current.reading.headline).toBe('远端今日提示');
    expect(result.current.weekly.profession).toBe('先完成最重要的草稿。');
    expect(result.current.tarot.title).toBe('The Star');
    expect(trpcMocks.tarot).not.toHaveBeenCalled();
    expect(trpcMocks.yesNoTarot).not.toHaveBeenCalled();
  });

  it('uses a human color name in provider-backed fortune copy', async () => {
    trpcMocks.daily.mockResolvedValue({
      ...remoteReading('aries', '远端今日提示'),
      luckyColor: '#FF7E00',
    });
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });

    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.periods.daily.loading).toBe(false));
    const wealth = result.current.reading.fortune.find((item) => item.key === 'wealth');
    expect(wealth?.body).toContain('幸运色 金橙');
    expect(wealth?.body).not.toContain('#FF7E00');
  });

  it('keeps daily provider data when weekly fails', async () => {
    trpcMocks.daily.mockResolvedValue(remoteReading('aries', '远端今日提示'));
    trpcMocks.weekly.mockRejectedValue(new Error('weekly unavailable'));
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });

    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.periods.daily.loading).toBe(false));
    await waitFor(() => expect(result.current.periods.weekly.loading).toBe(false));
    expect(result.current.periods.daily.source).toBe('divineapi');
    expect(result.current.periods.weekly.source).toBe('local-fallback');
    expect(result.current.periods.weekly.error).toBe('暂时使用本地提示');
    expect(result.current.reading.headline).toBe('远端今日提示');
  });

  it('does not fetch monthly until requested', async () => {
    trpcMocks.daily.mockResolvedValue(remoteReading('aries', '远端今日提示'));
    trpcMocks.monthly.mockResolvedValue(normalizedPeriod('monthly'));
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.periods.daily.loading).toBe(false));
    expect(trpcMocks.monthly).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.loadPeriod('monthly', 'current');
    });

    expect(trpcMocks.monthly).toHaveBeenCalledWith(
      expect.objectContaining({ month: 'current', zodiacSign: 'aries' }),
    );
    expect(result.current.periods.monthly).toMatchObject({
      loaded: true,
      source: 'divineapi',
      error: null,
    });
  });

  it('loads yes/no tarot only when the capability is enabled and the user requests it', async () => {
    trpcMocks.status.mockResolvedValue(
      capabilityStatus(['daily-horoscope', 'weekly-horoscope', 'yes-no-tarot']),
    );
    trpcMocks.daily.mockResolvedValue(remoteReading('aries', '远端今日提示'));
    trpcMocks.yesNoTarot.mockResolvedValue({
      provider: 'divineapi',
      apiConfigured: true,
      answer: 'yes',
      card: 'The Sun',
      category: 'Major Arcana',
      result: '可以，从一个清楚的小步骤开始。',
      imageUrl: null,
    });
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.periods.daily.loading).toBe(false));
    expect(trpcMocks.yesNoTarot).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.drawYesNoTarot();
    });

    expect(trpcMocks.yesNoTarot).toHaveBeenCalledWith({
      zodiacSign: 'aries',
      locale: 'zh-CN',
    });
    expect(result.current.yesNoTarot?.answer).toBe('yes');
    expect(result.current.yesNoLoading).toBe(false);
  });

  it('does not let an older profile request overwrite the latest profile', async () => {
    const ariesDaily = deferred<ReturnType<typeof remoteReading>>();
    const taurusDaily = deferred<ReturnType<typeof remoteReading>>();
    trpcMocks.daily.mockImplementation(({ zodiacSign }: { zodiacSign: string }) =>
      zodiacSign === 'aries' ? ariesDaily.promise : taurusDaily.promise,
    );
    trpcMocks.weekly.mockImplementation(({ zodiacSign }: { zodiacSign: string }) =>
      Promise.resolve(remoteWeekly(zodiacSign as 'aries' | 'taurus')),
    );
    const aries = createProfileFromBirthday({ birthday: '1996-03-21' });
    const taurus = createProfileFromBirthday({ birthday: '1996-04-21' });

    const { result, rerender } = renderHook(({ profile }) => useEnergyAstrology(profile, true), {
      initialProps: { profile: aries },
    });
    rerender({ profile: taurus });

    await act(async () => {
      taurusDaily.resolve(remoteReading('taurus', '最新金牛提示'));
      await taurusDaily.promise;
    });
    await waitFor(() => expect(result.current.reading.headline).toBe('最新金牛提示'));

    await act(async () => {
      ariesDaily.resolve(remoteReading('aries', '过期白羊提示'));
      await ariesDaily.promise;
    });

    expect(result.current.reading.headline).toBe('最新金牛提示');
  });

  it('keeps loaded provider content visible while a manual refresh is pending', async () => {
    const refreshedDaily = deferred<ReturnType<typeof remoteReading>>();
    const refreshedWeekly = deferred<ReturnType<typeof remoteWeekly>>();
    trpcMocks.daily
      .mockResolvedValueOnce(remoteReading('aries', '远端今日提示'))
      .mockReturnValueOnce(refreshedDaily.promise);
    trpcMocks.weekly
      .mockResolvedValueOnce(remoteWeekly())
      .mockReturnValueOnce(refreshedWeekly.promise);
    const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
    const { result } = renderHook(() => useEnergyAstrology(profile, true));

    await waitFor(() => expect(result.current.periods.daily.source).toBe('divineapi'));
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    expect(result.current.initialLoading).toBe(false);
    expect(result.current.periods.daily.loaded).toBe(true);
    expect(result.current.periods.weekly.loaded).toBe(true);
    expect(result.current.reading.headline).toBe('远端今日提示');

    await act(async () => {
      refreshedDaily.resolve(remoteReading('aries', '刷新后的今日提示'));
      refreshedWeekly.resolve(remoteWeekly());
      await Promise.all([refreshedDaily.promise, refreshedWeekly.promise]);
    });
  });
});

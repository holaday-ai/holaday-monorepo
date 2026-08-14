import {
  type AstroProfile,
  type AstroReading,
  type ZodiacSign,
  buildAstroReading,
} from '@/lib/astrology';
import { type AppRouter, trpc } from '@/lib/trpc';
import type { inferRouterOutputs } from '@trpc/server';
import * as React from 'react';
import type { EnergyAstrologyPeriod, EnergyAstrologyRangeKey } from './energy-types';
import { presentLuckyColor } from './lucky-color';

type AstrologyRouterOutput = inferRouterOutputs<AppRouter>['astrology'];
type ProviderDaily = AstrologyRouterOutput['daily'];
type ProviderWeekly = AstrologyRouterOutput['weekly'];
type ProviderYesNoTarot = AstrologyRouterOutput['yesNoTarot'];
type ProviderStatus = AstrologyRouterOutput['status'];

export type EnergyPeriodReading = Pick<
  ProviderDaily,
  | 'period'
  | 'provider'
  | 'source'
  | 'freshness'
  | 'providerRefreshPending'
  | 'zodiacSign'
  | 'zodiacLabel'
  | 'rangeLabel'
  | 'rangeKey'
  | 'summary'
  | 'dimensions'
  | 'luckyColors'
  | 'luckyNumbers'
  | 'luckyLetters'
  | 'suitableTimes'
  | 'sevenDayTrend'
  | 'cosmicTip'
  | 'singlesTip'
  | 'couplesTip'
>;

export type EnergyRankingItem = AstrologyRouterOutput['ranking']['items'][number];

export interface EnergyPeriodState {
  reading: EnergyPeriodReading;
  source: 'divineapi' | 'local-fallback';
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface EnergyTarotReading {
  title: string;
  subtitle: string;
  body: string;
}

export interface EnergyWeeklyReading {
  weekLabel: string;
  personal: string;
  health: string;
  profession: string;
  emotions: string;
  travel: string;
  luck: string;
  luckyColors: string[];
}

export interface EnergyYesNoTarotReading {
  answer: 'yes' | 'no' | 'maybe';
  card: string;
  category: string;
  result: string;
}

export interface EnergyAstrologyState {
  reading: AstroReading;
  tarot: EnergyTarotReading;
  weekly: EnergyWeeklyReading;
  yesNoTarot: EnergyYesNoTarotReading | null;
  yesNoLoading: boolean;
  source: 'provider' | 'local-fallback';
  loading: boolean;
  initialLoading: boolean;
  error: string | null;
  periods: Record<EnergyAstrologyPeriod, EnergyPeriodState>;
  capabilities: Record<string, boolean>;
  ranking: {
    complete: boolean;
    items: EnergyRankingItem[];
    loaded: boolean;
    loading: boolean;
    error: string | null;
  };
  signPreview: EnergyPeriodState | null;
  loadPeriod: (period: EnergyAstrologyPeriod, rangeKey?: 'current' | 'next') => Promise<void>;
  activatePeriod: (period: EnergyAstrologyPeriod) => void;
  refreshPeriod: (period: EnergyAstrologyPeriod) => Promise<void>;
  loadRanking: () => Promise<void>;
  loadSignPreview: (sign: ZodiacSign) => Promise<void>;
  refresh: () => Promise<void>;
  drawYesNoTarot: () => Promise<void>;
}

const PERIODS: EnergyAstrologyPeriod[] = ['daily', 'weekly', 'monthly', 'yearly'];
const LOCAL_ERROR = '暂时使用本地提示';
const SILENT_REFRESH_DELAYS_MS = [0, 1_000, 1_000] as const;

export function useEnergyAstrology(
  profile: AstroProfile,
  liveProvider: boolean,
): EnergyAstrologyState {
  const localReading = React.useMemo(() => buildAstroReading(profile), [profile]);
  const localTarot = React.useMemo(() => buildLocalTarot(localReading), [localReading]);
  const localWeekly = React.useMemo(() => buildLocalWeekly(localReading), [localReading]);
  const localYesNoTarot = React.useMemo(() => buildLocalYesNoTarot(localReading), [localReading]);
  const localPeriods = React.useMemo(
    () => buildLocalPeriodStates(profile, localReading),
    [localReading, profile],
  );
  const periodRequestIds = React.useRef<Record<EnergyAstrologyPeriod, number>>({
    daily: 0,
    weekly: 0,
    monthly: 0,
    yearly: 0,
  });
  const periodRangeKeys = React.useRef<
    Record<EnergyAstrologyPeriod, 'current' | 'next' | undefined>
  >({
    daily: undefined,
    weekly: undefined,
    monthly: 'current',
    yearly: 'current',
  });
  const activePeriodRef = React.useRef<EnergyAstrologyPeriod>('daily');
  const silentRefreshTimers = React.useRef<
    Record<EnergyAstrologyPeriod, ReturnType<typeof setTimeout> | null>
  >({
    daily: null,
    weekly: null,
    monthly: null,
    yearly: null,
  });
  const silentRefreshAttempts = React.useRef<Record<EnergyAstrologyPeriod, number>>({
    daily: 0,
    weekly: 0,
    monthly: 0,
    yearly: 0,
  });
  const scheduleSilentPeriodRefreshRef = React.useRef<
    (period: EnergyAstrologyPeriod, rangeKey: 'current' | 'next', requestId: number) => void
  >(() => undefined);
  const statusRequestIdRef = React.useRef(0);
  const rankingRequestIdRef = React.useRef(0);
  const signPreviewRequestIdRef = React.useRef(0);
  const yesNoRequestIdRef = React.useRef(0);
  const capabilitiesRef = React.useRef<Record<string, boolean>>({});
  const [periods, setPeriods] = React.useState<Record<EnergyAstrologyPeriod, EnergyPeriodState>>(
    () => initialPeriodStates(localPeriods, liveProvider),
  );
  const [compatibilityReading, setCompatibilityReading] = React.useState(localReading);
  const [compatibilityWeekly, setCompatibilityWeekly] = React.useState(localWeekly);
  const [capabilities, setCapabilities] = React.useState<Record<string, boolean>>({});
  const [ranking, setRanking] = React.useState<EnergyAstrologyState['ranking']>({
    complete: false,
    items: [],
    loaded: false,
    loading: false,
    error: null,
  });
  const [signPreview, setSignPreview] = React.useState<EnergyPeriodState | null>(null);
  const [yesNoTarot, setYesNoTarot] = React.useState<EnergyYesNoTarotReading | null>(null);
  const [yesNoLoading, setYesNoLoading] = React.useState(false);
  const periodsRef = React.useRef(periods);
  periodsRef.current = periods;

  const clearSilentPeriodRefresh = React.useCallback(
    (period: EnergyAstrologyPeriod, resetAttempts = true): void => {
      const timer = silentRefreshTimers.current[period];
      if (timer !== null) clearTimeout(timer);
      silentRefreshTimers.current[period] = null;
      if (resetAttempts) silentRefreshAttempts.current[period] = 0;
    },
    [],
  );

  const scheduleSilentPeriodRefresh = React.useCallback(
    (period: EnergyAstrologyPeriod, rangeKey: 'current' | 'next', requestId: number): void => {
      const attempt = silentRefreshAttempts.current[period];
      const delay = SILENT_REFRESH_DELAYS_MS[attempt];
      if (delay === undefined) return;

      clearSilentPeriodRefresh(period, false);
      silentRefreshAttempts.current[period] = attempt + 1;
      silentRefreshTimers.current[period] = setTimeout(() => {
        silentRefreshTimers.current[period] = null;
        if (
          period !== activePeriodRef.current ||
          requestId !== periodRequestIds.current[period] ||
          rangeKey !== periodRangeKeys.current[period]
        ) {
          return;
        }
        void queryPeriod(period, profile, rangeKey)
          .then((remote) => {
            if (
              requestId !== periodRequestIds.current[period] ||
              rangeKey !== periodRangeKeys.current[period]
            ) {
              return;
            }
            const reading = toPeriodReading(remote);
            if (reading.source !== 'divineapi') {
              if (reading.providerRefreshPending) {
                scheduleSilentPeriodRefreshRef.current(period, rangeKey, requestId);
              }
              return;
            }

            silentRefreshAttempts.current[period] = 0;
            setPeriods((current) => ({
              ...current,
              [period]: {
                reading,
                source: reading.source,
                loading: false,
                loaded: true,
                error: null,
              },
            }));
            if (period === 'daily') {
              setCompatibilityReading(mergeProviderReading(localReading, remote as ProviderDaily));
            }
            if (period === 'weekly') {
              setCompatibilityWeekly(providerWeekly(remote as ProviderWeekly));
            }
          })
          .catch(() => undefined);
      }, delay);
    },
    [clearSilentPeriodRefresh, localReading, profile],
  );

  scheduleSilentPeriodRefreshRef.current = scheduleSilentPeriodRefresh;

  const activatePeriod = React.useCallback(
    (period: EnergyAstrologyPeriod): void => {
      const previousPeriod = activePeriodRef.current;
      if (previousPeriod !== period) {
        clearSilentPeriodRefresh(previousPeriod);
        periodRequestIds.current[previousPeriod] += 1;
        setPeriods((current) => ({
          ...current,
          [previousPeriod]: { ...current[previousPeriod], loading: false },
        }));
        activePeriodRef.current = period;
      }

      const activeState = periodsRef.current[period];
      if (
        !activeState.loading &&
        activeState.reading.providerRefreshPending &&
        silentRefreshTimers.current[period] === null
      ) {
        scheduleSilentPeriodRefreshRef.current(
          period,
          periodRangeKeys.current[period] ?? 'current',
          periodRequestIds.current[period],
        );
      }
    },
    [clearSilentPeriodRefresh],
  );

  const loadPeriod = React.useCallback(
    async (
      period: EnergyAstrologyPeriod,
      rangeKey: 'current' | 'next' = 'current',
    ): Promise<void> => {
      clearSilentPeriodRefresh(period);
      periodRangeKeys.current[period] = rangeKey;
      const requestId = ++periodRequestIds.current[period];
      const localState = localStateForRange(localPeriods[period], period, rangeKey);
      if (!liveProvider) {
        setPeriods((current) => ({
          ...current,
          [period]: { ...localState, loaded: true },
        }));
        if (period === 'daily') setCompatibilityReading(localReading);
        if (period === 'weekly') setCompatibilityWeekly(localWeekly);
        return;
      }

      setPeriods((current) => ({
        ...current,
        [period]: { ...current[period], loading: true, error: null },
      }));

      try {
        const remote = await queryPeriod(period, profile, rangeKey);
        if (requestId !== periodRequestIds.current[period]) return;
        const reading = toPeriodReading(remote);
        const error = reading.source === 'local-fallback' ? LOCAL_ERROR : null;
        setPeriods((current) => ({
          ...current,
          [period]: {
            reading,
            source: reading.source,
            loading: false,
            loaded: true,
            error,
          },
        }));
        if (period === 'daily') {
          setCompatibilityReading(mergeProviderReading(localReading, remote as ProviderDaily));
        }
        if (period === 'weekly') {
          setCompatibilityWeekly(providerWeekly(remote as ProviderWeekly));
        }
        if (reading.providerRefreshPending && period === activePeriodRef.current) {
          scheduleSilentPeriodRefreshRef.current(period, rangeKey, requestId);
        }
      } catch {
        if (requestId !== periodRequestIds.current[period]) return;
        setPeriods((current) => ({
          ...current,
          [period]: {
            ...localState,
            loading: false,
            loaded: true,
            error: LOCAL_ERROR,
          },
        }));
        if (period === 'daily') setCompatibilityReading(localReading);
        if (period === 'weekly') setCompatibilityWeekly(localWeekly);
      }
    },
    [clearSilentPeriodRefresh, liveProvider, localPeriods, localReading, localWeekly, profile],
  );

  const refreshPeriod = React.useCallback(
    (period: EnergyAstrologyPeriod): Promise<void> =>
      loadPeriod(period, periodRangeKeys.current[period]),
    [loadPeriod],
  );

  const refresh = React.useCallback(async (): Promise<void> => {
    await Promise.allSettled([loadPeriod('daily'), loadPeriod('weekly')]);
  }, [loadPeriod]);

  const loadRanking = React.useCallback(async (): Promise<void> => {
    const requestId = ++rankingRequestIdRef.current;
    if (!liveProvider) {
      setRanking({ complete: false, items: [], loaded: true, loading: false, error: null });
      return;
    }
    setRanking((current) => ({ ...current, loading: true, error: null }));
    try {
      const remote = await trpc.astrology.ranking.query({
        locale: 'zh-CN',
        timezoneOffsetMinutes: browserTimezoneOffsetMinutes(),
      });
      if (requestId !== rankingRequestIdRef.current) return;
      setRanking({ ...remote, loaded: true, loading: false, error: null });
    } catch {
      if (requestId !== rankingRequestIdRef.current) return;
      setRanking({ complete: false, items: [], loaded: true, loading: false, error: LOCAL_ERROR });
    }
  }, [liveProvider]);

  const loadSignPreview = React.useCallback(
    async (sign: ZodiacSign): Promise<void> => {
      const requestId = ++signPreviewRequestIdRef.current;
      const previewProfile = { ...profile, zodiacSign: sign };
      const localPreview = buildLocalPeriodStates(
        previewProfile,
        buildAstroReading(previewProfile),
      ).daily;
      setSignPreview({ ...localPreview, loading: liveProvider, loaded: !liveProvider });
      if (!liveProvider) return;
      try {
        const remote = await trpc.astrology.daily.query({
          ...profileInput(profile),
          zodiacSignOverride: sign,
          locale: 'zh-CN',
        });
        if (requestId !== signPreviewRequestIdRef.current) return;
        const reading = toPeriodReading(remote);
        setSignPreview({
          reading,
          source: reading.source,
          loading: false,
          loaded: true,
          error: reading.source === 'local-fallback' ? LOCAL_ERROR : null,
        });
      } catch {
        if (requestId !== signPreviewRequestIdRef.current) return;
        setSignPreview({ ...localPreview, loading: false, loaded: true, error: LOCAL_ERROR });
      }
    },
    [liveProvider, profile],
  );

  const drawYesNoTarot = React.useCallback(async (): Promise<void> => {
    const requestId = ++yesNoRequestIdRef.current;
    if (!liveProvider || !capabilitiesRef.current['yes-no-tarot']) {
      setYesNoTarot(localYesNoTarot);
      setYesNoLoading(false);
      return;
    }

    setYesNoLoading(true);
    try {
      const remote = await trpc.astrology.yesNoTarot.query({
        zodiacSign: profile.zodiacSign,
        locale: 'zh-CN',
      });
      if (requestId !== yesNoRequestIdRef.current) return;
      setYesNoTarot(providerYesNoTarot(remote));
    } catch {
      if (requestId !== yesNoRequestIdRef.current) return;
      setYesNoTarot(localYesNoTarot);
    } finally {
      if (requestId === yesNoRequestIdRef.current) setYesNoLoading(false);
    }
  }, [liveProvider, localYesNoTarot, profile.zodiacSign]);

  React.useEffect(() => {
    const statusRequestId = ++statusRequestIdRef.current;
    const requestIds = periodRequestIds.current;
    for (const period of PERIODS) {
      clearSilentPeriodRefresh(period);
      requestIds[period] += 1;
    }
    rankingRequestIdRef.current += 1;
    signPreviewRequestIdRef.current += 1;
    yesNoRequestIdRef.current += 1;
    capabilitiesRef.current = {};
    setCapabilities({});
    setPeriods(initialPeriodStates(localPeriods, liveProvider));
    setCompatibilityReading(localReading);
    setCompatibilityWeekly(localWeekly);
    setRanking({ complete: false, items: [], loaded: false, loading: false, error: null });
    setSignPreview(null);
    setYesNoTarot(null);
    setYesNoLoading(false);

    if (!liveProvider) return;
    const activePeriod = activePeriodRef.current;
    const initialRequests: Array<Promise<unknown>> = [
      trpc.astrology.status.query().then((status) => {
        if (statusRequestId !== statusRequestIdRef.current) return;
        const next = capabilityMap(status);
        capabilitiesRef.current = next;
        setCapabilities(next);
      }),
      loadPeriod('daily'),
      loadPeriod('weekly'),
    ];
    if (activePeriod !== 'daily' && activePeriod !== 'weekly') {
      initialRequests.push(
        loadPeriod(activePeriod, periodRangeKeys.current[activePeriod] ?? 'current'),
      );
    }
    void Promise.allSettled(initialRequests);

    return () => {
      statusRequestIdRef.current += 1;
      for (const period of PERIODS) {
        clearSilentPeriodRefresh(period);
        requestIds[period] += 1;
      }
      rankingRequestIdRef.current += 1;
      signPreviewRequestIdRef.current += 1;
      yesNoRequestIdRef.current += 1;
    };
  }, [clearSilentPeriodRefresh, liveProvider, loadPeriod, localPeriods, localReading, localWeekly]);

  const source = periods.daily.source === 'divineapi' ? 'provider' : 'local-fallback';
  const loading = periods.daily.loading || periods.weekly.loading;
  const initialLoading = (['daily', 'weekly'] as const).some(
    (period) => periods[period].loading && !periods[period].loaded,
  );
  const error = periods.daily.error ?? periods.weekly.error;

  return React.useMemo(
    () => ({
      reading: compatibilityReading,
      tarot: localTarot,
      weekly: compatibilityWeekly,
      yesNoTarot,
      yesNoLoading,
      source,
      loading,
      initialLoading,
      error,
      periods,
      capabilities,
      ranking,
      signPreview,
      activatePeriod,
      loadPeriod,
      refreshPeriod,
      loadRanking,
      loadSignPreview,
      refresh,
      drawYesNoTarot,
    }),
    [
      capabilities,
      activatePeriod,
      compatibilityReading,
      compatibilityWeekly,
      drawYesNoTarot,
      error,
      loadPeriod,
      loadRanking,
      loadSignPreview,
      loading,
      initialLoading,
      localTarot,
      periods,
      ranking,
      refresh,
      refreshPeriod,
      signPreview,
      source,
      yesNoLoading,
      yesNoTarot,
    ],
  );
}

function initialPeriodStates(
  localPeriods: Record<EnergyAstrologyPeriod, EnergyPeriodState>,
  liveProvider: boolean,
): Record<EnergyAstrologyPeriod, EnergyPeriodState> {
  if (!liveProvider) return localPeriods;
  return {
    ...localPeriods,
    daily: { ...localPeriods.daily, loading: true, loaded: false, error: null },
    weekly: { ...localPeriods.weekly, loading: true, loaded: false, error: null },
  };
}

function profileInput(profile: AstroProfile) {
  return {
    name: profile.name,
    birthday: profile.birthday,
    birthTime: profile.birthTime,
    birthPlace: profile.birthPlace,
    zodiacSign: profile.zodiacSign,
    timezoneOffsetMinutes: browserTimezoneOffsetMinutes(),
  };
}

function browserTimezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function queryPeriod(
  period: EnergyAstrologyPeriod,
  profile: AstroProfile,
  rangeKey: 'current' | 'next',
): Promise<
  | ProviderDaily
  | ProviderWeekly
  | AstrologyRouterOutput['monthly']
  | AstrologyRouterOutput['yearly']
> {
  const input = { ...profileInput(profile), locale: 'zh-CN' };
  if (period === 'daily') return trpc.astrology.daily.query(input);
  if (period === 'weekly') return trpc.astrology.weekly.query(input);
  if (period === 'monthly') return trpc.astrology.monthly.query({ ...input, month: rangeKey });
  return trpc.astrology.yearly.query(input);
}

function toPeriodReading(
  reading:
    | ProviderDaily
    | ProviderWeekly
    | AstrologyRouterOutput['monthly']
    | AstrologyRouterOutput['yearly'],
): EnergyPeriodReading {
  return {
    period: reading.period,
    provider: reading.provider,
    source: reading.source,
    freshness: reading.freshness,
    providerRefreshPending: reading.providerRefreshPending,
    zodiacSign: reading.zodiacSign,
    zodiacLabel: reading.zodiacLabel,
    rangeLabel: reading.rangeLabel,
    rangeKey: reading.rangeKey,
    summary: reading.summary,
    dimensions: reading.dimensions,
    luckyColors: reading.luckyColors,
    luckyNumbers: reading.luckyNumbers,
    luckyLetters: reading.luckyLetters,
    suitableTimes: reading.suitableTimes,
    sevenDayTrend: reading.sevenDayTrend,
    cosmicTip: reading.cosmicTip,
    singlesTip: reading.singlesTip,
    couplesTip: reading.couplesTip,
  };
}

function buildLocalPeriodStates(
  profile: AstroProfile,
  reading: AstroReading,
): Record<EnergyAstrologyPeriod, EnergyPeriodState> {
  return {
    daily: localPeriodState(profile, reading, 'daily', 'today', reading.dateLabel, true),
    weekly: localPeriodState(profile, reading, 'weekly', 'current', '本周能量', true),
    monthly: localPeriodState(profile, reading, 'monthly', 'current', '本月能量', false),
    yearly: localPeriodState(profile, reading, 'yearly', 'current', '本年能量', false),
  };
}

function localPeriodState(
  profile: AstroProfile,
  reading: AstroReading,
  period: EnergyAstrologyPeriod,
  rangeKey: EnergyAstrologyRangeKey,
  rangeLabel: string,
  loaded: boolean,
): EnergyPeriodState {
  const fortune = new Map(reading.fortune.map((item) => [item.key, item]));
  const copy = localPeriodCopy(period, reading);
  return {
    source: 'local-fallback',
    loading: false,
    loaded,
    error: null,
    reading: {
      period,
      provider: 'mock',
      source: 'local-fallback',
      freshness: 'local',
      providerRefreshPending: false,
      zodiacSign: profile.zodiacSign,
      zodiacLabel: reading.zodiacLabel,
      rangeLabel,
      rangeKey,
      summary: copy.summary,
      dimensions: [
        periodDimension('personal', '个人', copy.personal, fortune.get('overall')?.score),
        periodDimension(
          'health',
          '健康',
          fortune.get('health')?.body,
          fortune.get('health')?.score,
        ),
        periodDimension('profession', '工作', copy.profession, fortune.get('career')?.score),
        periodDimension('emotions', '情绪', fortune.get('love')?.body, fortune.get('love')?.score),
        periodDimension('travel', '出行', '行程保留一点弹性，会更从容。', null),
        periodDimension('luck', '好运', fortune.get('wealth')?.body, fortune.get('wealth')?.score),
      ],
      luckyColors: [reading.luckyColor],
      luckyNumbers: [],
      luckyLetters: [],
      suitableTimes: [reading.luckyWindow],
      sevenDayTrend: null,
      cosmicTip: null,
      singlesTip: null,
      couplesTip: null,
    },
  };
}

function localPeriodCopy(
  period: EnergyAstrologyPeriod,
  reading: AstroReading,
): { summary: string; personal: string; profession: string } {
  if (period === 'daily') {
    return {
      summary: reading.headline,
      personal: `今天先留意当下节奏：${reading.headline}`,
      profession: reading.workNote,
    };
  }
  if (period === 'weekly') {
    return {
      summary: `本周适合让${reading.zodiacLabel}把精力放在可持续推进上。`,
      personal: '这一周先守住稳定节奏，再为临时变化留出余量。',
      profession: '本周先完成一条清楚主线，避免每天重新选择优先级。',
    };
  }
  if (period === 'monthly') {
    return {
      summary: `本月适合${reading.zodiacLabel}整理长期方向与日常安排的关系。`,
      personal: '这个月用几次小复盘调整方向，不必在第一天确定全部答案。',
      profession: '本月给重要目标设置阶段完成点，让进展可以被看见。',
    };
  }
  return {
    summary: `本年适合${reading.zodiacLabel}围绕真正重视的主题稳步积累。`,
    personal: '这一年用持续的小选择建立想要的生活感，不追求一次改变全部。',
    profession: '本年优先积累可复用的能力和关系，让每次投入都留下长期价值。',
  };
}

function localStateForRange(
  state: EnergyPeriodState,
  period: EnergyAstrologyPeriod,
  rangeKey: 'current' | 'next',
): EnergyPeriodState {
  if (period !== 'monthly' || rangeKey !== 'next') return state;
  return {
    ...state,
    reading: {
      ...state.reading,
      rangeKey: 'next',
      rangeLabel: '下月能量',
    },
  };
}

function periodDimension(
  key: EnergyPeriodReading['dimensions'][number]['key'],
  label: string,
  body: string | undefined,
  score: number | null | undefined,
): EnergyPeriodReading['dimensions'][number] {
  return { key, label, body: body ?? '', score: score ?? null };
}

function capabilityMap(status: ProviderStatus): Record<string, boolean> {
  return Object.fromEntries(status.capabilities.map((item) => [item.capability, item.available]));
}

function buildLocalTarot(reading: AstroReading): EnergyTarotReading {
  return {
    title: 'The Star',
    subtitle: '先把希望放回桌面',
    body: `${reading.zodiacLabel} 今天适合抽一张轻提示卡。先把问题放轻一点，选一个能马上行动的小方向。`,
  };
}

function buildLocalWeekly(reading: AstroReading): EnergyWeeklyReading {
  return {
    weekLabel: '本周能量',
    personal: reading.headline,
    health: '把休息也当成计划的一部分，给身体留一点恢复时间。',
    profession: reading.workNote,
    emotions: '先看见感受，再决定今天要回应到什么程度。',
    travel: '安排保留一点弹性，临时变化也不会打乱整体节奏。',
    luck: '从一个小实验开始，真实反馈会带来下一步线索。',
    luckyColors: [reading.luckyColor],
  };
}

function buildLocalYesNoTarot(reading: AstroReading): EnergyYesNoTarotReading {
  return {
    answer: 'maybe',
    card: 'Temperance',
    category: 'Major Arcana',
    result: `${reading.zodiacLabel}今天更适合先补足一个关键信息，再做决定。`,
  };
}

function providerWeekly(weekly: ProviderWeekly): EnergyWeeklyReading {
  return {
    weekLabel: weekly.weekLabel,
    personal: weekly.personal,
    health: weekly.health,
    profession: weekly.profession,
    emotions: weekly.emotions,
    travel: weekly.travel,
    luck: weekly.luck,
    luckyColors: weekly.luckyColors,
  };
}

function providerYesNoTarot(tarot: ProviderYesNoTarot): EnergyYesNoTarotReading {
  return {
    answer: tarot.answer,
    card: tarot.card,
    category: tarot.category,
    result: tarot.result,
  };
}

function mergeProviderReading(local: AstroReading, provider: ProviderDaily): AstroReading {
  const headline = provider.headline || local.headline;
  const workNote = provider.workNote || local.workNote;
  const luckyColor = provider.luckyColor || local.luckyColor;
  const luckyColorLabel = presentLuckyColor(luckyColor).label;
  const next: AstroReading = {
    ...local,
    headline,
    workNote,
    energyScore: provider.energyScore,
    luckyColor,
    luckyWindow: provider.luckyWindow || local.luckyWindow,
    weekly: provider.weekly.length > 0 ? provider.weekly : local.weekly,
  };
  return {
    ...next,
    fortune: next.fortune.map((item) => {
      if (item.key === 'overall') {
        return {
          ...item,
          title: headline,
          body: provider.provider === 'divineapi' ? workNote : item.body,
        };
      }
      if (item.key === 'career') return { ...item, body: workNote };
      if (item.key === 'wealth') {
        return {
          ...item,
          body: `适合检查订阅、预算、报价和待确认支出。幸运色 ${luckyColorLabel} 可以当作今天的决策提醒。`,
        };
      }
      return item;
    }),
  };
}

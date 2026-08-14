import type { EnergyPeriodReading, EnergyPeriodState } from './useEnergyAstrology';

export const PROVIDER_REFRESH_PENDING_COPY = '真实星座内容更新中，将自动替换';

const DIMENSION_ORDER: EnergyPeriodReading['dimensions'][number]['key'][] = [
  'profession',
  'personal',
  'health',
  'emotions',
  'travel',
  'luck',
];

export interface LuckyInsightGroup {
  key: 'colors' | 'numbers' | 'letters' | 'times';
  label: string;
  values: string[];
}

export function periodSections(reading: EnergyPeriodReading): EnergyPeriodReading['dimensions'] {
  const dimensions = new Map(reading.dimensions.map((dimension) => [dimension.key, dimension]));
  return DIMENSION_ORDER.flatMap((key) => {
    const dimension = dimensions.get(key);
    return dimension ? [dimension] : [];
  });
}

export function luckyInsightGroups(reading: EnergyPeriodReading): LuckyInsightGroup[] {
  const groups: LuckyInsightGroup[] = [
    { key: 'colors', label: '幸运色', values: reading.luckyColors },
    { key: 'numbers', label: '幸运数字', values: reading.luckyNumbers },
    { key: 'letters', label: '幸运字母', values: reading.luckyLetters },
    { key: 'times', label: '顺手时段', values: reading.suitableTimes },
  ];
  return groups.filter((group) => group.values.length > 0);
}

export function periodSourceLabel(
  state: Pick<EnergyPeriodState, 'source' | 'reading'>,
): string {
  if (state.source === 'local-fallback') {
    return state.reading.providerRefreshPending
      ? PROVIDER_REFRESH_PENDING_COPY
      : 'Holaday 本地提示';
  }
  return state.reading.freshness === 'stale'
    ? 'DivineAPI 最近成功数据'
    : 'DivineAPI 内容';
}

export function hasCompleteRanking(ranking: EnergyAstrologyStateRanking): boolean {
  return (
    ranking.complete &&
    ranking.items.length === 12 &&
    new Set(ranking.items.map((item) => item.dateLabel)).size === 1
  );
}

interface EnergyAstrologyStateRanking {
  complete: boolean;
  items: Array<{ dateLabel: string }>;
}

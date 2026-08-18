import type { StockScreenField, StockScreenOperator } from './screening-criteria.js';

export const STOCK_PREFERENCE_WINDOW_DAYS = 90 as const;

export interface ManualStockPreferences {
  industries: string[];
  marketCaps: Array<'大盘' | '中盘' | '小盘'>;
  valuation: Array<'低估值' | '均衡估值' | '可接受成长溢价'>;
  profitability: Array<'连续盈利' | '高ROE' | '低负债'>;
  growth: Array<'收入增长' | '利润增长' | '稳定增长'>;
  cashFlow: Array<'经营现金流优先' | '自由现金流优先'>;
  volatility: Array<'低波动' | '均衡波动' | '关注高波动'>;
  liquidity: Array<'高流动性' | '普通流动性'>;
  events: Array<'回避ST' | '回避近期减持' | '关注重要公告'>;
  holdingPeriods: Array<'短期观察' | '波段研究' | '中长期'>;
}

export type StockPreferenceDimension =
  | 'industry'
  | 'marketCap'
  | 'valuation'
  | 'profitability'
  | 'growth'
  | 'cashFlow'
  | 'volatility'
  | 'liquidity'
  | 'events'
  | 'holdingPeriod'
  | 'market';

export interface StockPreferenceSignalInput {
  kind: 'screening_run';
  dataAsOf: string | null;
  occurredAt: Date;
  payload: {
    snapshotId: string;
    criteria: Array<{
      field: StockScreenField;
      operator: StockScreenOperator;
      value: boolean | number | [number, number];
    }>;
  };
}

export interface StockPreferenceWatchlistInput {
  symbol: string;
  market: string;
  createdAt: Date;
}

export interface StockPreferenceObservation {
  id: string;
  title: string;
  detail: string;
}

export interface StockPreferenceFact extends StockPreferenceObservation {
  dimension: StockPreferenceDimension;
  source: 'manual' | 'screening' | 'watchlist';
}

export interface StockPreferenceBasis extends StockPreferenceObservation {
  source: 'manual' | 'screening' | 'watchlist';
  count: number;
}

export interface StockPreferenceProfileView {
  state: 'disabled' | 'empty' | 'ready';
  enabled: boolean;
  confidence: {
    level: 'insufficient' | 'low' | 'medium' | 'high';
    label: '样本不足' | '低置信度' | '中置信度' | '高置信度';
    score: number;
    basis: string;
  };
  window: {
    days: typeof STOCK_PREFERENCE_WINDOW_DAYS;
    from: string;
    to: string;
  };
  sample: {
    screeningRuns: number;
    watchlistStocks: number;
    manualDimensions: number;
  };
  facts: StockPreferenceFact[];
  possibleStrengths: StockPreferenceObservation[];
  blindSpots: StockPreferenceObservation[];
  supplementaryViews: StockPreferenceObservation[];
  basis: StockPreferenceBasis[];
  manualPreferences: ManualStockPreferences;
}

const MANUAL_DIMENSIONS: ReadonlyArray<{
  key: keyof ManualStockPreferences;
  dimension: Exclude<StockPreferenceDimension, 'market'>;
  title: string;
}> = [
  { key: 'industries', dimension: 'industry', title: '主动设置的行业关注' },
  { key: 'marketCaps', dimension: 'marketCap', title: '主动设置的市值偏好' },
  { key: 'valuation', dimension: 'valuation', title: '主动设置的估值偏好' },
  { key: 'profitability', dimension: 'profitability', title: '主动设置的盈利质量偏好' },
  { key: 'growth', dimension: 'growth', title: '主动设置的成长偏好' },
  { key: 'cashFlow', dimension: 'cashFlow', title: '主动设置的现金流偏好' },
  { key: 'volatility', dimension: 'volatility', title: '主动设置的波动关注' },
  { key: 'liquidity', dimension: 'liquidity', title: '主动设置的流动性偏好' },
  { key: 'events', dimension: 'events', title: '主动设置的事件关注' },
  { key: 'holdingPeriods', dimension: 'holdingPeriod', title: '主动设置的研究周期' },
];

const FIELD_DIMENSIONS: Record<StockScreenField, Exclude<StockPreferenceDimension, 'industry' | 'marketCap' | 'cashFlow' | 'holdingPeriod' | 'market'>> = {
  exclude_st: 'events',
  pe_ttm: 'valuation',
  pb: 'valuation',
  turnover_ratio: 'liquidity',
  amount: 'liquidity',
  change_pct: 'volatility',
  net_profit_3y_positive: 'profitability',
  debt_ratio: 'profitability',
  roe: 'profitability',
  revenue_yoy: 'growth',
  net_profit_yoy: 'growth',
  insider_reduction_recent: 'events',
};

const SCREENING_DIMENSION_TITLES: Partial<Record<StockPreferenceDimension, string>> = {
  valuation: '筛选时持续关注估值',
  profitability: '筛选时持续关注盈利质量',
  growth: '筛选时持续关注成长指标',
  volatility: '筛选时关注价格变化',
  liquidity: '筛选时关注成交与流动性',
  events: '筛选时主动检查事件风险',
};

export function emptyManualStockPreferences(): ManualStockPreferences {
  return {
    industries: [],
    marketCaps: [],
    valuation: [],
    profitability: [],
    growth: [],
    cashFlow: [],
    volatility: [],
    liquidity: [],
    events: [],
    holdingPeriods: [],
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfWindow(now: Date): Date {
  return new Date(now.getTime() - STOCK_PREFERENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function confidence(args: {
  screeningRuns: number;
  watchlistStocks: number;
  manualDimensions: number;
  sourceCount: number;
}): StockPreferenceProfileView['confidence'] {
  const units = args.screeningRuns * 2 + args.watchlistStocks + args.manualDimensions * 2;
  const score = Math.min(100, units * 10);
  if (units === 0) {
    return { level: 'insufficient', label: '样本不足', score: 0, basis: '尚无清空后的明确设置或行为样本。' };
  }
  if (units >= 8 && args.sourceCount >= 2) {
    return { level: 'high', label: '高置信度', score, basis: `共有 ${units} 个证据权重，且来自 ${args.sourceCount} 类明确来源。` };
  }
  if (units >= 4 && args.sourceCount >= 2) {
    return { level: 'medium', label: '中置信度', score, basis: `共有 ${units} 个证据权重，仍需更多重复行为确认。` };
  }
  return { level: 'low', label: '低置信度', score, basis: `目前只有 ${units} 个证据权重，只能作为初步观察。` };
}

function sourceCount(sample: StockPreferenceProfileView['sample']): number {
  return Number(sample.manualDimensions > 0)
    + Number(sample.screeningRuns > 0)
    + Number(sample.watchlistStocks > 0);
}

function countMarkets(rows: StockPreferenceWatchlistInput[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) result.set(row.market, (result.get(row.market) ?? 0) + 1);
  return result;
}

export function buildStockPreferenceProfile(args: {
  now?: Date;
  enabled: boolean;
  clearedAt?: Date | null;
  manualPreferences: ManualStockPreferences;
  signals: StockPreferenceSignalInput[];
  watchlist: StockPreferenceWatchlistInput[];
}): StockPreferenceProfileView {
  const now = args.now ?? new Date();
  const windowStart = startOfWindow(now);
  const cutoff = args.clearedAt && args.clearedAt > windowStart ? args.clearedAt : windowStart;
  const signals = args.signals.filter((signal) => signal.occurredAt >= cutoff && signal.occurredAt <= now);
  const watchlistCutoff = args.clearedAt ?? new Date(0);
  const watchlist = args.watchlist.filter((row) => row.createdAt > watchlistCutoff && row.createdAt <= now);
  const manualDimensions = MANUAL_DIMENSIONS.filter(({ key }) => args.manualPreferences[key].length > 0);
  const sample = {
    screeningRuns: signals.length,
    watchlistStocks: watchlist.length,
    manualDimensions: manualDimensions.length,
  };
  const resultConfidence = confidence({ ...sample, sourceCount: sourceCount(sample) });
  const base = {
    enabled: args.enabled,
    confidence: resultConfidence,
    window: {
      days: STOCK_PREFERENCE_WINDOW_DAYS,
      from: isoDate(windowStart),
      to: isoDate(now),
    },
    sample,
    manualPreferences: args.manualPreferences,
  };

  if (!args.enabled) {
    return {
      ...base,
      state: 'disabled',
      facts: [],
      possibleStrengths: [],
      blindSpots: [],
      supplementaryViews: [],
      basis: [],
    };
  }

  if (resultConfidence.level === 'insufficient') {
    return {
      ...base,
      state: 'empty',
      facts: [],
      possibleStrengths: [],
      blindSpots: [],
      supplementaryViews: [],
      basis: [],
    };
  }

  const facts: StockPreferenceFact[] = manualDimensions.map(({ key, dimension, title }) => ({
    id: `manual-${dimension}`,
    dimension,
    source: 'manual',
    title,
    detail: `用户主动设置：${args.manualPreferences[key].join('、')}。`,
  }));
  const screeningCounts = new Map<StockPreferenceDimension, number>();
  for (const signal of signals) {
    const dimensions = new Set(signal.payload.criteria.map((criterion) => FIELD_DIMENSIONS[criterion.field]));
    for (const dimension of dimensions) {
      screeningCounts.set(dimension, (screeningCounts.get(dimension) ?? 0) + 1);
    }
  }
  for (const [dimension, count] of screeningCounts) {
    if (facts.some((fact) => fact.dimension === dimension)) continue;
    facts.push({
      id: `screening-${dimension}`,
      dimension,
      source: 'screening',
      title: SCREENING_DIMENSION_TITLES[dimension] ?? '筛选条件形成稳定关注',
      detail: `近 ${STOCK_PREFERENCE_WINDOW_DAYS} 天的 ${count} 次筛选明确使用了这一类条件。`,
    });
  }

  const markets = countMarkets(watchlist);
  if (watchlist.length > 0 && facts.length < 6) {
    const distribution = [...markets.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([market, count]) => `${market === 'A' ? 'A股' : market} ${count} 只`)
      .join('、');
    facts.push({
      id: 'watchlist-market',
      dimension: 'market',
      source: 'watchlist',
      title: '当前关注列表结构',
      detail: distribution,
    });
  }

  const dimensions = new Set<StockPreferenceDimension>([
    ...manualDimensions.map((item) => item.dimension),
    ...screeningCounts.keys(),
  ]);
  const possibleStrengths: StockPreferenceObservation[] = [];
  if (dimensions.has('valuation') && dimensions.has('profitability')) {
    possibleStrengths.push({
      id: 'valuation-quality-cross-check',
      title: '估值与盈利质量相互校验',
      detail: '在同一次研究里兼顾价格指标和经营质量，通常比只看单一指标更容易解释。',
    });
  }
  if (dimensions.has('liquidity')) {
    possibleStrengths.push({
      id: 'liquidity-explicit',
      title: '把成交承载能力写进条件',
      detail: '明确检查成交额或换手率，有助于识别数据上看似符合、但交易活跃度不足的候选。',
    });
  }
  if (dimensions.has('events')) {
    possibleStrengths.push({
      id: 'event-risk-explicit',
      title: '主动核对事件风险',
      detail: '把 ST、减持或其他事件条件显式列出，能让排除理由更可追溯。',
    });
  }

  const blindSpots: StockPreferenceObservation[] = [];
  if (signals.length >= 2 && screeningCounts.size <= 1) {
    blindSpots.push({
      id: 'single-factor',
      title: '条件可能集中在单一因子',
      detail: '多次筛选都落在同一类指标，其他经营或交易维度尚未形成明确证据。',
    });
  }
  const largestMarket = Math.max(0, ...markets.values());
  if (watchlist.length >= 4 && largestMarket / watchlist.length >= 0.8) {
    blindSpots.push({
      id: 'market-concentration',
      title: '关注列表集中在单一市场',
      detail: `当前 ${watchlist.length} 只清空后新增关注中，有 ${largestMarket} 只来自同一市场；这只是结构事实，不代表风险等级。`,
    });
  }
  if (dimensions.has('volatility') && !dimensions.has('profitability') && !dimensions.has('growth')) {
    blindSpots.push({
      id: 'price-without-fundamentals',
      title: '价格变化多于经营证据',
      detail: '现有明确条件更关注价格变化，盈利或成长数据尚未形成对应校验。',
    });
  }
  if (!dimensions.has('liquidity')) {
    blindSpots.push({
      id: 'liquidity-gap',
      title: '流动性尚未进入明确条件',
      detail: '当前证据没有显示成交额或换手率门槛，候选的交易活跃度可能仍需单独核对。',
    });
  }

  const supplementaryViews: StockPreferenceObservation[] = [];
  if (!dimensions.has('liquidity')) {
    supplementaryViews.push({
      id: 'add-liquidity',
      title: '补充流动性视角',
      detail: '研究时可另外查看成交额、换手率和近期缩量情况，不会自动改变现有筛选。',
    });
  }
  if (!dimensions.has('cashFlow')) {
    supplementaryViews.push({
      id: 'add-cash-flow',
      title: '补充现金流视角',
      detail: '把利润与经营现金流放在一起核对，作为独立研究步骤保留。',
    });
  }
  if (!dimensions.has('holdingPeriod')) {
    supplementaryViews.push({
      id: 'clarify-holding-period',
      title: '明确研究周期',
      detail: '先说明短期、波段或中长期研究周期，后续复核时更容易使用一致口径。',
    });
  }

  const basis: StockPreferenceBasis[] = [];
  if (sample.manualDimensions > 0) {
    basis.push({ id: 'basis-manual', source: 'manual', count: sample.manualDimensions, title: '主动设置', detail: `${sample.manualDimensions} 个维度` });
  }
  if (sample.screeningRuns > 0) {
    basis.push({ id: 'basis-screening', source: 'screening', count: sample.screeningRuns, title: '确认后执行的筛选', detail: `近 ${STOCK_PREFERENCE_WINDOW_DAYS} 天 ${sample.screeningRuns} 次` });
  }
  if (sample.watchlistStocks > 0) {
    basis.push({ id: 'basis-watchlist', source: 'watchlist', count: sample.watchlistStocks, title: '清空后新增关注', detail: `${sample.watchlistStocks} 只` });
  }

  return {
    ...base,
    state: 'ready',
    facts: facts.slice(0, 6),
    possibleStrengths: possibleStrengths.slice(0, 3),
    blindSpots: blindSpots.slice(0, 4),
    supplementaryViews: supplementaryViews.slice(0, 3),
    basis,
  };
}

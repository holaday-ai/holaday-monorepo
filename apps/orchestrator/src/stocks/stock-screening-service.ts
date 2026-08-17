import type {
  AkEnvelope,
  AnnouncementRow,
  ForecastRow,
  FundamentalsRow,
  GoodwillRow,
  InsiderChangeRow,
  PledgeRow,
  StockScreeningUniverseRow,
  ValuationRow,
} from '../agent/a-share/briefing-types.js';
import type { TradingCalendarRow } from '../agent/a-share/akshare-client.js';
import { detectAllRisks, type RiskKey } from '../agent/a-share/risk-radar-engine.js';
import { latestExpectedTradingDate } from './stock-trust.js';
import type {
  StockScreenCriterion,
  StockScreenField,
  StockScreenOperator,
} from './screening-criteria.js';

const DEEP_CHECK_LIMIT = 20 as const;
const DEEP_CHECK_CONCURRENCY = 4;
const RECENT_INSIDER_DAYS = 180;
const ANNOUNCEMENT_LOOKBACK_DAYS = 90;

const MARKET_FIELDS = new Set<StockScreenField>([
  'exclude_st',
  'pe_ttm',
  'pb',
  'turnover_ratio',
  'amount',
  'change_pct',
]);

export interface StockScreeningClient {
  getLatestTradingDay(onOrBefore: string): Promise<AkEnvelope<TradingCalendarRow>>;
  getScreeningUniverse(): Promise<AkEnvelope<StockScreeningUniverseRow>>;
  getFundamentals(symbol: string): Promise<AkEnvelope<FundamentalsRow>>;
  getValuation(symbol: string): Promise<AkEnvelope<ValuationRow>>;
  getRiskPledge(date: string, symbol: string): Promise<AkEnvelope<PledgeRow>>;
  getRiskGoodwill(date: string, symbol: string): Promise<AkEnvelope<GoodwillRow>>;
  getRiskForecast(date: string, symbol: string): Promise<AkEnvelope<ForecastRow>>;
  getRiskInsider(symbol: string): Promise<AkEnvelope<InsiderChangeRow>>;
  getStockAnnouncements(
    symbol: string,
    startDate?: string,
    endDate?: string,
  ): Promise<AkEnvelope<AnnouncementRow>>;
}

export class StockScreeningFreshnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockScreeningFreshnessError';
  }
}

export class StockScreeningDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockScreeningDataError';
  }
}

export interface StockScreeningWarning {
  key: string;
  severity: '关注' | '警示' | '高风险';
  label: string;
  finding: string;
  source: string;
  asOf: string | null;
}

export interface StockScreeningEvidence {
  id: string;
  label: string;
  source: string;
  asOf: string | null;
}

export interface StockCandidateMatch {
  symbol: string;
  name: string;
  snapshotId: string;
  dataAsOf: string;
  matchedCriteria: string[];
  unmetCriteria: string[];
  missingCriteria: string[];
  warnings: StockScreeningWarning[];
  evidence: StockScreeningEvidence[];
}

export interface StockScreeningResult {
  snapshotId: string;
  dataAsOf: string;
  coverage: {
    universeCount: number;
    marketPrefilterCount: number;
    deepCheckedCount: number;
    deepCheckLimit: typeof DEEP_CHECK_LIMIT;
    truncated: boolean;
  };
  candidates: StockCandidateMatch[];
  zeroResult: boolean;
}

type CriterionState = 'matched' | 'unmet' | 'missing';

interface CandidateEvaluation extends StockCandidateMatch {
  amount: number;
}

interface DeepSources {
  fundamentals: AkEnvelope<FundamentalsRow>;
  valuation: AkEnvelope<ValuationRow>;
  pledge: AkEnvelope<PledgeRow>;
  goodwill: AkEnvelope<GoodwillRow>;
  forecast: AkEnvelope<ForecastRow>;
  insider: AkEnvelope<InsiderChangeRow>;
  announcements: AkEnvelope<AnnouncementRow>;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function compare(
  actual: number | boolean | null,
  operator: StockScreenOperator,
  expected: StockScreenCriterion['value'],
): CriterionState {
  if (actual === null || expected === null) return 'missing';
  if (operator === 'eq') return actual === expected ? 'matched' : 'unmet';
  if (typeof actual !== 'number') return 'missing';
  if (operator === 'between') {
    if (!Array.isArray(expected)) return 'missing';
    return actual >= expected[0] && actual <= expected[1] ? 'matched' : 'unmet';
  }
  if (typeof expected !== 'number') return 'missing';
  const matches = {
    gt: actual > expected,
    gte: actual >= expected,
    lt: actual < expected,
    lte: actual <= expected,
  }[operator];
  return matches ? 'matched' : 'unmet';
}

function marketValue(
  row: StockScreeningUniverseRow,
  field: StockScreenField,
): number | boolean | null {
  if (field === 'exclude_st') {
    const name = typeof row.名称 === 'string' ? row.名称.trim() : '';
    return name ? !/^(?:\*?ST)/i.test(name) : null;
  }
  const keys: Partial<Record<StockScreenField, keyof StockScreeningUniverseRow>> = {
    pe_ttm: '市盈率TTM',
    pb: '市净率',
    turnover_ratio: '换手率',
    amount: '成交额',
    change_pct: '涨跌幅',
  };
  const key = keys[field];
  return key ? numberOrNull(row[key]) : null;
}

function evaluateMarketCriterion(
  row: StockScreeningUniverseRow,
  criterion: StockScreenCriterion,
): CriterionState {
  return compare(marketValue(row, criterion.field), criterion.operator, criterion.value);
}

function parseIsoDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value}T00:00:00Z`;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function withinDaysOnOrBefore(value: string | undefined, endDate: string, days: number): boolean {
  const valueTime = parseIsoDate(value);
  const endTime = parseIsoDate(endDate);
  if (valueTime === null || endTime === null) return false;
  const difference = endTime - valueTime;
  return difference >= 0 && difference <= days * 24 * 60 * 60 * 1000;
}

function compactDate(date: string): string {
  return date.replaceAll('-', '');
}

function subtractDays(date: string, days: number): string {
  const time = parseIsoDate(date);
  if (time === null) return compactDate(date);
  return new Date(time - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '');
}

function firstRow<T>(envelope: AkEnvelope<T>): T | undefined {
  return envelope.error ? undefined : envelope.data[0];
}

function deepValue(
  criterion: StockScreenCriterion,
  sources: DeepSources,
  recentInsider: InsiderChangeRow[],
): number | boolean | null {
  const fundamentals = firstRow(sources.fundamentals);
  switch (criterion.field) {
    case 'net_profit_3y_positive': {
      const profits = fundamentals?.trend3y?.map((row) => numberOrNull(row.net_profit)) ?? [];
      if (profits.length < 3 || profits.slice(-3).some((profit) => profit === null)) return null;
      return profits.slice(-3).every((profit) => (profit ?? 0) > 0);
    }
    case 'debt_ratio':
      return numberOrNull(fundamentals?.debt_ratio);
    case 'roe':
      return numberOrNull(fundamentals?.roe);
    case 'revenue_yoy':
      return numberOrNull(fundamentals?.revenue_yoy);
    case 'net_profit_yoy':
      return numberOrNull(fundamentals?.net_profit_yoy);
    case 'insider_reduction_recent':
      if (sources.insider.error) return null;
      return recentInsider.some((row) => (numberOrNull(row.变动数) ?? 0) < 0);
    default:
      return null;
  }
}

function newestDate(rows: Array<Record<string, unknown>>, key: string): string | null {
  const dates = rows
    .map((row) => row[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((a, b) => b.localeCompare(a));
  return dates[0] ?? null;
}

function warningSource(key: RiskKey, sources: DeepSources): AkEnvelope<unknown> {
  if (key === 'pledge') return sources.pledge;
  if (key === 'goodwill') return sources.goodwill;
  if (key === 'forecast') return sources.forecast;
  if (key === 'insider') return sources.insider;
  return sources.announcements;
}

function warningAsOf(
  key: RiskKey,
  sources: DeepSources,
  recentInsider: InsiderChangeRow[],
  fallback: string,
): string | null {
  if (key === 'pledge') return newestDate(sources.pledge.data, '交易日期') ?? fallback;
  if (key === 'goodwill') return newestDate(sources.goodwill.data, '公告日期') ?? fallback;
  if (key === 'forecast') return newestDate(sources.forecast.data, '公告日期') ?? fallback;
  if (key === 'insider') return newestDate(recentInsider, '变动日期') ?? fallback;
  return newestDate(sources.announcements.data, '公告时间') ?? fallback;
}

function sourceForCriterion(field: StockScreenField, sources: DeepSources): AkEnvelope<unknown> {
  if (field === 'insider_reduction_recent') return sources.insider;
  if (field === 'pe_ttm' || field === 'pb') return sources.valuation;
  return sources.fundamentals;
}

async function loadDeepSources(
  client: StockScreeningClient,
  symbol: string,
  dataAsOf: string,
): Promise<DeepSources> {
  const date = compactDate(dataAsOf);
  const startDate = subtractDays(dataAsOf, ANNOUNCEMENT_LOOKBACK_DAYS);
  const [fundamentals, valuation, pledge, goodwill, forecast, insider, announcements] =
    await Promise.all([
      client.getFundamentals(symbol),
      client.getValuation(symbol),
      client.getRiskPledge(date, symbol),
      client.getRiskGoodwill(date, symbol),
      client.getRiskForecast(date, symbol),
      client.getRiskInsider(symbol),
      client.getStockAnnouncements(symbol, startDate, date),
    ]);
  return { fundamentals, valuation, pledge, goodwill, forecast, insider, announcements };
}

async function evaluateCandidate(args: {
  client: StockScreeningClient;
  row: StockScreeningUniverseRow;
  snapshotId: string;
  dataAsOf: string;
  criteria: StockScreenCriterion[];
  marketStates: Map<string, CriterionState>;
}): Promise<CandidateEvaluation> {
  const { client, row, snapshotId, dataAsOf, criteria, marketStates } = args;
  const symbol = String(row.代码 ?? '');
  const sources = await loadDeepSources(client, symbol, dataAsOf);
  const recentInsider = (sources.insider.error ? [] : sources.insider.data).filter((item) =>
    withinDaysOnOrBefore(item.变动日期, dataAsOf, RECENT_INSIDER_DAYS),
  );
  const matchedCriteria: string[] = [];
  const unmetCriteria: string[] = [];
  const missingCriteria: string[] = [];
  const evidence: StockScreeningEvidence[] = [];

  for (const criterion of criteria) {
    const state = MARKET_FIELDS.has(criterion.field)
      ? (marketStates.get(criterion.id) ?? 'missing')
      : compare(
          deepValue(criterion, sources, recentInsider),
          criterion.operator,
          criterion.value,
        );
    if (state === 'matched') matchedCriteria.push(criterion.label);
    else if (state === 'unmet') unmetCriteria.push(criterion.label);
    else missingCriteria.push(criterion.label);

    const source = MARKET_FIELDS.has(criterion.field)
      ? 'sina:screening'
      : sourceForCriterion(criterion.field, sources).source;
    evidence.push({
      id: `screen:${snapshotId}:${symbol}:criterion:${criterion.id}`,
      label: criterion.label,
      source,
      asOf: dataAsOf,
    });
  }

  const fundamentals = firstRow(sources.fundamentals);
  const eps = numberOrNull(fundamentals?.eps_basic);
  const netProfit = numberOrNull(fundamentals?.net_profit);
  const totalShares = eps !== null && eps > 0 && netProfit !== null ? netProfit / eps : null;
  const risks = detectAllRisks({
    pledge: firstRow(sources.pledge),
    goodwill: firstRow(sources.goodwill),
    forecast: firstRow(sources.forecast),
    insider: recentInsider,
    announcements: sources.announcements.error ? [] : sources.announcements.data,
    totalShares,
  });
  const warnings = risks.map((risk): StockScreeningWarning => {
    const source = warningSource(risk.key, sources);
    return {
      key: risk.key,
      severity: risk.star ? '警示' : '关注',
      label: risk.label,
      finding: risk.finding,
      source: source.source,
      asOf: warningAsOf(risk.key, sources, recentInsider, dataAsOf),
    };
  });
  for (const warning of warnings) {
    evidence.push({
      id: `screen:${snapshotId}:${symbol}:risk:${warning.key}`,
      label: `风险·${warning.label}`,
      source: warning.source,
      asOf: warning.asOf,
    });
  }

  return {
    symbol,
    name: typeof row.名称 === 'string' ? row.名称 : symbol,
    snapshotId,
    dataAsOf,
    matchedCriteria,
    unmetCriteria,
    missingCriteria,
    warnings,
    evidence,
    amount: numberOrNull(row.成交额) ?? 0,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index] as T);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function candidateRank(candidate: CandidateEvaluation): number {
  if (candidate.unmetCriteria.length === 0 && candidate.missingCriteria.length === 0) return 0;
  if (candidate.unmetCriteria.length === 0) return 1;
  return 2;
}

export async function runStockScreening(args: {
  client: StockScreeningClient;
  snapshotId: string;
  dataAsOf: string;
  criteria: StockScreenCriterion[];
  now?: Date;
}): Promise<StockScreeningResult> {
  const { client, snapshotId, dataAsOf, criteria } = args;
  const expectedTradingDate = await latestExpectedTradingDate(client, args.now ?? new Date());
  if (expectedTradingDate.status !== 'verified' || !expectedTradingDate.date) {
    throw new StockScreeningFreshnessError('暂时无法核验最新交易日，请刷新行情后重试。');
  }
  if (expectedTradingDate.date !== dataAsOf) {
    throw new StockScreeningFreshnessError('股票快照已不是最新交易日，请刷新页面后重试。');
  }
  const universeEnvelope = await client.getScreeningUniverse();
  if (universeEnvelope.error || universeEnvelope.data.length === 0) {
    throw new StockScreeningDataError('全市场筛选数据暂不可用，请稍后重试。');
  }
  const universe = universeEnvelope.data;
  const marketCriteria = criteria.filter((criterion) => MARKET_FIELDS.has(criterion.field));
  const marketStatesBySymbol = new Map<string, Map<string, CriterionState>>();
  const prefiltered = universe.filter((row) => {
    const symbol = String(row.代码 ?? '');
    const states = new Map(
      marketCriteria.map((criterion) => [
        criterion.id,
        evaluateMarketCriterion(row, criterion),
      ]),
    );
    marketStatesBySymbol.set(symbol, states);
    return [...states.values()].every((state) => state === 'matched');
  });
  const ordered = [...prefiltered].sort(
    (left, right) => (numberOrNull(right.成交额) ?? 0) - (numberOrNull(left.成交额) ?? 0),
  );
  const selected = ordered.slice(0, DEEP_CHECK_LIMIT);
  const evaluated = await mapWithConcurrency(
    selected,
    DEEP_CHECK_CONCURRENCY,
    async (row) => evaluateCandidate({
      client,
      row,
      snapshotId,
      dataAsOf,
      criteria,
      marketStates: marketStatesBySymbol.get(String(row.代码 ?? '')) ?? new Map(),
    }),
  );
  evaluated.sort((left, right) => {
    const rankDifference = candidateRank(left) - candidateRank(right);
    return rankDifference || right.amount - left.amount || left.symbol.localeCompare(right.symbol);
  });
  const candidates = evaluated.map(({ amount: _amount, ...candidate }) => candidate);

  return {
    snapshotId,
    dataAsOf,
    coverage: {
      universeCount: universe.length,
      marketPrefilterCount: prefiltered.length,
      deepCheckedCount: selected.length,
      deepCheckLimit: DEEP_CHECK_LIMIT,
      truncated: prefiltered.length > DEEP_CHECK_LIMIT,
    },
    candidates,
    zeroResult: !candidates.some(
      (candidate) =>
        candidate.unmetCriteria.length === 0 && candidate.missingCriteria.length === 0,
    ),
  };
}

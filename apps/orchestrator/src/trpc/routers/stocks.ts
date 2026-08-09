import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { HttpAkshareClient } from '../../agent/a-share/akshare-http-client.js';
import {
  buildPostmarketBriefing,
  buildPremarketBriefing,
  listWatchlistForUser,
} from '../../agent/a-share/briefing-service.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  IndexRow,
  IntradayRow,
  KlineRow,
  MarketPulseRow,
  SectorEntry,
  StockQuoteRow,
  StockRankingRow,
  StockNewsRow,
  WatchlistEntry,
} from '../../agent/a-share/briefing-types.js';
import type { SymbolRow } from '../../agent/a-share/akshare-client.js';
import { fmtNum, fmtYiYuan, pick, toNum } from '../../agent/a-share/ashare-format.js';
import { stockDashboardSnapshots } from '../../db/schema/stock-dashboard-snapshots.js';
import { users } from '../../db/schema/users.js';
import { resolveNewsDetail } from '../../stock-news/article-detail.js';
import { protectedProcedure, router } from '../trpc.js';

type Db = typeof import('../../db/client.js').db;
interface MinimalLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

type Market = 'A' | 'HK' | 'US';
type Signal = '强势' | '偏强' | '中性' | '偏弱' | '风险升高' | '待观察';
type VolumeSignal = '放量' | '缩量' | '接近均量' | '待观察';

interface StockSnapshot {
  symbol: string;
  name: string;
  market: Market;
  price: string;
  changePct: number;
  signal: Signal;
  report: '已生成' | '待生成' | '生成中';
  spark: number[];
  sparkLabels: string[];
  sparkKind: 'daily_close' | 'intraday';
  sparkBaseline: number | null;
  sparkTradeDate?: string | null;
  tradeDate?: string | null;
  turnoverAmount: number | null;
  averageTurnoverAmount: number | null;
  volume: number | null;
  averageVolume: number | null;
  volumeRatio: number | null;
  volumeSignal: VolumeSignal;
  newsCount: number;
  note: string;
}

interface IndexSnapshot {
  name: string;
  price: string;
  changePct: number;
  turnover: string;
}

interface SectorSnapshot {
  name: string;
  changePct: number;
  leader: string;
  flow: string;
  spark: number[];
}

type DiscoveryFeed = '自选股新闻' | '重要公告' | 'A股要闻' | '美股要闻' | '港股要闻';
type MarketDiscoveryFeed = Extract<DiscoveryFeed, 'A股要闻' | '美股要闻' | '港股要闻'>;

interface NewsSnapshot {
  /** `盘面` / `关注` 仅兼容已缓存的旧快照；新发现流只写入新闻或公告。 */
  category: '公告' | '新闻' | '盘面' | '关注';
  /** 展示层栏目；旧快照未写入时由前端按类别兼容。 */
  feed?: DiscoveryFeed;
  time: string;
  /** 原始来源的发布时间，仅用于稳定排序。 */
  publishedAt?: string;
  title: string;
  symbols: string[];
  source: string;
  url?: string;
  summary?: string;
  /** 发布方封面优先；未提供封面时使用按主题匹配的本地素材。 */
  imageUrl?: string;
  imageKind?: 'source-cover' | 'editorial-art';
  /** 当前主题可安全轮换的本地素材，供前端处理重复或加载失败的封面。 */
  editorialArtOptions?: string[];
}

interface LeaderSnapshot {
  rank: number;
  name: string;
  price: string;
  changePct: number;
  reason: string;
}

interface LeaderboardsSnapshot {
  gainers: LeaderSnapshot[];
  losers: LeaderSnapshot[];
  amount: LeaderSnapshot[];
}

interface DashboardFreshness {
  status: 'fresh' | 'refreshing' | 'stale' | 'partial';
  cachedAt: string;
  message?: string;
}

interface DashboardSnapshot {
  updatedAt: string;
  observedTradeDate?: string | null;
  source: 'akshare';
  isFallbackWatchlist: boolean;
  watchlistStocks: StockSnapshot[];
  marketIndices: IndexSnapshot[];
  sectors: SectorSnapshot[];
  starStocks: StockSnapshot[];
  temperature: ReturnType<typeof marketTemperature>;
  news: NewsSnapshot[];
  leaders: LeaderSnapshot[];
  leaderboards: LeaderboardsSnapshot;
  freshness: DashboardFreshness;
}

interface DashboardCacheEntry {
  snapshot?: DashboardSnapshot;
  freshUntil: number;
  staleUntil: number;
  refreshPromise?: Promise<DashboardSnapshot>;
}

const POPULAR_A_SYMBOLS = [
  { symbol: '600519', name: '贵州茅台' },
  { symbol: '300750', name: '宁德时代' },
  { symbol: '000001', name: '平安银行' },
  { symbol: '002594', name: '比亚迪' },
  { symbol: '601318', name: '中国平安' },
  { symbol: '600036', name: '招商银行' },
  { symbol: '000858', name: '五粮液' },
  { symbol: '601012', name: '隆基绿能' },
  { symbol: '688981', name: '中芯国际' },
  { symbol: '600900', name: '长江电力' },
  { symbol: '000725', name: '京东方A' },
  { symbol: '603986', name: '兆易创新' },
  { symbol: '300308', name: '中际旭创' },
];

const DASHBOARD_FRESH_TTL_MS = 15_000;
const DASHBOARD_PARTIAL_FRESH_TTL_MS = 5_000;
const DASHBOARD_STALE_TTL_MS = 10 * 60_000;
const DASHBOARD_FIRST_PAINT_BUDGET_MS = 5_500;
const DASHBOARD_AKSHARE_TIMEOUT_MS = 8_000;
const DASHBOARD_SLOW_SIGNAL_TIMEOUT_MS = 90_000;
const DASHBOARD_RANKING_TIMEOUT_MS = 75_000;
const DASHBOARD_DISCOVERY_TIMEOUT_MS = 12_000;
const MARKET_DISCOVERY_PAGE_SIZES: Record<MarketDiscoveryFeed, number> = {
  'A股要闻': 30,
  '美股要闻': 12,
  '港股要闻': 12,
};
const dashboardCache = new Map<string, DashboardCacheEntry>();

function unavailableStock(entry: WatchlistEntry, note = '真实行情暂不可用，未展示走势线'): StockSnapshot {
  return {
    symbol: entry.symbol,
    name: entry.displayName ?? entry.symbol,
    market: entry.market as Market,
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    sparkLabels: [],
    sparkKind: 'daily_close',
    sparkBaseline: null,
    sparkTradeDate: null,
    tradeDate: null,
    turnoverAmount: null,
    averageTurnoverAmount: null,
    volume: null,
    averageVolume: null,
    volumeRatio: null,
    volumeSignal: '待观察',
    newsCount: 0,
    note,
  };
}

async function requireUserId(db: Db, externalUserId: string): Promise<number> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, externalUserId))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  return row.id;
}

function dashboardCacheKey(userInternalId: number, watchlist: WatchlistEntry[]): string {
  const signature = watchlist
    .map((entry) => [
      entry.symbol.trim().toUpperCase(),
      entry.market,
      entry.displayName?.trim() ?? '',
    ].join(':'))
    .join('|');
  return `${userInternalId}:${signature}`;
}

function dashboardPersistedCacheKey(cacheKey: string): string {
  return createHash('sha256').update(cacheKey).digest('hex');
}

function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DashboardSnapshot>;
  return (
    candidate.source === 'akshare' &&
    Array.isArray(candidate.watchlistStocks) &&
    Array.isArray(candidate.marketIndices) &&
    Array.isArray(candidate.sectors) &&
    Array.isArray(candidate.news) &&
    Array.isArray(candidate.leaders) &&
    typeof candidate.freshness === 'object' &&
    candidate.freshness !== null
  );
}

function hasDisplayableRealDashboardData(snapshot: DashboardSnapshot): boolean {
  const hasWatchlistData = snapshot.watchlistStocks.some((stockRow) =>
    stockRow.price !== '—' ||
    stockRow.spark.length >= 2 ||
    stockRow.turnoverAmount !== null ||
    stockRow.volume !== null);
  return (
    hasWatchlistData ||
    snapshot.marketIndices.length > 0 ||
    snapshot.sectors.length > 0 ||
    snapshot.news.length > 0 ||
    snapshot.leaderboards.gainers.length > 0 ||
    snapshot.leaderboards.losers.length > 0 ||
    snapshot.leaderboards.amount.length > 0
  );
}

function dashboardNeedsWatchlistIntradayRefresh(snapshot: DashboardSnapshot): boolean {
  const realWatchlistQuotes = snapshot.watchlistStocks.filter((stockRow) =>
    stockRow.market === 'A' && stockRow.price !== '—');
  return (
    realWatchlistQuotes.length > 0 &&
    realWatchlistQuotes.every((stockRow) => stockRow.sparkKind === 'intraday' && stockRow.spark.length < 2)
  );
}

async function loadPersistedDashboardSnapshot(args: {
  db: Db;
  logger: MinimalLogger;
  userInternalId: number;
  cacheKey: string;
}): Promise<DashboardSnapshot | undefined> {
  try {
    const [row] = await args.db
      .select({ snapshotJson: stockDashboardSnapshots.snapshotJson })
      .from(stockDashboardSnapshots)
      .where(and(
        eq(stockDashboardSnapshots.userId, args.userInternalId),
        eq(stockDashboardSnapshots.cacheKeyHash, dashboardPersistedCacheKey(args.cacheKey)),
      ))
      .limit(1);
    if (!row || !isDashboardSnapshot(row.snapshotJson)) return undefined;
    return markRefreshing(
      dashboardWithObservedIntraday(row.snapshotJson, new Date()),
      '行情接口正在刷新，当前展示最近一次真实数据。',
    );
  } catch (error) {
    args.logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'stocks-dashboard: persisted snapshot read failed',
    );
    return undefined;
  }
}

async function persistDashboardSnapshot(args: {
  db: Db;
  logger: MinimalLogger;
  userInternalId: number;
  cacheKey: string;
  snapshot: DashboardSnapshot;
}): Promise<void> {
  if (!hasDisplayableRealDashboardData(args.snapshot)) return;
  try {
    await args.db
      .insert(stockDashboardSnapshots)
      .values({
        userId: args.userInternalId,
        cacheKeyHash: dashboardPersistedCacheKey(args.cacheKey),
        snapshotJson: args.snapshot,
      })
      .onDuplicateKeyUpdate({
        set: {
          snapshotJson: args.snapshot,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        },
      });
  } catch (error) {
    args.logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'stocks-dashboard: persisted snapshot write failed',
    );
  }
}

function withFreshness(
  snapshot: Omit<DashboardSnapshot, 'freshness'>,
  freshness: DashboardFreshness,
): DashboardSnapshot {
  return { ...snapshot, freshness };
}

function markRefreshing(snapshot: DashboardSnapshot, message: string): DashboardSnapshot {
  return {
    ...snapshot,
    freshness: {
      ...snapshot.freshness,
      status: 'refreshing',
      message,
    },
  };
}

function fallbackLeaderboards(): LeaderboardsSnapshot {
  return { gainers: [], losers: [], amount: [] };
}

function emptyEnvelope<T>(source: string): AkEnvelope<T> {
  return {
    data: [],
    count: 0,
    source,
    fetched_at: new Date().toISOString(),
    disclaimer: '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。',
  };
}

function buildPartialDashboardSnapshot(
  _watchlistRows: WatchlistEntry[],
  effectiveWatchlist: WatchlistEntry[],
  now = new Date(),
  message = '行情刷新仍在进行，先展示真实关注列表。',
): DashboardSnapshot {
  const watchlistStocks = effectiveWatchlist
    .slice(0, 8)
    .map((entry) => unavailableStock(entry));
  const leaderboards = fallbackLeaderboards();
  return withFreshness(
    {
      updatedAt: now.toISOString(),
      observedTradeDate: null,
      source: 'akshare',
      isFallbackWatchlist: false,
      watchlistStocks,
      marketIndices: [],
      sectors: [],
      starStocks: [],
      temperature: null,
      news: [],
      leaders: leaderboards.gainers,
      leaderboards,
    },
    {
      status: 'partial',
      cachedAt: now.toISOString(),
      message,
    },
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function cnDateParts(now = new Date()): { iso: string; compact: string } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return { iso, compact: iso.replace(/-/g, '') };
}

function cnCompactDaysAgo(now: Date, days: number): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return cnDateParts(date).compact;
}

function signalFromChange(changePct: number): Signal {
  if (changePct >= 1) return '强势';
  if (changePct > 0) return '偏强';
  if (changePct <= -1) return '偏弱';
  if (changePct < 0) return '偏弱';
  return '中性';
}

function sparkSeriesFromKline(rows: KlineRow[]): { values: number[]; labels: string[] } {
  const series = rows
    .slice(-8)
    .map((row) => ({
      value: toNum(pick(row, ['收盘', 'close', '最新价'])),
      label: String(pick(row, ['日期', 'date']) ?? '').trim(),
    }))
    .filter((point): point is { value: number; label: string } => point.value !== null && point.label.length > 0);
  return series.length >= 2
    ? {
        values: series.map((point) => point.value),
        labels: series.map((point) => point.label),
      }
    : { values: [], labels: [] };
}

function sparkSeriesFromIntraday(rows: IntradayRow[], now = new Date()): { values: number[]; labels: string[] } {
  const rawPoints = rows
    .map((row) => ({
      value: toNum(pick(row, ['最新价', '收盘', 'close', 'price'])),
      label: String(pick(row, ['时间', 'time', 'datetime']) ?? '').trim(),
    }))
    .filter((point): point is { value: number; label: string } =>
      point.value !== null &&
      point.label.length > 0);
  const series = observedIntradayPointsForNow(rawPoints, now);
  return series.length >= 2
    ? {
        values: series.map((point) => point.value),
        labels: series.map((point) => point.label),
      }
    : { values: [], labels: [] };
}

function previousCloseFromSeries(series: { values: number[]; labels: string[] }, intradayLabel: string | undefined): number | null {
  if (series.values.length === 0) return null;
  const intradayDate = datePart(intradayLabel);
  const lastIndex = series.values.length - 1;
  const lastDailyDate = datePart(series.labels[lastIndex]);
  if (intradayDate && lastDailyDate && lastDailyDate >= intradayDate && series.values.length >= 2) {
    return series.values[lastIndex - 1] ?? null;
  }
  return series.values[lastIndex] ?? null;
}

function datePart(value: string | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function intradayMinuteOfDay(value: string | undefined): number | null {
  const match = /(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function isAShareSessionMinute(minuteOfDay: number): boolean {
  return (
    (minuteOfDay >= 9 * 60 + 30 && minuteOfDay <= 11 * 60 + 30) ||
    (minuteOfDay >= 13 * 60 && minuteOfDay <= 15 * 60)
  );
}

function shanghaiDateMinute(now: Date): { date: string; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function observedIntradayPointsForNow(
  points: Array<{ label: string; value: number }>,
  now: Date,
): Array<{ label: string; value: number }> {
  const current = shanghaiDateMinute(now);
  const datedPoints = points.filter((point) => {
    const labelDate = datePart(point.label);
    const labelMinute = intradayMinuteOfDay(point.label);
    return (
      labelDate !== null &&
      labelDate <= current.date &&
      labelMinute !== null &&
      isAShareSessionMinute(labelMinute) &&
      (labelDate < current.date || labelMinute <= current.minuteOfDay) &&
      Number.isFinite(point.value)
    );
  });
  const tradeDate = datedPoints
    .map((point) => datePart(point.label))
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);
  if (!tradeDate) return [];
  const sorted = datedPoints
    .filter((point) => intradayLabelBelongsToObservedSession(point.label, now, tradeDate))
    .sort((left, right) => left.label.localeCompare(right.label));
  const byMinute = new Map<string, { label: string; value: number }>();
  for (const point of sorted) {
    const minute = intradayMinuteOfDay(point.label);
    if (minute !== null) byMinute.set(`${tradeDate}:${minute}`, point);
  }
  return [...byMinute.values()];
}

function intradayLabelBelongsToObservedSession(label: string, now: Date, tradeDate: string): boolean {
  const labelDate = datePart(label);
  const labelMinute = intradayMinuteOfDay(label);
  if (!labelDate || labelMinute === null || labelDate !== tradeDate) return false;
  const current = shanghaiDateMinute(now);
  if (labelDate > current.date) return false;
  if (labelDate < current.date) return true;
  return labelMinute <= current.minuteOfDay;
}

function observedIntradayStockForNow(stockRow: StockSnapshot, now: Date): StockSnapshot {
  if (stockRow.sparkKind !== 'intraday' || stockRow.spark.length < 2) return stockRow;
  const rawPoints = stockRow.sparkLabels
    .slice(0, stockRow.spark.length)
    .map((label, index) => ({
      label,
      value: stockRow.spark[index],
    }))
    .filter((point): point is { label: string; value: number } =>
      typeof point.value === 'number' &&
      Number.isFinite(point.value));
  const points = observedIntradayPointsForNow(rawPoints, now);
  const sparkTradeDate = points.length >= 2 ? datePart(points[points.length - 1]?.label) : null;
  const pointsUnchanged =
    points.length === stockRow.spark.length &&
    points.every(
      (point, index) =>
        point.label === stockRow.sparkLabels[index] &&
        point.value === stockRow.spark[index],
    );
  if (pointsUnchanged) {
    return stockRow.sparkTradeDate === sparkTradeDate ? stockRow : { ...stockRow, sparkTradeDate };
  }
  return {
    ...stockRow,
    spark: points.length >= 2 ? points.map((point) => point.value) : [],
    sparkLabels: points.length >= 2 ? points.map((point) => point.label) : [],
    sparkTradeDate,
  };
}

function observedTradeDateFromStocks(stocks: StockSnapshot[]): string | null {
  const dates = stocks
    .flatMap((stockRow) => [stockRow.sparkTradeDate, stockRow.tradeDate])
    .map((value) => datePart(value ?? undefined))
    .filter((value): value is string => value !== null)
    .sort();
  return dates.at(-1) ?? null;
}

function dashboardWithObservedIntraday(snapshot: DashboardSnapshot, now: Date): DashboardSnapshot {
  const watchlistStocks = snapshot.watchlistStocks.map((stockRow) => observedIntradayStockForNow(stockRow, now));
  const bySymbol = new Map(watchlistStocks.map((stockRow) => [stockRow.symbol, stockRow]));
  const starStocks = snapshot.starStocks.map((stockRow) =>
    bySymbol.get(stockRow.symbol) ?? observedIntradayStockForNow(stockRow, now));
  return {
    ...snapshot,
    observedTradeDate: observedTradeDateFromStocks(watchlistStocks),
    watchlistStocks,
    starStocks,
    news: normalizeDiscoveryEditorialArt(snapshot.news),
  };
}

function dashboardReferenceDate(snapshot: DashboardSnapshot): Date {
  const parsed = new Date(snapshot.updatedAt || snapshot.freshness.cachedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function latestKline(rows: KlineRow[]): KlineRow | null {
  return rows.length > 0 ? rows[rows.length - 1] ?? null : null;
}

function latestQuote(env: AkEnvelope<StockQuoteRow>): StockQuoteRow | null {
  if (env.error || env.data.length === 0) return null;
  return env.data[0] ?? null;
}

async function stockSnapshot(
  client: HttpAkshareClient,
  entry: WatchlistEntry,
  index: number,
  now: Date,
): Promise<StockSnapshot> {
  void index;
  if (entry.market !== 'A') return unavailableStock(entry, '当前行情源仅接入 A 股真实数据');

  const [dailyEnv, seriesEnv, intradayEnv, quoteEnv] = await Promise.all([
    client.getStockKline(entry.symbol),
    client.getStockKline(entry.symbol, 8),
    client.getStockIntraday(entry.symbol),
    client.getStockQuote(entry.symbol),
  ]);
  const last = latestKline(dailyEnv.data);
  const quote = latestQuote(quoteEnv);
  const sparkSeries = seriesEnv.error ? { values: [], labels: [] } : sparkSeriesFromKline(seriesEnv.data);
  const intradaySeries = intradayEnv.error ? { values: [], labels: [] } : sparkSeriesFromIntraday(intradayEnv.data, now);
  const hasIntraday = intradaySeries.values.length >= 2;
  const sparkTradeDate = hasIntraday ? datePart(intradaySeries.labels[intradaySeries.labels.length - 1]) : null;
  const tradeDate = datePart(String(last ? pick(last, ['日期', 'date']) ?? '' : '')) ?? sparkTradeDate;
  const latestIntraday = hasIntraday ? intradaySeries.values[intradaySeries.values.length - 1] : null;
  const close = quote
    ? pick(quote, ['最新价', 'price', '收盘', 'close'])
    : last
      ? pick(last, ['收盘', 'close', '最新价'])
      : latestIntraday;
  if (close == null) return unavailableStock(entry, 'AkShare 暂未返回该股票行情');
  const sparkBaseline = previousCloseFromSeries(sparkSeries, intradaySeries.labels[0]);
  const changePct =
    toNum(quote ? pick(quote, ['涨跌幅', 'changePct']) : last ? pick(last, ['涨跌幅', 'changePct']) : null) ??
    (typeof sparkBaseline === 'number' && sparkBaseline > 0
      ? (((toNum(close) ?? sparkBaseline) - sparkBaseline) / sparkBaseline) * 100
      : null);
  if (changePct === null) {
    return unavailableStock(entry, '真实价格已返回，但缺少昨收基准；未估算涨跌幅');
  }
  const quoteVolume = toNum(quote ? pick(quote, ['成交量', 'volume']) : null);
  const quoteAmount = toNum(quote ? pick(quote, ['成交额', 'amount', 'turnover']) : null);
  const dailyVolume = toNum(last ? pick(last, ['成交量', 'volume']) : null);
  const dailyAmount = toNum(last ? pick(last, ['成交额', 'amount', 'turnover']) : null);
  const volume = quoteVolume ?? dailyVolume;
  const turnoverAmount = quoteAmount ?? dailyAmount;
  const klineRows = seriesEnv.error ? [] : seriesEnv.data;
  const averageVolume = averageKlineValue(klineRows, ['成交量', 'volume']);
  const averageTurnoverAmount = averageKlineValue(klineRows, ['成交额', 'amount', 'turnover']);
  const turnoverRatio = turnoverAmount !== null && averageTurnoverAmount !== null && averageTurnoverAmount > 0
    ? Number((turnoverAmount / averageTurnoverAmount).toFixed(2))
    : null;
  const volumeRatio = turnoverRatio
    ?? (volume !== null && averageVolume !== null && averageVolume > 0
      ? Number((volume / averageVolume).toFixed(2))
      : null);
  return {
    symbol: entry.symbol,
    name: entry.displayName ?? entry.symbol,
    market: entry.market as Market,
    price: fmtNum(close, 2),
    changePct: Number(changePct.toFixed(2)),
    signal: signalFromChange(changePct),
    report: '待生成',
    spark: hasIntraday ? intradaySeries.values : [],
    sparkLabels: hasIntraday ? intradaySeries.labels : [],
    sparkKind: 'intraday',
    sparkBaseline,
    sparkTradeDate,
    tradeDate,
    turnoverAmount,
    averageTurnoverAmount,
    volume,
    averageVolume,
    volumeRatio,
    volumeSignal: volumeSignalFromRatio(volumeRatio),
    newsCount: 0,
    note: hasIntraday
      ? `来源 AkShare · ${entry.displayName ?? entry.symbol} ${sparkTradeDate ?? '当前交易日'}真实分钟线`
      : `来源 AkShare · ${entry.displayName ?? entry.symbol} 最新行情，分时走势暂缺`,
  };
}

function averageKlineValue(rows: KlineRow[], keys: string[]): number | null {
  const recent = rows
    .map((row) => toNum(pick(row, keys)))
    .filter((value): value is number => value !== null && value > 0);
  const baseline = recent.length > 1 ? recent.slice(0, -1) : recent;
  if (baseline.length === 0) return null;
  const average = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  if (!Number.isFinite(average) || average <= 0) return null;
  return Number(average.toFixed(2));
}

function volumeSignalFromRatio(ratio: number | null): VolumeSignal {
  if (ratio === null) return '待观察';
  if (ratio >= 1.25) return '放量';
  if (ratio <= 0.75) return '缩量';
  return '接近均量';
}

function mapIndices(env: AkEnvelope<IndexRow>): IndexSnapshot[] {
  if (env.error || env.data.length === 0) return [];
  const rows = env.data.slice(0, 6).map((row) => {
    const name = String(pick(row, ['名称', 'name', '代码']) ?? '指数');
    const price = fmtNum(pick(row, ['最新价', '收盘', 'close']), 2);
    const changePct = toNum(pick(row, ['涨跌幅', 'changePct'])) ?? 0;
    const turnoverValue = pick(row, ['成交额', 'amount', 'turnover']);
    return {
      name,
      price,
      changePct: Number(changePct.toFixed(2)),
      turnover: fmtYiYuan(turnoverValue),
    };
  });
  return rows.length > 0 ? rows : [];
}

function mapSectors(env: AkEnvelope<MarketPulseRow>): SectorSnapshot[] {
  const pulse = env.data[0];
  const sectors = pulse?.sectors_up;
  if (env.error || !Array.isArray(sectors) || sectors.length === 0) return [];
  return sectors.slice(0, 5).map((sector) => sectorFromEntry(sector));
}

function sectorFromEntry(entry: SectorEntry): SectorSnapshot {
  const changePct = entry.涨跌幅 ?? 0;
  return {
    name: entry.板块,
    changePct: Number(changePct.toFixed(2)),
    leader: entry.领涨股 || '—',
    flow: entry.领涨股涨跌幅 != null ? `领涨股 ${entry.领涨股涨跌幅.toFixed(2)}%` : '板块异动',
    spark: [],
  };
}

function marketTemperature(env: AkEnvelope<MarketPulseRow>) {
  const pulse = env.data[0];
  if (env.error || !pulse) {
    return null;
  }
  const up = pulse.up_count ?? 0;
  const down = pulse.down_count ?? 0;
  const zt = pulse.zt_count ?? 0;
  const dt = pulse.dt_count ?? 0;
  const breadth = up + down > 0 ? (up - down) / (up + down) : 0;
  const score = Math.max(0, Math.min(100, Math.round(52 + breadth * 32 + zt * 0.25 - dt * 0.45)));
  return {
    score,
    mood: score >= 70 ? '偏热' : score >= 58 ? '偏乐观' : score >= 45 ? '中性' : '偏谨慎',
    dayDelta: null,
    weekDelta: null,
    historicalPosition: `${score}%`,
    notes: [
      up || down ? `上涨 ${up} 家，下跌 ${down} 家。` : '涨跌家数暂不可用。',
      pulse.net_inflow_yi != null ? `主力净流入 ${pulse.net_inflow_yi.toFixed(2)} 亿元。` : '资金流向等待刷新。',
    ],
  };
}

function mapRankingLeaders(
  env: AkEnvelope<StockRankingRow>,
  metric: 'gainers' | 'losers' | 'amount',
): LeaderSnapshot[] {
  if (env.error || env.data.length === 0) return [];
  const rows = env.data.slice(0, 8).map((row, index) => {
    const code = String(pick(row, ['代码', 'code']) ?? '').trim();
    const amount = pick(row, ['成交额', 'amount']);
    return {
      rank: index + 1,
      name: String((pick(row, ['名称', 'name']) ?? code) || '股票'),
      price: fmtNum(pick(row, ['最新价', 'price', '收盘']), 2),
      changePct: Number((toNum(pick(row, ['涨跌幅', 'changePct'])) ?? 0).toFixed(2)),
      reason: metric === 'amount' ? `成交额 ${fmtYiYuan(amount)}` : code,
    };
  });
  return rows.length > 0 ? rows : [];
}

function mapSymbolSearch(env: AkEnvelope<SymbolRow>, query: string) {
  const normalized = query.trim().toUpperCase();
  const rows = env.error ? [] : env.data;
  const suggestions = rows
    .map((row) => ({
      symbol: String(row.code ?? '').trim(),
      name: String(row.name ?? '').trim(),
      market: 'A' as const,
    }))
    .filter((row) => row.symbol && row.name)
    .slice(0, 8);
  const queryText = query.trim().toUpperCase();
  for (const item of POPULAR_A_SYMBOLS) {
    if (suggestions.some((row) => row.symbol === item.symbol)) continue;
    if (item.symbol.includes(queryText) || item.name.toUpperCase().includes(queryText)) {
      suggestions.push({ symbol: item.symbol, name: item.name, market: 'A' as const });
    }
  }
  if (/^\d{6}$/.test(normalized) && !suggestions.some((row) => row.symbol === normalized)) {
    suggestions.unshift({ symbol: normalized, name: normalized, market: 'A' as const });
  }
  return suggestions.slice(0, 8);
}

function formatAnnouncementTime(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '公告';
  const match = /(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[ T](\d{2}):?(\d{2})?(?::?(\d{2}))?)?/.exec(value);
  if (!match) return '公告';
  const date = `${match[2]}-${match[3]}`;
  return match[4] ? `${date} ${match[4]}:${match[5] ?? '00'}` : date;
}

function newsPublishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const match = /(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[ T](\d{2}):?(\d{2})?(?::?(\d{2}))?)?/.exec(value);
  if (!match) return undefined;
  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function sourceDeclaredImageUrl(value?: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const image = new URL(value);
    if (image.protocol !== 'http:' && image.protocol !== 'https:') return undefined;
    return image.toString();
  } catch {
    return undefined;
  }
}

function articleCoverUrl(value?: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const article = new URL(value);
    if (article.protocol !== 'http:' && article.protocol !== 'https:') return undefined;
    if (article.hostname !== 'eastmoney.com' && !article.hostname.endsWith('.eastmoney.com')) return undefined;
    const articleId = /^\/a\/(\d{12,})\.html$/.exec(article.pathname)?.[1];
    if (!articleId) return undefined;
    return `https://np-metadata.eastmoney.com/api/metadata.jpg?event=1&source=3&mode=2&type=1&id=${articleId}`;
  } catch {
    return undefined;
  }
}

function normalizeDiscoveryEditorialArt(rows: NewsSnapshot[]): NewsSnapshot[] {
  return rows.map((row) => {
    if (row.category !== '公告' && row.category !== '新闻') return row;
    const sourceCover = row.imageKind === 'source-cover' ? sourceDeclaredImageUrl(row.imageUrl) : undefined;
    const { imageUrl: _imageUrl, imageKind: _imageKind, editorialArtOptions: _options, ...titleFirst } = row;
    if (!sourceCover) return titleFirst;
    return { ...titleFirst, imageUrl: sourceCover, imageKind: 'source-cover' as const };
  });
}

function sortNewsNewestFirst(rows: NewsSnapshot[]): NewsSnapshot[] {
  return [...rows].sort((left, right) => {
    const leftTimestamp = left.publishedAt ? Date.parse(left.publishedAt) : Number.NEGATIVE_INFINITY;
    const rightTimestamp = right.publishedAt ? Date.parse(right.publishedAt) : Number.NEGATIVE_INFINITY;
    if (rightTimestamp !== leftTimestamp) return rightTimestamp - leftTimestamp;
    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

function normalizedMarketHeadline(row: NewsSnapshot): string | undefined {
  if (row.feed !== 'A股要闻' && row.feed !== '美股要闻' && row.feed !== '港股要闻') return undefined;
  const title = row.title
    .replace(/^\s*[^：:]{2,16}\s*[：:]/, '')
    .replace(/(?:19|20)\d{2}年/g, '')
    .replace(/\s+/g, '')
    .replace(/[：:，,。.!！?？、【】\[\]（）()「」『』“”‘’]/g, '')
    .replace(/的/g, '')
    .toLocaleLowerCase('zh-CN');
  return title || undefined;
}

function newsPublicationDay(row: NewsSnapshot): string {
  return row.publishedAt?.slice(0, 10) ?? row.time.slice(0, 5);
}

function headlineBigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

function likelySameMarketStory(left: NewsSnapshot, right: NewsSnapshot): boolean {
  if (left.feed !== right.feed || newsPublicationDay(left) !== newsPublicationDay(right)) return false;
  const leftHeadline = normalizedMarketHeadline(left);
  const rightHeadline = normalizedMarketHeadline(right);
  if (!leftHeadline || !rightHeadline) return false;
  const numbers = (value: string) => value.match(/\d+(?:\.\d+)?%?/g)?.join('|') ?? '';
  if (numbers(leftHeadline) !== numbers(rightHeadline)) return false;
  if (leftHeadline === rightHeadline) return true;
  const shorter = leftHeadline.length <= rightHeadline.length ? leftHeadline : rightHeadline;
  const longer = shorter === leftHeadline ? rightHeadline : leftHeadline;
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.72) return true;
  const leftTokens = headlineBigrams(leftHeadline);
  const rightTokens = headlineBigrams(rightHeadline);
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared * 2 / (leftTokens.size + rightTokens.size) >= 0.82;
}

function dedupeNews(rows: NewsSnapshot[]): NewsSnapshot[] {
  const seenKeys = new Set<string>();
  const deduped: NewsSnapshot[] = [];
  for (const row of rows) {
    const normalizedTitle = row.title
      .replace(/\s+/g, '')
      .replace(/[：:，,。.!！?？、]/g, '')
      .toLocaleLowerCase('zh-CN');
    const contentKey = `${row.category}:${row.symbols.join(',')}:${normalizedTitle}:${row.publishedAt ?? row.time}`;
    const urlKey = row.url?.trim() ? `url:${row.url.trim()}` : undefined;
    if (
      seenKeys.has(contentKey) ||
      (urlKey && seenKeys.has(urlKey)) ||
      deduped.some((candidate) => likelySameMarketStory(candidate, row))
    ) continue;
    seenKeys.add(contentKey);
    if (urlKey) seenKeys.add(urlKey);
    deduped.push(row);
  }
  return deduped;
}

function sourceBackedDiscovery(rows: NewsSnapshot[]): NewsSnapshot[] {
  return normalizeDiscoveryEditorialArt(sortNewsNewestFirst(dedupeNews(rows.filter((row) => {
    if (row.category !== '新闻' && row.category !== '公告') return false;
    if (!row.title.trim() || !row.source.trim() || !row.url?.trim() || !row.publishedAt) return false;
    return newsPublishedAt(row.publishedAt) !== undefined;
  }))));
}

function discoveryFeed(row: NewsSnapshot): DiscoveryFeed {
  if (row.feed) return row.feed;
  return row.category === '公告' ? '重要公告' : '自选股新闻';
}

function preserveMissingDiscoveryFeeds(current: NewsSnapshot[], previous: NewsSnapshot[]): NewsSnapshot[] {
  const currentFeeds = new Set(current.map(discoveryFeed));
  const missingPriorRows = previous.filter((row) => !currentFeeds.has(discoveryFeed(row)));
  return sourceBackedDiscovery([...current, ...missingPriorRows]);
}

type StockNewsInput = { entry: WatchlistEntry; env: AkEnvelope<StockNewsRow> };
type MarketNewsInput = { feed: MarketDiscoveryFeed; env: AkEnvelope<StockNewsRow> };

function stockNewsRows(
  item: StockNewsInput,
  feed: Extract<DiscoveryFeed, '自选股新闻' | 'A股要闻'>,
): NewsSnapshot[] {
  if (item.env.error) return [];
  const rowsForStock: NewsSnapshot[] = [];
  for (const row of item.env.data) {
    const title = String(pick(row, ['新闻标题']) ?? '').trim();
    const sourcePublishedAt = pick(row, ['发布时间']);
    const url = String(pick(row, ['新闻链接']) ?? '').trim();
    const publishedAt = newsPublishedAt(sourcePublishedAt);
    if (!title || !publishedAt || !url) continue;
    const summary = String(pick(row, ['新闻内容']) ?? '').trim();
    const source = String(pick(row, ['文章来源']) ?? '').trim() || '东方财富';
    const sourceImageUrl = sourceDeclaredImageUrl(pick(row, ['新闻图片'])) ?? articleCoverUrl(url);
    const displayTitle = `${item.entry.displayName ?? item.entry.symbol}：${title}`;
    rowsForStock.push({
      category: '新闻',
      feed,
      time: formatAnnouncementTime(sourcePublishedAt),
      publishedAt,
      title: displayTitle,
      symbols: [item.entry.symbol],
      source,
      url,
      ...(summary ? { summary } : {}),
      ...(sourceImageUrl ? { imageUrl: sourceImageUrl, imageKind: 'source-cover' as const } : {}),
    });
  }
  return sortNewsNewestFirst(dedupeNews(rowsForStock));
}

function marketNewsRows(item: MarketNewsInput, limit = MARKET_DISCOVERY_PAGE_SIZES[item.feed]): NewsSnapshot[] {
  if (item.env.error) return [];
  const rows: NewsSnapshot[] = [];
  for (const row of item.env.data) {
    const title = String(pick(row, ['新闻标题']) ?? '').trim();
    const sourcePublishedAt = pick(row, ['发布时间']);
    const url = String(pick(row, ['新闻链接']) ?? '').trim();
    const publishedAt = newsPublishedAt(sourcePublishedAt);
    if (!title || !publishedAt || !url) continue;
    const summary = String(pick(row, ['新闻内容']) ?? '').trim();
    const source = String(pick(row, ['文章来源']) ?? '').trim() || '东方财富';
    const sourceImageUrl = sourceDeclaredImageUrl(pick(row, ['新闻图片'])) ?? articleCoverUrl(url);
    rows.push({
      category: '新闻',
      feed: item.feed,
      time: formatAnnouncementTime(sourcePublishedAt),
      publishedAt,
      title,
      symbols: [],
      source,
      url,
      ...(summary ? { summary } : {}),
      ...(sourceImageUrl ? { imageUrl: sourceImageUrl, imageKind: 'source-cover' as const } : {}),
    });
  }
  return sortNewsNewestFirst(dedupeNews(rows)).slice(0, limit);
}

function buildNews(
  announcements: Array<{ entry: WatchlistEntry; env: AkEnvelope<AnnouncementRow> }>,
  stockNews: StockNewsInput[],
  marketNews: MarketNewsInput[] = [],
): NewsSnapshot[] {
  const announcementRows: NewsSnapshot[] = [];
  const watchlistArticleRows: NewsSnapshot[] = [];
  const marketSearchRows: NewsSnapshot[] = [];
  for (const item of announcements) {
    if (item.env.error) continue;
    const rowsForStock: NewsSnapshot[] = [];
    for (const row of item.env.data) {
      const title = String(pick(row, ['公告标题']) ?? '').trim();
      const sourcePublishedAt = pick(row, ['公告时间']);
      const url = String(pick(row, ['公告链接']) ?? '').trim();
      const publishedAt = newsPublishedAt(sourcePublishedAt);
      if (!title || !publishedAt || !url) continue;
      const displayTitle = `${item.entry.displayName ?? item.entry.symbol}：${title}`;
      rowsForStock.push({
        category: '公告',
        feed: '重要公告',
        time: formatAnnouncementTime(sourcePublishedAt),
        publishedAt,
        title: displayTitle,
        symbols: [item.entry.symbol],
        source: '巨潮公告',
        url,
      });
    }
    announcementRows.push(...sortNewsNewestFirst(dedupeNews(rowsForStock)));
  }
  for (const item of stockNews) {
    watchlistArticleRows.push(...stockNewsRows(item, '自选股新闻'));
  }
  for (const item of marketNews) {
    marketSearchRows.push(...marketNewsRows(item));
  }
  return normalizeDiscoveryEditorialArt(sortNewsNewestFirst(dedupeNews([
    ...sortNewsNewestFirst(announcementRows),
    ...sortNewsNewestFirst(watchlistArticleRows),
    ...sortNewsNewestFirst(marketSearchRows),
  ])));
}

function marketForDiscoveryFeed(feed: MarketDiscoveryFeed): 'cn' | 'us' | 'hk' {
  if (feed === 'A股要闻') return 'cn';
  return feed === '美股要闻' ? 'us' : 'hk';
}

async function loadMarketDiscoveryFeed(args: {
  feed: MarketDiscoveryFeed;
  page: number;
  logger: MinimalLogger;
}): Promise<{ feed: MarketDiscoveryFeed; page: number; items: NewsSnapshot[]; hasMore: boolean }> {
  const pageSize = MARKET_DISCOVERY_PAGE_SIZES[args.feed];
  const client = new HttpAkshareClient({
    baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
    timeoutMs: DASHBOARD_DISCOVERY_TIMEOUT_MS,
    logger: args.logger,
  });
  const env = await client.getMarketNews(marketForDiscoveryFeed(args.feed), args.page, pageSize);
  const items = marketNewsRows({ feed: args.feed, env }, pageSize);
  return {
    feed: args.feed,
    page: args.page,
    items,
    // Search sources can return a partial page after cross-topic de-duplication.
    // Keep the next source page reachable until the source returns no usable rows.
    hasMore: items.length > 0,
  };
}

async function buildDashboardSnapshot(args: {
  logger: MinimalLogger;
  watchlistRows: WatchlistEntry[];
  effectiveWatchlist: WatchlistEntry[];
  now: Date;
  includeSlowSignals?: boolean;
}): Promise<DashboardSnapshot> {
  const { logger, effectiveWatchlist, now, includeSlowSignals = true } = args;
  const baseUrl = process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848';
  const client = new HttpAkshareClient({
    baseUrl,
    timeoutMs: DASHBOARD_AKSHARE_TIMEOUT_MS,
    logger,
  });
  const slowSignalClient = new HttpAkshareClient({
    baseUrl,
    timeoutMs: DASHBOARD_SLOW_SIGNAL_TIMEOUT_MS,
    logger,
  });
  const discoveryClient = new HttpAkshareClient({
    baseUrl,
    // The upstream search itself has an eight second deadline. Keep this
    // layer bounded too, so a cold market-news cache cannot hold the entire
    // dashboard refresh for the old 90 second slow-signal budget.
    timeoutMs: DASHBOARD_DISCOVERY_TIMEOUT_MS,
    logger,
  });
  const rankingClient = new HttpAkshareClient({
    baseUrl,
    timeoutMs: DASHBOARD_RANKING_TIMEOUT_MS,
    logger,
  });
  const { compact } = cnDateParts(now);
  const announcementWatchlist = effectiveWatchlist
    .filter((entry) => entry.market === 'A');
  const deferredPulse = Promise.resolve(emptyEnvelope<MarketPulseRow>('akshare:market-pulse:deferred'));
  const deferredAnnouncements = Promise.resolve(
    announcementWatchlist.map((entry) => ({
      entry,
      env: emptyEnvelope<AnnouncementRow>(`akshare:announcements:${entry.symbol}:deferred`),
    })),
  );
  const deferredStockNews = Promise.resolve(
    announcementWatchlist.map((entry) => ({
      entry,
      env: emptyEnvelope<StockNewsRow>(`akshare:stock-news:${entry.symbol}:deferred`),
    })),
  );
  const deferredRankings = Promise.resolve(emptyEnvelope<StockRankingRow>('akshare:rankings:deferred'));
  const deferredMarketNews = Promise.resolve([
    { feed: 'A股要闻' as const, env: emptyEnvelope<StockNewsRow>('akshare:market-news:cn:deferred') },
    { feed: '美股要闻' as const, env: emptyEnvelope<StockNewsRow>('akshare:market-news:us:deferred') },
    { feed: '港股要闻' as const, env: emptyEnvelope<StockNewsRow>('akshare:market-news:hk:deferred') },
  ]);
  const [indexCn, pulseEnv, stocks, announcements, stockNews, rankingGainers, rankingLosers, rankingAmount, marketNews] = await Promise.all([
    client.getIndexQuote('cn'),
    includeSlowSignals
      ? slowSignalClient.getMarketPulse(compact)
      : deferredPulse,
    Promise.all(effectiveWatchlist.slice(0, 8).map((entry, index) => stockSnapshot(client, entry, index, now))),
    includeSlowSignals
      ? Promise.all(
        announcementWatchlist.map(async (entry) => ({
          entry,
          env: await client.getStockAnnouncements(entry.symbol, cnCompactDaysAgo(now, 7), compact),
        })),
      )
      : deferredAnnouncements,
    includeSlowSignals
      ? Promise.all(
        announcementWatchlist.map(async (entry) => ({
          entry,
          env: await discoveryClient.getStockNews(entry.symbol),
        })),
      )
      : deferredStockNews,
    includeSlowSignals ? rankingClient.getStockRankings('gainers', 8) : deferredRankings,
    includeSlowSignals ? rankingClient.getStockRankings('losers', 8) : deferredRankings,
    includeSlowSignals ? rankingClient.getStockRankings('amount', 8) : deferredRankings,
    includeSlowSignals
      ? Promise.all([
        discoveryClient.getMarketNews('cn', 1, MARKET_DISCOVERY_PAGE_SIZES['A股要闻']).then((env) => ({ feed: 'A股要闻' as const, env })),
        discoveryClient.getMarketNews('us', 1, MARKET_DISCOVERY_PAGE_SIZES['美股要闻']).then((env) => ({ feed: '美股要闻' as const, env })),
        discoveryClient.getMarketNews('hk', 1, MARKET_DISCOVERY_PAGE_SIZES['港股要闻']).then((env) => ({ feed: '港股要闻' as const, env })),
      ])
      : deferredMarketNews,
  ]);
  const sectors = mapSectors(pulseEnv);
  const leaderboards: LeaderboardsSnapshot = {
    gainers: mapRankingLeaders(rankingGainers, 'gainers'),
    losers: mapRankingLeaders(rankingLosers, 'losers'),
    amount: mapRankingLeaders(rankingAmount, 'amount'),
  };
  const marketIndices = mapIndices(indexCn);
  const temperature = marketTemperature(pulseEnv);
  const news = buildNews(announcements, stockNews, marketNews);
  const missingMarketPanels = [
    marketIndices.length === 0 ? '指数' : null,
    sectors.length === 0 ? '行业趋势' : null,
    temperature === null ? '市场温度' : null,
    leaderboards.gainers.length === 0 ? '榜单' : null,
  ].filter((label): label is string => label !== null);
  const freshness: DashboardFreshness = !includeSlowSignals
    ? {
        status: 'partial',
        cachedAt: now.toISOString(),
        message: '真实行情已先展示，市场温度、板块与重点动态正在后台补齐。',
      }
    : missingMarketPanels.length === 0
      ? {
        status: 'fresh',
        cachedAt: now.toISOString(),
      }
      : {
        status: 'partial',
        cachedAt: now.toISOString(),
        message: `真实行情已先展示，${missingMarketPanels.join('、')}正在后台补齐。`,
      };
  return withFreshness(
    {
      updatedAt: now.toISOString(),
      observedTradeDate: observedTradeDateFromStocks(stocks),
      source: 'akshare',
      isFallbackWatchlist: false,
      watchlistStocks: stocks,
      marketIndices,
      sectors,
      starStocks: stocks.filter((stockRow) => stockRow.price !== '—').slice(0, 6),
      temperature,
      news,
      leaders: leaderboards.gainers,
      leaderboards,
    },
    freshness,
  );
}

function cacheDashboardSnapshot(cacheKey: string, snapshot: DashboardSnapshot, refreshPromise?: Promise<DashboardSnapshot>): void {
  const safeSnapshot = dashboardWithObservedIntraday(snapshot, dashboardReferenceDate(snapshot));
  const freshTtl = snapshot.freshness.status === 'partial'
    ? DASHBOARD_PARTIAL_FRESH_TTL_MS
    : DASHBOARD_FRESH_TTL_MS;
  dashboardCache.set(cacheKey, {
    snapshot: safeSnapshot,
    freshUntil: Date.now() + freshTtl,
    staleUntil: Date.now() + DASHBOARD_STALE_TTL_MS,
    refreshPromise,
  });
}

function withPreservedSlowSignals(snapshot: DashboardSnapshot, previous?: DashboardSnapshot): DashboardSnapshot {
  if (!previous || (snapshot.freshness.status !== 'fresh' && snapshot.freshness.status !== 'partial')) return snapshot;
  const now = dashboardReferenceDate(snapshot);
  const snapshotHasWatchlistQuotes = snapshot.watchlistStocks.some((stockRow) => stockRow.price !== '—' || stockRow.spark.length >= 2);
  const previousWatchlistStocks = previous.watchlistStocks.map((stockRow) => observedIntradayStockForNow(stockRow, now));
  const previousHasWatchlistQuotes = previousWatchlistStocks.some((stockRow) => stockRow.price !== '—' || stockRow.spark.length >= 2);
  const shouldPreserveWatchlistStocks = !snapshotHasWatchlistQuotes && previousHasWatchlistQuotes;
  const previousStockBySymbol = new Map(previousWatchlistStocks.map((stockRow) => [stockRow.symbol, stockRow]));
  const watchlistStocks = shouldPreserveWatchlistStocks
    ? previousWatchlistStocks
    : snapshot.watchlistStocks.map((stockRow) => {
      const previousStock = previousStockBySymbol.get(stockRow.symbol);
      if (stockRow.spark.length >= 2 || !previousStock || previousStock.spark.length < 2) return stockRow;
      return {
        ...stockRow,
        spark: previousStock.spark,
        sparkLabels: previousStock.sparkLabels,
        sparkKind: previousStock.sparkKind,
        sparkBaseline: previousStock.sparkBaseline,
        sparkTradeDate: previousStock.sparkTradeDate,
        note: `${stockRow.note}；分时线保留最近一次真实分钟线`,
      };
    });
  const shouldPreserveWatchlistSparks = !shouldPreserveWatchlistStocks && watchlistStocks.some((stockRow, index) => stockRow !== snapshot.watchlistStocks[index]);
  const shouldPreserveMarketIndices = snapshot.marketIndices.length === 0 && previous.marketIndices.length > 0;
  const shouldPreserveSectors = snapshot.sectors.length === 0 && previous.sectors.length > 0;
  const shouldPreserveTemperature = snapshot.temperature === null && previous.temperature !== null;
  const sourceNews = sourceBackedDiscovery(snapshot.news);
  const priorSourceNews = sourceBackedDiscovery(previous.news);
  const news = preserveMissingDiscoveryFeeds(sourceNews, priorSourceNews);
  const shouldPreserveNews = news.length > sourceNews.length;
  const shouldPreserveLeaderboards =
    snapshot.leaderboards.gainers.length === 0 &&
    snapshot.leaderboards.losers.length === 0 &&
    snapshot.leaderboards.amount.length === 0 &&
    (
      previous.leaderboards.gainers.length > 0 ||
      previous.leaderboards.losers.length > 0 ||
      previous.leaderboards.amount.length > 0
    );
  if (
    !shouldPreserveWatchlistStocks &&
    !shouldPreserveWatchlistSparks &&
    !shouldPreserveMarketIndices &&
    !shouldPreserveSectors &&
    !shouldPreserveTemperature &&
    !shouldPreserveNews &&
    !shouldPreserveLeaderboards
  ) return snapshot;

  const preservedLabels = [
    shouldPreserveWatchlistStocks ? '关注股票' : null,
    shouldPreserveWatchlistSparks ? '分时线' : null,
    shouldPreserveMarketIndices ? '市场行情' : null,
    shouldPreserveSectors ? '行业趋势' : null,
    shouldPreserveTemperature ? '市场温度' : null,
    shouldPreserveNews ? '股市新闻' : null,
    shouldPreserveLeaderboards ? '榜单' : null,
  ].filter((label): label is string => label !== null);
  const leaderboards = shouldPreserveLeaderboards ? previous.leaderboards : snapshot.leaderboards;

  return {
    ...snapshot,
    observedTradeDate: observedTradeDateFromStocks(watchlistStocks),
    watchlistStocks,
    starStocks: shouldPreserveWatchlistStocks
      ? previous.starStocks
      : watchlistStocks.filter((stockRow) => stockRow.price !== '—').slice(0, 6),
    marketIndices: shouldPreserveMarketIndices ? previous.marketIndices : snapshot.marketIndices,
    sectors: shouldPreserveSectors ? previous.sectors : snapshot.sectors,
    temperature: shouldPreserveTemperature ? previous.temperature : snapshot.temperature,
    news,
    leaders: shouldPreserveLeaderboards ? leaderboards.gainers : snapshot.leaders,
    leaderboards,
    freshness: {
      ...snapshot.freshness,
      status: 'stale',
      message: `行情已更新，${preservedLabels.join('、')}保留最近一次真实数据。`,
    },
  };
}

function startFullDashboardRefresh(args: {
  db: Db;
  cacheKey: string;
  logger: MinimalLogger;
  userInternalId: number;
  watchlistRows: WatchlistEntry[];
  effectiveWatchlist: WatchlistEntry[];
}): Promise<DashboardSnapshot> {
  const existing = dashboardCache.get(args.cacheKey);
  const fullRefreshPromise = buildDashboardSnapshot({
    logger: args.logger,
    watchlistRows: args.watchlistRows,
    effectiveWatchlist: args.effectiveWatchlist,
    now: new Date(),
    includeSlowSignals: true,
  }).then(async (snapshot) => {
    const merged = withPreservedSlowSignals(snapshot, existing?.snapshot);
    cacheDashboardSnapshot(args.cacheKey, merged);
    await persistDashboardSnapshot({
      db: args.db,
      logger: args.logger,
      userInternalId: args.userInternalId,
      cacheKey: args.cacheKey,
      snapshot: merged,
    });
    return merged;
  }).catch((error) => {
    args.logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'stocks-dashboard: full refresh failed',
    );
    throw error;
  }).finally(() => {
    const latest = dashboardCache.get(args.cacheKey);
    if (latest?.refreshPromise === fullRefreshPromise) {
      if (latest.snapshot) {
        dashboardCache.set(args.cacheKey, { ...latest, refreshPromise: undefined });
      } else {
        dashboardCache.delete(args.cacheKey);
      }
    }
  });
  return fullRefreshPromise;
}

function startDashboardRefresh(args: {
  db: Db;
  cacheKey: string;
  logger: MinimalLogger;
  userInternalId: number;
  watchlistRows: WatchlistEntry[];
  effectiveWatchlist: WatchlistEntry[];
}): Promise<DashboardSnapshot> {
  const existing = dashboardCache.get(args.cacheKey);
  if (existing?.refreshPromise) return existing.refreshPromise;
  const quickFirst =
    !existing?.snapshot ||
    !hasDisplayableRealDashboardData(existing.snapshot) ||
    dashboardNeedsWatchlistIntradayRefresh(existing.snapshot);

  const refreshPromise = buildDashboardSnapshot({
    logger: args.logger,
    watchlistRows: args.watchlistRows,
    effectiveWatchlist: args.effectiveWatchlist,
    now: new Date(),
    includeSlowSignals: !quickFirst,
  }).then(async (snapshot) => {
    if (quickFirst) {
      const merged = withPreservedSlowSignals(snapshot, existing?.snapshot);
      const fullRefreshPromise = startFullDashboardRefresh(args);
      cacheDashboardSnapshot(args.cacheKey, merged, fullRefreshPromise);
      persistDashboardSnapshot({
        db: args.db,
        logger: args.logger,
        userInternalId: args.userInternalId,
        cacheKey: args.cacheKey,
        snapshot: merged,
      }).catch(() => undefined);
      fullRefreshPromise.catch(() => undefined);
      return merged;
    } else {
      const merged = withPreservedSlowSignals(snapshot, existing?.snapshot);
      cacheDashboardSnapshot(args.cacheKey, merged);
      await persistDashboardSnapshot({
        db: args.db,
        logger: args.logger,
        userInternalId: args.userInternalId,
        cacheKey: args.cacheKey,
        snapshot: merged,
      });
      return merged;
    }
  }).catch((error) => {
    args.logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'stocks-dashboard: refresh failed',
    );
    throw error;
  }).finally(() => {
    const latest = dashboardCache.get(args.cacheKey);
    if (latest?.refreshPromise === refreshPromise) {
      if (latest.snapshot) {
        dashboardCache.set(args.cacheKey, { ...latest, refreshPromise: undefined });
      } else {
        dashboardCache.delete(args.cacheKey);
      }
    }
  });

  dashboardCache.set(args.cacheKey, {
    snapshot: existing?.snapshot,
    freshUntil: existing?.freshUntil ?? 0,
    staleUntil: existing?.staleUntil ?? 0,
    refreshPromise,
  });
  return refreshPromise;
}

async function resolveDashboardSnapshot(args: {
  db: Db;
  logger: MinimalLogger;
  userInternalId: number;
  watchlistRows: WatchlistEntry[];
  effectiveWatchlist: WatchlistEntry[];
}): Promise<DashboardSnapshot> {
  const cacheKey = dashboardCacheKey(args.userInternalId, args.effectiveWatchlist);
  let cached = dashboardCache.get(cacheKey);
  if (!cached?.snapshot) {
    const persisted = await loadPersistedDashboardSnapshot({
      db: args.db,
      logger: args.logger,
      userInternalId: args.userInternalId,
      cacheKey,
    });
    if (persisted) {
      dashboardCache.set(cacheKey, {
        snapshot: persisted,
        freshUntil: 0,
        staleUntil: Date.now() + DASHBOARD_STALE_TTL_MS,
      });
      cached = dashboardCache.get(cacheKey);
    }
  }
  const nowMs = Date.now();
  const observedCached = cached?.snapshot
    ? dashboardWithObservedIntraday(cached.snapshot, new Date())
    : undefined;
  const cachedHasDisplayableData = observedCached ? hasDisplayableRealDashboardData(observedCached) : false;
  const shouldRefreshMissingIntraday =
    observedCached ? dashboardNeedsWatchlistIntradayRefresh(observedCached) : false;
  if (
    observedCached &&
    cachedHasDisplayableData &&
    cached &&
    cached.freshUntil > nowMs &&
    !shouldRefreshMissingIntraday
  ) return observedCached;

  const refreshPromise = startDashboardRefresh({
    db: args.db,
    cacheKey,
    logger: args.logger,
    userInternalId: args.userInternalId,
    watchlistRows: args.watchlistRows,
    effectiveWatchlist: args.effectiveWatchlist,
  });

  if (
    observedCached &&
    cached &&
    cachedHasDisplayableData &&
    cached.staleUntil > nowMs &&
    !shouldRefreshMissingIntraday
  ) {
    refreshPromise.catch(() => undefined);
    return markRefreshing(observedCached, '正在后台刷新行情，当前展示最近一次真实数据。');
  }

  try {
    return await withTimeout(refreshPromise, DASHBOARD_FIRST_PAINT_BUDGET_MS);
  } catch {
    if (observedCached && cachedHasDisplayableData) {
      return markRefreshing(observedCached, '行情接口暂未返回，当前展示最近一次真实数据。');
    }
    return buildPartialDashboardSnapshot(args.watchlistRows, args.effectiveWatchlist);
  }
}

export const stocksRouter = router({
  dashboardSnapshot: protectedProcedure.query(async ({ ctx }) => {
    const userInternalId = await requireUserId(ctx.db, ctx.userId);
    const watchlistRows = await listWatchlistForUser(ctx.db, userInternalId);
    const effectiveWatchlist = watchlistRows;
    return resolveDashboardSnapshot({
      db: ctx.db,
      logger: ctx.logger,
      userInternalId,
      watchlistRows,
      effectiveWatchlist,
    });
  }),

  discoveryFeed: protectedProcedure
    .input(z.object({
      feed: z.enum(['A股要闻', '美股要闻', '港股要闻']),
      page: z.number().int().min(2).max(100),
    }))
    .query(async ({ ctx, input }) => loadMarketDiscoveryFeed({
      feed: input.feed,
      page: input.page,
      logger: ctx.logger,
    })),

  newsDetail: protectedProcedure
    .input(z.object({
      url: z.string().url().max(2_048),
      sourceName: z.string().trim().min(1).max(160),
      publishedAt: z.string().trim().min(1).max(80),
      summary: z.string().trim().max(10_000).optional(),
    }))
    .query(async ({ input }) => resolveNewsDetail(input)),

  searchSymbols: protectedProcedure
    .input(z.object({ query: z.string().trim().min(1).max(32) }))
    .query(async ({ ctx, input }) => {
      const client = new HttpAkshareClient({
        baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
        timeoutMs: 4_000,
        logger: ctx.logger,
      });
      const env = await client.searchSymbol(input.query);
      return mapSymbolSearch(env, input.query);
    }),

  generateBriefingNow: protectedProcedure
    .input(z.object({ mode: z.enum(['auto', 'premarket', 'postmarket']).default('auto') }).optional())
    .mutation(async ({ ctx, input }) => {
      const userInternalId = await requireUserId(ctx.db, ctx.userId);
      const client = new HttpAkshareClient({
        baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
        logger: ctx.logger,
      });
      const now = new Date();
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          hour12: false,
        }).format(now),
      );
      const mode = input?.mode && input.mode !== 'auto' ? input.mode : hour < 12 ? 'premarket' : 'postmarket';
      const markdown =
        mode === 'premarket'
          ? await buildPremarketBriefing({ db: ctx.db, client, now, mode: 'prod' }, userInternalId)
          : await buildPostmarketBriefing({ db: ctx.db, client, now, mode: 'prod' }, userInternalId);
      return {
        mode,
        title: mode === 'premarket' ? 'A股盘前简报' : 'A股盘后复盘',
        markdown,
        generatedAt: now.toISOString(),
      };
    }),
});

export const __stocksDashboardTest = {
  sourceDeclaredImageUrl,
  articleCoverUrl,
  normalizeDiscoveryEditorialArt,
  buildNews,
  loadMarketDiscoveryFeed,
  buildDashboardSnapshot,
  dashboardCache,
  hasDisplayableRealDashboardData,
  observedIntradayPointsForNow,
  observedIntradayStockForNow,
  resolveDashboardSnapshot,
  stockSnapshot,
  withPreservedSlowSignals,
};

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
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
  WatchlistEntry,
} from '../../agent/a-share/briefing-types.js';
import type { SymbolRow } from '../../agent/a-share/akshare-client.js';
import { fmtNum, fmtYiYuan, pick, toNum } from '../../agent/a-share/ashare-format.js';
import { users } from '../../db/schema/users.js';
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

interface NewsSnapshot {
  category: '公告' | '盘面' | '关注';
  time: string;
  title: string;
  symbols: string[];
  source: string;
  url?: string;
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
  status: 'fresh' | 'stale' | 'partial';
  cachedAt: string;
  message?: string;
}

interface DashboardSnapshot {
  updatedAt: string;
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

const FALLBACK_WATCHLIST: WatchlistEntry[] = [
  { symbol: 'NVDA', market: 'US', displayName: '英伟达' },
  { symbol: 'TSLA', market: 'US', displayName: '特斯拉' },
  { symbol: 'AAPL', market: 'US', displayName: '苹果公司' },
  { symbol: 'MSFT', market: 'US', displayName: '微软' },
  { symbol: '600519', market: 'A', displayName: '贵州茅台' },
];

const FALLBACK_STOCKS: Record<string, StockSnapshot> = {
  NVDA: stock('NVDA', '英伟达', 'US', '—', 0, '真实行情暂不可用', '待生成'),
  TSLA: stock('TSLA', '特斯拉', 'US', '—', 0, '真实行情暂不可用', '待生成'),
  AAPL: stock('AAPL', '苹果公司', 'US', '—', 0, '真实行情暂不可用', '待生成'),
  MSFT: stock('MSFT', '微软', 'US', '—', 0, '真实行情暂不可用', '待生成'),
  '600519': stock('600519', '贵州茅台', 'A', '—', 0, '真实行情暂不可用', '待生成'),
  '300750': stock('300750', '宁德时代', 'A', '—', 0, '真实行情暂不可用', '待生成'),
  '0700.HK': stock('0700.HK', '腾讯控股', 'HK', '—', 0, '真实行情暂不可用', '待生成'),
};

const FALLBACK_INDICES: IndexSnapshot[] = [];

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
const dashboardCache = new Map<string, DashboardCacheEntry>();

function stock(
  symbol: string,
  name: string,
  market: Market,
  price: string,
  changePct: number,
  note: string,
  report: StockSnapshot['report'] = '已生成',
): StockSnapshot {
  return {
    symbol,
    name,
    market,
    price,
    changePct,
    signal: signalFromChange(changePct),
    report,
    spark: [],
    sparkLabels: [],
    sparkKind: 'daily_close',
    sparkBaseline: null,
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

function withFreshness(
  snapshot: Omit<DashboardSnapshot, 'freshness'>,
  freshness: DashboardFreshness,
): DashboardSnapshot {
  return { ...snapshot, freshness };
}

function markStale(snapshot: DashboardSnapshot, message: string): DashboardSnapshot {
  return {
    ...snapshot,
    freshness: {
      ...snapshot.freshness,
      status: 'stale',
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
  watchlistRows: WatchlistEntry[],
  effectiveWatchlist: WatchlistEntry[],
  now = new Date(),
  message = '行情刷新仍在进行，先展示真实关注列表。',
): DashboardSnapshot {
  const watchlistStocks = effectiveWatchlist
    .slice(0, 8)
    .map((entry, index) => unavailableStock(entry, FALLBACK_STOCKS[entry.symbol.trim().toUpperCase()] ?? fallbackStock(entry, index)));
  const leaderboards = fallbackLeaderboards();
  return withFreshness(
    {
      updatedAt: now.toISOString(),
      source: 'akshare',
      isFallbackWatchlist: watchlistRows.length === 0,
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

function sparkSeriesFromIntraday(rows: IntradayRow[]): { values: number[]; labels: string[] } {
  const series = rows
    .map((row) => ({
      value: toNum(pick(row, ['最新价', '收盘', 'close', 'price'])),
      label: String(pick(row, ['时间', 'time', 'datetime']) ?? '').trim(),
    }))
    .filter((point): point is { value: number; label: string } => point.value !== null && point.label.length > 0);
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

function latestKline(rows: KlineRow[]): KlineRow | null {
  return rows.length > 0 ? rows[rows.length - 1] ?? null : null;
}

function latestQuote(env: AkEnvelope<StockQuoteRow>): StockQuoteRow | null {
  if (env.error || env.data.length === 0) return null;
  return env.data[0] ?? null;
}

function unavailableStock(entry: WatchlistEntry, fallback: StockSnapshot): StockSnapshot {
  return {
    ...fallback,
    symbol: entry.symbol,
    name: entry.displayName ?? fallback.name,
    market: entry.market as Market,
    price: '—',
    changePct: 0,
    signal: '待观察',
    spark: [],
    note: '真实行情暂不可用，未展示走势线',
  };
}

async function stockSnapshot(
  client: HttpAkshareClient,
  entry: WatchlistEntry,
  index: number,
): Promise<StockSnapshot> {
  const normalized = entry.symbol.trim().toUpperCase();
  const fallback = FALLBACK_STOCKS[normalized] ?? fallbackStock(entry, index);
  if (entry.market !== 'A') return unavailableStock(entry, fallback);

  const [dailyEnv, seriesEnv, intradayEnv, quoteEnv] = await Promise.all([
    client.getStockKline(entry.symbol),
    client.getStockKline(entry.symbol, 8),
    client.getStockIntraday(entry.symbol),
    client.getStockQuote(entry.symbol),
  ]);
  const last = latestKline(dailyEnv.data);
  const quote = latestQuote(quoteEnv);
  const sparkSeries = seriesEnv.error ? { values: [], labels: [] } : sparkSeriesFromKline(seriesEnv.data);
  const intradaySeries = intradayEnv.error ? { values: [], labels: [] } : sparkSeriesFromIntraday(intradayEnv.data);
  const hasIntraday = intradaySeries.values.length >= 2;
  const latestIntraday = hasIntraday ? intradaySeries.values[intradaySeries.values.length - 1] : null;
  const close = quote
    ? pick(quote, ['最新价', 'price', '收盘', 'close'])
    : last
      ? pick(last, ['收盘', 'close', '最新价'])
      : latestIntraday;
  if (close == null) return unavailableStock(entry, fallback);
  const sparkBaseline = previousCloseFromSeries(sparkSeries, intradaySeries.labels[0]);
  const changePct = toNum(quote ? pick(quote, ['涨跌幅', 'changePct']) : last ? pick(last, ['涨跌幅', 'changePct']) : null)
    ?? (
      typeof sparkBaseline === 'number' && sparkBaseline > 0
        ? ((toNum(close) ?? sparkBaseline) - sparkBaseline) / sparkBaseline * 100
        : fallback.changePct
    );
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
    ...fallback,
    symbol: entry.symbol,
    name: entry.displayName ?? fallback.name,
    market: entry.market as Market,
    price: fmtNum(close, 2),
    changePct: Number(changePct.toFixed(2)),
    signal: signalFromChange(changePct),
    spark: hasIntraday ? intradaySeries.values : [],
    sparkLabels: hasIntraday ? intradaySeries.labels : [],
    sparkKind: 'intraday',
    sparkBaseline,
    turnoverAmount,
    averageTurnoverAmount,
    volume,
    averageVolume,
    volumeRatio,
    volumeSignal: volumeSignalFromRatio(volumeRatio),
    note: hasIntraday
      ? `来源 AkShare · ${entry.displayName ?? entry.symbol} 今日真实分钟线`
      : `来源 AkShare · ${entry.displayName ?? entry.symbol} 最新行情，分时走势暂缺`,
  };
}

function fallbackStock(entry: WatchlistEntry, _index: number): StockSnapshot {
  return stock(
    entry.symbol,
    entry.displayName ?? entry.symbol,
    entry.market as Market,
    '—',
    0,
    '暂无真实行情数据',
    '待生成',
  );
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
  if (env.error || env.data.length === 0) return FALLBACK_INDICES;
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
  return rows.length > 0 ? rows : FALLBACK_INDICES;
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
  const match = /(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(value);
  return match ? `${match[2]}-${match[3]}` : '公告';
}

function buildNews(
  stocks: StockSnapshot[],
  pulseEnv: AkEnvelope<MarketPulseRow>,
  announcements: Array<{ entry: WatchlistEntry; env: AkEnvelope<AnnouncementRow> }>,
): NewsSnapshot[] {
  const pulse = pulseEnv.data[0];
  const sector = pulse?.sectors_up?.[0];
  const rows: NewsSnapshot[] = [];
  for (const item of announcements) {
    if (item.env.error) continue;
    for (const row of item.env.data.slice(0, 2)) {
      const title = String(pick(row, ['公告标题']) ?? '').trim();
      if (!title) continue;
      rows.push({
        category: '公告',
        time: formatAnnouncementTime(pick(row, ['公告时间'])),
        title: `${item.entry.displayName ?? item.entry.symbol}：${title}`,
        symbols: [item.entry.symbol],
        source: '巨潮公告',
        url: typeof pick(row, ['公告链接']) === 'string' ? String(pick(row, ['公告链接'])) : undefined,
      });
    }
  }
  if (sector) {
    rows.push({
      category: '盘面',
      time: '盘中',
      title: `${sector.板块} 板块位居涨幅前列，领涨股 ${sector.领涨股 || '暂缺'}`,
      symbols: [sector.板块],
      source: 'AkShare 市场脉冲',
    });
  }
  const realQuoteStocks = stocks.filter((stockRow) => stockRow.price !== '—' && stockRow.note.includes('来源 AkShare'));
  for (const stockRow of realQuoteStocks.slice(0, 4)) {
    rows.push({
      category: '关注',
      time: '关注',
      title: `${stockRow.name} 今日涨跌幅 ${stockRow.changePct > 0 ? '+' : ''}${stockRow.changePct.toFixed(2)}%`,
      symbols: [stockRow.symbol],
      source: 'AkShare 行情',
    });
  }
  return rows.slice(0, 5);
}

async function buildDashboardSnapshot(args: {
  logger: MinimalLogger;
  watchlistRows: WatchlistEntry[];
  effectiveWatchlist: WatchlistEntry[];
  now: Date;
  includeSlowSignals?: boolean;
}): Promise<DashboardSnapshot> {
  const { logger, watchlistRows, effectiveWatchlist, now, includeSlowSignals = true } = args;
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
  const rankingClient = new HttpAkshareClient({
    baseUrl,
    timeoutMs: DASHBOARD_RANKING_TIMEOUT_MS,
    logger,
  });
  const { compact } = cnDateParts(now);
  const announcementWatchlist = effectiveWatchlist
    .filter((entry) => entry.market === 'A')
    .slice(0, 5);
  const deferredPulse = Promise.resolve(emptyEnvelope<MarketPulseRow>('akshare:market-pulse:deferred'));
  const deferredAnnouncements = Promise.resolve(
    announcementWatchlist.map((entry) => ({
      entry,
      env: emptyEnvelope<AnnouncementRow>(`akshare:announcements:${entry.symbol}:deferred`),
    })),
  );
  const deferredRankings = Promise.resolve(emptyEnvelope<StockRankingRow>('akshare:rankings:deferred'));
  const [indexCn, pulseEnv, stocks, announcements, rankingGainers, rankingLosers, rankingAmount] = await Promise.all([
    client.getIndexQuote('cn'),
    includeSlowSignals
      ? slowSignalClient.getMarketPulse(compact)
      : deferredPulse,
    Promise.all(effectiveWatchlist.slice(0, 8).map((entry, index) => stockSnapshot(client, entry, index))),
    includeSlowSignals
      ? Promise.all(
        announcementWatchlist.map(async (entry) => ({
          entry,
          env: await client.getStockAnnouncements(entry.symbol, cnCompactDaysAgo(now, 7), compact),
        })),
      )
      : deferredAnnouncements,
    includeSlowSignals ? rankingClient.getStockRankings('gainers', 8) : deferredRankings,
    includeSlowSignals ? rankingClient.getStockRankings('losers', 8) : deferredRankings,
    includeSlowSignals ? rankingClient.getStockRankings('amount', 8) : deferredRankings,
  ]);
  const sectors = mapSectors(pulseEnv);
  const leaderboards: LeaderboardsSnapshot = {
    gainers: mapRankingLeaders(rankingGainers, 'gainers'),
    losers: mapRankingLeaders(rankingLosers, 'losers'),
    amount: mapRankingLeaders(rankingAmount, 'amount'),
  };
  const marketIndices = mapIndices(indexCn);
  const temperature = marketTemperature(pulseEnv);
  const news = buildNews(stocks, pulseEnv, announcements);
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
      source: 'akshare',
      isFallbackWatchlist: watchlistRows.length === 0,
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
  const freshTtl = snapshot.freshness.status === 'partial'
    ? DASHBOARD_PARTIAL_FRESH_TTL_MS
    : DASHBOARD_FRESH_TTL_MS;
  dashboardCache.set(cacheKey, {
    snapshot,
    freshUntil: Date.now() + freshTtl,
    staleUntil: Date.now() + DASHBOARD_STALE_TTL_MS,
    refreshPromise,
  });
}

function withPreservedSlowSignals(snapshot: DashboardSnapshot, previous?: DashboardSnapshot): DashboardSnapshot {
  if (!previous || (snapshot.freshness.status !== 'fresh' && snapshot.freshness.status !== 'partial')) return snapshot;
  const shouldPreserveMarketIndices = snapshot.marketIndices.length === 0 && previous.marketIndices.length > 0;
  const shouldPreserveSectors = snapshot.sectors.length === 0 && previous.sectors.length > 0;
  const shouldPreserveTemperature = snapshot.temperature === null && previous.temperature !== null;
  const shouldPreserveNews = snapshot.news.length === 0 && previous.news.length > 0;
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
    !shouldPreserveMarketIndices &&
    !shouldPreserveSectors &&
    !shouldPreserveTemperature &&
    !shouldPreserveNews &&
    !shouldPreserveLeaderboards
  ) return snapshot;

  const preservedLabels = [
    shouldPreserveMarketIndices ? '市场行情' : null,
    shouldPreserveSectors ? '行业趋势' : null,
    shouldPreserveTemperature ? '市场温度' : null,
    shouldPreserveNews ? '股市新闻' : null,
    shouldPreserveLeaderboards ? '榜单' : null,
  ].filter((label): label is string => label !== null);
  const leaderboards = shouldPreserveLeaderboards ? previous.leaderboards : snapshot.leaderboards;

  return {
    ...snapshot,
    marketIndices: shouldPreserveMarketIndices ? previous.marketIndices : snapshot.marketIndices,
    sectors: shouldPreserveSectors ? previous.sectors : snapshot.sectors,
    temperature: shouldPreserveTemperature ? previous.temperature : snapshot.temperature,
    news: shouldPreserveNews ? previous.news : snapshot.news,
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
  cacheKey: string;
  logger: MinimalLogger;
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
  }).then((snapshot) => {
    const merged = withPreservedSlowSignals(snapshot, existing?.snapshot);
    cacheDashboardSnapshot(args.cacheKey, merged);
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
  cacheKey: string;
  logger: MinimalLogger;
  watchlistRows: WatchlistEntry[];
  effectiveWatchlist: WatchlistEntry[];
}): Promise<DashboardSnapshot> {
  const existing = dashboardCache.get(args.cacheKey);
  if (existing?.refreshPromise) return existing.refreshPromise;
  const quickFirst = !existing?.snapshot;

  const refreshPromise = buildDashboardSnapshot({
    logger: args.logger,
    watchlistRows: args.watchlistRows,
    effectiveWatchlist: args.effectiveWatchlist,
    now: new Date(),
    includeSlowSignals: !quickFirst,
  }).then((snapshot) => {
    if (quickFirst) {
      const fullRefreshPromise = startFullDashboardRefresh(args);
      cacheDashboardSnapshot(args.cacheKey, snapshot, fullRefreshPromise);
      fullRefreshPromise.catch(() => undefined);
    } else {
      const merged = withPreservedSlowSignals(snapshot, existing?.snapshot);
      cacheDashboardSnapshot(args.cacheKey, merged);
      return merged;
    }
    return snapshot;
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
  logger: MinimalLogger;
  userInternalId: number;
  watchlistRows: WatchlistEntry[];
  effectiveWatchlist: WatchlistEntry[];
}): Promise<DashboardSnapshot> {
  const cacheKey = dashboardCacheKey(args.userInternalId, args.effectiveWatchlist);
  const cached = dashboardCache.get(cacheKey);
  const nowMs = Date.now();
  if (cached?.snapshot && cached.freshUntil > nowMs) return cached.snapshot;

  const refreshPromise = startDashboardRefresh({
    cacheKey,
    logger: args.logger,
    watchlistRows: args.watchlistRows,
    effectiveWatchlist: args.effectiveWatchlist,
  });

  if (cached?.snapshot && cached.staleUntil > nowMs) {
    return markStale(cached.snapshot, '正在后台刷新行情，当前展示最近一次真实数据。');
  }

  try {
    return await withTimeout(refreshPromise, DASHBOARD_FIRST_PAINT_BUDGET_MS);
  } catch {
    return buildPartialDashboardSnapshot(args.watchlistRows, args.effectiveWatchlist);
  }
}

export const stocksRouter = router({
  dashboardSnapshot: protectedProcedure.query(async ({ ctx }) => {
    const userInternalId = await requireUserId(ctx.db, ctx.userId);
    const watchlistRows = await listWatchlistForUser(ctx.db, userInternalId);
    const effectiveWatchlist = watchlistRows.length > 0 ? watchlistRows : FALLBACK_WATCHLIST;
    return resolveDashboardSnapshot({
      logger: ctx.logger,
      userInternalId,
      watchlistRows,
      effectiveWatchlist,
    });
  }),

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
  buildDashboardSnapshot,
  dashboardCache,
  withPreservedSlowSignals,
};

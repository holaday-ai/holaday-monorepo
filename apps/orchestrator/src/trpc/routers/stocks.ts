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
  KlineRow,
  MarketPulseRow,
  SectorEntry,
  StockRankingRow,
  WatchlistEntry,
} from '../../agent/a-share/briefing-types.js';
import type { SymbolRow } from '../../agent/a-share/akshare-client.js';
import { fmtNum, fmtYiYuan, pick, toNum } from '../../agent/a-share/ashare-format.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

type Db = typeof import('../../db/client.js').db;

type Market = 'A' | 'HK' | 'US';
type Signal = '强势' | '偏强' | '中性' | '偏弱' | '风险升高' | '待观察';

interface StockSnapshot {
  symbol: string;
  name: string;
  market: Market;
  price: string;
  changePct: number;
  signal: Signal;
  report: '已生成' | '待生成' | '生成中';
  spark: number[];
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

function sparkFromKline(rows: KlineRow[]): number[] {
  const values = rows
    .slice(-8)
    .map((row) => toNum(pick(row, ['收盘', 'close', '最新价'])))
    .filter((value): value is number => value !== null);
  return values.length >= 2 ? values : [];
}

function latestKline(rows: KlineRow[]): KlineRow | null {
  return rows.length > 0 ? rows[rows.length - 1] ?? null : null;
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

  const [dailyEnv, seriesEnv] = await Promise.all([
    client.getStockKline(entry.symbol),
    client.getStockKline(entry.symbol, 8),
  ]);
  if (dailyEnv.error || dailyEnv.data.length === 0) return unavailableStock(entry, fallback);
  const last = latestKline(dailyEnv.data);
  if (!last) return unavailableStock(entry, fallback);
  const close = pick(last, ['收盘', 'close', '最新价']);
  const changePct = toNum(pick(last, ['涨跌幅', 'changePct'])) ?? fallback.changePct;
  const spark = seriesEnv.error ? [] : sparkFromKline(seriesEnv.data);
  return {
    ...fallback,
    symbol: entry.symbol,
    name: entry.displayName ?? fallback.name,
    market: entry.market as Market,
    price: fmtNum(close, 2),
    changePct: Number(changePct.toFixed(2)),
    signal: signalFromChange(changePct),
    spark,
    note: spark.length >= 2
      ? `来源 AkShare · ${entry.displayName ?? entry.symbol} 近 8 个交易日真实收盘价`
      : `来源 AkShare · ${entry.displayName ?? entry.symbol} 最新行情，走势线暂缺`,
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
    return {
      score: 62,
      mood: '偏乐观',
      dayDelta: 6,
      weekDelta: 12,
      historicalPosition: '68%',
      notes: ['市场情绪逐步回暖，成交活跃度提升。', 'AI 链和光伏设备贡献主要热度。'],
    };
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

export const stocksRouter = router({
  dashboardSnapshot: protectedProcedure.query(async ({ ctx }) => {
    const userInternalId = await requireUserId(ctx.db, ctx.userId);
    const watchlistRows = await listWatchlistForUser(ctx.db, userInternalId);
    const effectiveWatchlist = watchlistRows.length > 0 ? watchlistRows : FALLBACK_WATCHLIST;
    const client = new HttpAkshareClient({
      baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
      logger: ctx.logger,
    });
    const fastClient = new HttpAkshareClient({
      baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
      timeoutMs: 2_500,
      logger: ctx.logger,
    });
    const rankingClient = new HttpAkshareClient({
      baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
      timeoutMs: 45_000,
      logger: ctx.logger,
    });
    const now = new Date();
    const { compact } = cnDateParts(now);
    const announcementWatchlist = effectiveWatchlist
      .filter((entry) => entry.market === 'A')
      .slice(0, 5);
    const [indexCn, pulseEnv, stocks, announcements, rankingGainers, rankingLosers, rankingAmount] = await Promise.all([
      client.getIndexQuote('cn'),
      fastClient.getMarketPulse(compact),
      Promise.all(effectiveWatchlist.slice(0, 8).map((entry, index) => stockSnapshot(client, entry, index))),
      Promise.all(
        announcementWatchlist.map(async (entry) => ({
          entry,
          env: await fastClient.getStockAnnouncements(entry.symbol, cnCompactDaysAgo(now, 7), compact),
        })),
      ),
      rankingClient.getStockRankings('gainers', 8),
      rankingClient.getStockRankings('losers', 8),
      rankingClient.getStockRankings('amount', 8),
    ]);
    const sectors = mapSectors(pulseEnv);
    const leaderboards: LeaderboardsSnapshot = {
      gainers: mapRankingLeaders(rankingGainers, 'gainers'),
      losers: mapRankingLeaders(rankingLosers, 'losers'),
      amount: mapRankingLeaders(rankingAmount, 'amount'),
    };
    return {
      updatedAt: now.toISOString(),
      source: 'akshare',
      isFallbackWatchlist: watchlistRows.length === 0,
      watchlistStocks: stocks,
      marketIndices: mapIndices(indexCn),
      sectors,
      starStocks: stocks.filter((stockRow) => stockRow.price !== '—').slice(0, 6),
      temperature: marketTemperature(pulseEnv),
      news: buildNews(stocks, pulseEnv, announcements),
      leaders: leaderboards.gainers,
      leaderboards,
    };
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

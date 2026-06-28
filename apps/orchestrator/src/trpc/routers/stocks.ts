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
  NVDA: stock('NVDA', '英伟达', 'US', '949.50', 2.35, [42, 48, 44, 53, 58, 55, 63, 72], 'AI 链订单能见度继续提升'),
  TSLA: stock('TSLA', '特斯拉', 'US', '178.22', -1.12, [61, 58, 60, 54, 49, 52, 47, 45], '欧洲销量和毛利率仍是压力点'),
  AAPL: stock('AAPL', '苹果公司', 'US', '192.45', 0.58, [47, 48, 46, 51, 50, 54, 53, 58], 'WWDC 临近，AI 功能预期升温'),
  MSFT: stock('MSFT', '微软', 'US', '415.65', 0.78, [55, 57, 56, 60, 63, 62, 65, 67], '云与 Copilot 需求保持稳健'),
  '600519': stock('600519', '贵州茅台', 'A', '1,535.00', -0.36, [50, 48, 49, 45, 46, 44, 43, 42], '消费预期仍偏弱，等待量价验证', '待生成'),
  '300750': stock('300750', '宁德时代', 'A', '205.18', 1.48, [46, 49, 51, 50, 54, 56, 55, 60], '新能源链资金关注度回升', '待生成'),
  '0700.HK': stock('0700.HK', '腾讯控股', 'HK', '386.40', 0.82, [52, 51, 54, 56, 55, 59, 61, 62], '游戏与广告业务预期改善', '待生成'),
};

const FALLBACK_INDICES: IndexSnapshot[] = [
  { name: '上证指数', price: '3,348.37', changePct: 0.42, turnover: '4,521亿' },
  { name: '深证成指', price: '10,189.20', changePct: 0.65, turnover: '6,231亿' },
  { name: '创业板指', price: '2,051.32', changePct: 0.88, turnover: '3,102亿' },
  { name: '恒生指数', price: '18,726.53', changePct: 1.22, turnover: '1,485亿' },
  { name: '纳斯达克', price: '16,735.02', changePct: 1.41, turnover: '5,862亿' },
  { name: '标普500', price: '5,309.91', changePct: 0.99, turnover: '4,321亿' },
];

const FALLBACK_SECTORS: SectorSnapshot[] = [
  { name: '半导体', changePct: 2.45, leader: '寒武纪-U', flow: '资金净流入', spark: [38, 45, 42, 51, 56, 60] },
  { name: '光伏设备', changePct: 1.89, leader: '隆基绿能', flow: '放量回暖', spark: [44, 43, 48, 52, 53, 56] },
  { name: '消费电子', changePct: 1.75, leader: '立讯精密', flow: '事件催化', spark: [40, 43, 45, 49, 50, 55] },
  { name: '软件开发', changePct: 1.63, leader: '金山办公', flow: 'AI 主题', spark: [46, 45, 48, 51, 54, 53] },
  { name: '白酒', changePct: -0.12, leader: '贵州茅台', flow: '缩量震荡', spark: [55, 52, 50, 48, 49, 46] },
];

const FALLBACK_NEWS: NewsSnapshot[] = [
  { category: '盘面', time: '09:31', title: '中芯国际上调 Q2 营收指引，受益于成熟制程需求', symbols: ['半导体'], source: '示例动态' },
  { category: '盘面', time: '08:45', title: '国家发改委：支持光伏行业高质量发展，鼓励技术创新', symbols: ['光伏'], source: '示例动态' },
  { category: '关注', time: '07:58', title: '美联储会议纪要：多位官员认为短期内不宜降息', symbols: ['美股'], source: '示例动态' },
  { category: '关注', time: '07:10', title: '苹果 WWDC 邀请函发布，AI 功能预期升温', symbols: ['AAPL'], source: '示例动态' },
  { category: '盘面', time: '06:55', title: '光伏玻璃价格本周上涨 5.2%', symbols: ['光伏'], source: '示例动态' },
];

const FALLBACK_LEADERS: LeaderSnapshot[] = [
  { rank: 1, name: '寒武纪-U', price: '738.00', changePct: 6.88, reason: 'AI 芯片热度' },
  { rank: 2, name: '中际旭创', price: '128.56', changePct: 5.21, reason: '光模块放量' },
  { rank: 3, name: '新易盛', price: '108.22', changePct: 4.35, reason: '算力链共振' },
  { rank: 4, name: '天孚通信', price: '82.31', changePct: 3.91, reason: '资金回流' },
  { rank: 5, name: '剑桥科技', price: '66.78', changePct: 3.52, reason: '异动跟踪' },
];

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
  spark: number[],
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
    spark,
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

function sparkFromKline(rows: KlineRow[], fallback: number[]): number[] {
  const values = rows
    .slice(-8)
    .map((row) => toNum(pick(row, ['收盘', 'close', '最新价'])))
    .filter((value): value is number => value !== null);
  return values.length >= 2 ? values : fallback;
}

function latestKline(rows: KlineRow[]): KlineRow | null {
  return rows.length > 0 ? rows[rows.length - 1] ?? null : null;
}

async function stockSnapshot(
  client: HttpAkshareClient,
  entry: WatchlistEntry,
  index: number,
): Promise<StockSnapshot> {
  const normalized = entry.symbol.trim().toUpperCase();
  const fallback = FALLBACK_STOCKS[normalized] ?? fallbackStock(entry, index);
  if (entry.market !== 'A') return fallback;

  const env = await client.getStockKline(entry.symbol);
  if (env.error || env.data.length === 0) return fallback;
  const last = latestKline(env.data);
  if (!last) return fallback;
  const close = pick(last, ['收盘', 'close', '最新价']);
  const changePct = toNum(pick(last, ['涨跌幅', 'changePct'])) ?? fallback.changePct;
  return {
    ...fallback,
    symbol: entry.symbol,
    name: entry.displayName ?? fallback.name,
    market: entry.market as Market,
    price: fmtNum(close, 2),
    changePct: Number(changePct.toFixed(2)),
    signal: signalFromChange(changePct),
    spark: sparkFromKline(env.data, fallback.spark),
    note: env.error ? fallback.note : `来源 AkShare · ${entry.displayName ?? entry.symbol} 近期走势`,
  };
}

function fallbackStock(entry: WatchlistEntry, index: number): StockSnapshot {
  const changePct = Number((((index % 5) - 2) * 0.42 + 0.36).toFixed(2));
  const base = 46 + index * 3;
  return stock(
    entry.symbol,
    entry.displayName ?? entry.symbol,
    entry.market as Market,
    entry.market === 'US' ? (180 + index * 17.4).toFixed(2) : (18 + index * 23.6).toFixed(2),
    changePct,
    [base, base + 2, base + 1, base + 4, base + 3, base + 6, base + 5],
    '等待 Holaday 建立更完整的分析画像',
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
  if (env.error || !Array.isArray(sectors) || sectors.length === 0) return FALLBACK_SECTORS;
  return sectors.slice(0, 5).map((sector, index) => sectorFromEntry(sector, index));
}

function sectorFromEntry(entry: SectorEntry, index: number): SectorSnapshot {
  const changePct = entry.涨跌幅 ?? 0;
  const base = 38 + index * 2;
  return {
    name: entry.板块,
    changePct: Number(changePct.toFixed(2)),
    leader: entry.领涨股 || '—',
    flow: entry.领涨股涨跌幅 != null ? `领涨股 ${entry.领涨股涨跌幅.toFixed(2)}%` : '板块异动',
    spark: [base, base + 4, base + 3, base + 7, base + 8, base + 11],
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

function buildLeaders(sectors: SectorSnapshot[]): LeaderSnapshot[] {
  const leaders = sectors
    .filter((sector) => sector.leader && sector.leader !== '—')
    .slice(0, 5)
    .map((sector, index) => ({
      rank: index + 1,
      name: sector.leader,
      price: '—',
      changePct: sector.changePct,
      reason: sector.name,
    }));
  return leaders.length > 0 ? leaders : FALLBACK_LEADERS;
}

function mapRankingLeaders(
  env: AkEnvelope<StockRankingRow>,
  metric: 'gainers' | 'losers' | 'amount',
  fallback: LeaderSnapshot[],
): LeaderSnapshot[] {
  if (env.error || env.data.length === 0) return fallback;
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
  return rows.length > 0 ? rows : fallback;
}

function fallbackLeaderboards(sectors: SectorSnapshot[]): LeaderboardsSnapshot {
  const gainers = buildLeaders(sectors);
  const losers = [...gainers]
    .map((row) => ({ ...row, changePct: row.changePct > 0 ? -row.changePct : row.changePct }))
    .sort((a, b) => a.changePct - b.changePct)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return { gainers, losers, amount: gainers };
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
  for (const stockRow of stocks.slice(0, 4)) {
    rows.push({
      category: '关注',
      time: '关注',
      title: `${stockRow.name} 今日涨跌幅 ${stockRow.changePct > 0 ? '+' : ''}${stockRow.changePct.toFixed(2)}%`,
      symbols: [stockRow.symbol],
      source: 'AkShare 行情',
    });
  }
  return rows.length > 0 ? rows.slice(0, 5) : FALLBACK_NEWS;
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
    const fallbackBoards = fallbackLeaderboards(sectors);
    const leaderboards: LeaderboardsSnapshot = {
      gainers: mapRankingLeaders(rankingGainers, 'gainers', fallbackBoards.gainers),
      losers: mapRankingLeaders(rankingLosers, 'losers', fallbackBoards.losers),
      amount: mapRankingLeaders(rankingAmount, 'amount', fallbackBoards.amount),
    };
    return {
      updatedAt: now.toISOString(),
      source: 'akshare',
      isFallbackWatchlist: watchlistRows.length === 0,
      watchlistStocks: stocks,
      marketIndices: mapIndices(indexCn),
      sectors,
      starStocks: stocks.concat(FALLBACK_STOCKS['300750'] ?? []).filter(Boolean).slice(0, 6),
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

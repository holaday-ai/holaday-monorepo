/**
 * Phase 1 指令 #2 ③ §6 — briefing 服务：watchlist → AkshareClient → 渲染.
 *
 * 服务端组装层（scheduled-runner 调用，绕过 tRPC）。纯组合 + 渲染，传输
 * 经 AkshareClient 注入 → 可用 fake client 完整单测。每只自选股的公告/
 * 解禁/K线并发取，整体 envelope 直喂确定性渲染器（prod 默认）。
 *
 * 投递：scheduled-runner 的 dispatch 分支识别简报 intent → 调本服务出
 * markdown → notify() 写 inbox + webhook（见 §6 wiring，Vultr 落地）。
 */

import { asc, desc, eq } from 'drizzle-orm';
import { watchlists } from '../../db/schema/watchlists.js';
import type { AkshareClient } from './akshare-client.js';
import {
  type BriefingMode,
  renderPostmarketBriefing,
  renderPremarketBriefing,
} from './briefing-renderer.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  KlineRow,
  PostmarketBriefingInput,
  PremarketBriefingInput,
  UnlockRow,
  WatchlistEntry,
} from './briefing-types.js';

type Db = typeof import('../../db/client.js').db;

export interface BriefingServiceDeps {
  db: Db;
  client: AkshareClient;
  /** 渲染模式，默认 prod（用户版，剥离 [dev] 诊断）。 */
  mode?: BriefingMode;
  /** 注入「现在」便于测试；默认 new Date()。 */
  now?: Date;
}

/** 服务端读取某用户自选股（scheduled-runner 用，绕过 tRPC）。 */
export async function listWatchlistForUser(
  db: Db,
  userInternalId: number,
): Promise<WatchlistEntry[]> {
  const rows = await db
    .select({
      symbol: watchlists.symbol,
      market: watchlists.market,
      displayName: watchlists.displayName,
    })
    .from(watchlists)
    .where(eq(watchlists.userId, userInternalId))
    .orderBy(asc(watchlists.sortOrder), desc(watchlists.createdAt));
  return rows.map((r) => ({ symbol: r.symbol, market: r.market, displayName: r.displayName }));
}

/** 北京时区日期：{ iso: 'YYYY-MM-DD', compact: 'YYYYMMDD' }。 */
function cnDateParts(now: Date): { iso: string; compact: string } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return { iso, compact: iso.replace(/-/g, '') };
}

/** 北京日历日 - days 天（中国无 DST，24h 偏移即前一日历日）。 */
function cnDatePartsShift(now: Date, days: number): { iso: string; compact: string } {
  return cnDateParts(new Date(now.getTime() - days * 86_400_000));
}

/** iso('YYYY-MM-DD') 正午 UTC 的星期（0=周日…6=周六），与渲染器/分发口径一致。 */
function utcDow(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** 该 iso 是否交易日：交易日历优先，日历不可用退「工作日即视为交易日」。 */
async function isTradingDay(client: AkshareClient, iso: string): Promise<boolean> {
  try {
    const env = await client.getTradingDay(iso);
    const row = env.data[0];
    if (!env.error && row && typeof row.is_trading_day === 'boolean') return row.is_trading_day;
  } catch {
    // 落工作日兜底
  }
  const dow = utcDow(iso);
  return dow !== 0 && dow !== 6;
}

/**
 * 上一交易日（盘前龙虎榜回顾用）。先把周末本地跳掉（不耗调用），只对工作日候选
 * 查交易日历——多数早晨 1 次命中（昨天/上周五），节后早晨多 1~2 次。封顶 4 个候选。
 */
async function resolvePrevTradingDay(
  client: AkshareClient,
  now: Date,
): Promise<{ iso: string; compact: string }> {
  const candidates: { iso: string; compact: string }[] = [];
  for (let d = 1; d <= 10 && candidates.length < 4; d++) {
    const parts = cnDatePartsShift(now, d);
    const dow = utcDow(parts.iso);
    if (dow !== 0 && dow !== 6) candidates.push(parts);
  }
  for (const c of candidates) {
    if (await isTradingDay(client, c.iso)) return c;
  }
  return candidates[0] ?? cnDatePartsShift(now, 1);
}

async function perSymbol<T>(
  wl: WatchlistEntry[],
  fn: (symbol: string) => Promise<AkEnvelope<T>>,
): Promise<Record<string, AkEnvelope<T>>> {
  const entries = await Promise.all(wl.map(async (e) => [e.symbol, await fn(e.symbol)] as const));
  return Object.fromEntries(entries);
}

/** 组装并渲染盘前简报（markdown）。 */
export async function buildPremarketBriefing(
  deps: BriefingServiceDeps,
  userInternalId: number,
): Promise<string> {
  const now = deps.now ?? new Date();
  const { iso, compact: today } = cnDateParts(now);
  // 公告窗口「近 24h」：昨天 → 今天（cninfo 不传范围会返历史默认页≈旧公告）。
  const annStart = cnDatePartsShift(now, 1).compact;
  const watchlist = await listWatchlistForUser(deps.db, userInternalId);
  // 上一交易日龙虎榜（盘后取不到 → 移盘前回顾，BOSS 拍板）。
  const prevTd = await resolvePrevTradingDay(deps.client, now);
  const [indexUs, indexHk, announcements, shareUnlock, dragonTiger, ztReview] = await Promise.all([
    deps.client.getIndexQuote('us'),
    deps.client.getIndexQuote('hk'),
    perSymbol<AnnouncementRow>(watchlist, (s) =>
      deps.client.getStockAnnouncements(s, annStart, today),
    ),
    perSymbol<UnlockRow>(watchlist, (s) => deps.client.getShareUnlock(s)),
    deps.client.getDragonTiger(prevTd.compact),
    // v2: 上一交易日涨停梯队回顾（与龙虎榜同为上一交易日，进回顾段）。
    deps.client.getZtPoolSummary(prevTd.compact),
  ]);
  const input: PremarketBriefingInput = {
    date: iso,
    generatedAt: now.toISOString(),
    watchlist,
    indexUs,
    indexHk,
    announcements,
    shareUnlock,
    dragonTiger,
    dragonTigerDate: prevTd.iso,
    ztReview,
  };
  return renderPremarketBriefing(input, { mode: deps.mode ?? 'prod' });
}

/** 组装并渲染盘后复盘（markdown）。 */
export async function buildPostmarketBriefing(
  deps: BriefingServiceDeps,
  userInternalId: number,
): Promise<string> {
  const now = deps.now ?? new Date();
  const { iso, compact: today } = cnDateParts(now);
  const watchlist = await listWatchlistForUser(deps.db, userInternalId);
  // 涨停「昨对比」需上一交易日 compact（温度计「涨停X(昨Y)」，BOSS 样张）。
  const prevTd = await resolvePrevTradingDay(deps.client, now);
  // 龙虎榜不在盘后（当日榜单晚间才披露）→ 移到次日盘前回顾。公告窗口「当日」。
  const [indexCn, northbound, dailyKline, announcements, marketPulse] = await Promise.all([
    deps.client.getIndexQuote('cn'),
    deps.client.getNorthboundFlow(),
    perSymbol<KlineRow>(watchlist, (s) => deps.client.getStockKline(s)),
    perSymbol<AnnouncementRow>(watchlist, (s) =>
      deps.client.getStockAnnouncements(s, today, today),
    ),
    // v2: 市场温度计 + 板块主线 + 大盘净流入（当日聚合 + 涨停昨对比）。
    deps.client.getMarketPulse(today, prevTd.compact),
  ]);
  const input: PostmarketBriefingInput = {
    date: iso,
    generatedAt: now.toISOString(),
    watchlist,
    indexCn,
    northbound,
    dailyKline,
    announcements,
    marketPulse,
  };
  return renderPostmarketBriefing(input, { mode: deps.mode ?? 'prod' });
}

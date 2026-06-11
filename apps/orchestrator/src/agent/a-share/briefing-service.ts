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
  const { iso } = cnDateParts(now);
  const watchlist = await listWatchlistForUser(deps.db, userInternalId);
  const [indexUs, indexHk, announcements, shareUnlock] = await Promise.all([
    deps.client.getIndexQuote('us'),
    deps.client.getIndexQuote('hk'),
    perSymbol<AnnouncementRow>(watchlist, (s) => deps.client.getStockAnnouncements(s)),
    perSymbol<UnlockRow>(watchlist, (s) => deps.client.getShareUnlock(s)),
  ]);
  const input: PremarketBriefingInput = {
    date: iso,
    generatedAt: now.toISOString(),
    watchlist,
    indexUs,
    indexHk,
    announcements,
    shareUnlock,
  };
  return renderPremarketBriefing(input, { mode: deps.mode ?? 'prod' });
}

/** 组装并渲染盘后复盘（markdown）。 */
export async function buildPostmarketBriefing(
  deps: BriefingServiceDeps,
  userInternalId: number,
): Promise<string> {
  const now = deps.now ?? new Date();
  const { iso, compact } = cnDateParts(now);
  const watchlist = await listWatchlistForUser(deps.db, userInternalId);
  const [indexCn, northbound, dragonTiger, dailyKline, announcements] = await Promise.all([
    deps.client.getIndexQuote('cn'),
    deps.client.getNorthboundFlow(),
    deps.client.getDragonTiger(compact),
    perSymbol<KlineRow>(watchlist, (s) => deps.client.getStockKline(s)),
    perSymbol<AnnouncementRow>(watchlist, (s) => deps.client.getStockAnnouncements(s)),
  ]);
  const input: PostmarketBriefingInput = {
    date: iso,
    generatedAt: now.toISOString(),
    watchlist,
    indexCn,
    northbound,
    dailyKline,
    dragonTiger,
    announcements,
  };
  return renderPostmarketBriefing(input, { mode: deps.mode ?? 'prod' });
}

/**
 * Phase 1 #2 ④ — A股即时问答 matcher（M1）.
 *
 * 判定「是否 A股个股问答」+ 抽取「个股 / 日期 / 问句类型」。null = 不命中（走通用路径）。
 * 门槛：显式选了 a-share-analyst 技能(roleId)，或（含 A股术语 且（问句 或 命中个股 或
 * 自选股整体问））且**至少解析出一只个股**（M1 事实卡按个股；市场级问答 M2+）。
 *
 * 见 docs/SKILL_ROUTER_PATTERN.md「matcher 注册点」。
 */

import type { AshareQaMatch, QaKind, ResolvedStock } from './ashare-qa-types.js';
import { resolveStocks } from './ashare-stock-resolver.js';

const ASHARE_ROLE_ID = 'a-share-analyst';

/** A股语境术语（命中之一才认为是 A股问题）。 */
const ASHARE_TERMS = [
  '龙虎榜',
  '公告',
  '涨',
  '跌',
  '股价',
  '盘面',
  '表现',
  '解禁',
  '北向',
  '异动',
  '行情',
  '收盘',
  '成交',
  '股票',
  '个股',
];

/** 问句标记。 */
const QUESTION_MARKERS = [
  '为什么',
  '为啥',
  '怎么',
  '咋',
  '如何',
  '吗',
  '?',
  '？',
  '有什么',
  '啥',
  '多少',
];

/** 异动归因信号（否则归 info 资讯）。 */
const ANOMALY_TERMS = [
  '为什么',
  '为啥',
  '异动',
  '异常',
  '大涨',
  '大跌',
  '暴涨',
  '暴跌',
  '拉升',
  '跳水',
  '闪崩',
  '涨停',
  '跌停',
];

/** 自选股整体问。 */
const WATCHLIST_TERMS = ['自选股', '我的股', '我的自选', '我的持仓', '持仓'];

export interface MatchAshareQaOpts {
  intent: string;
  roleId?: string | null;
  /** 用户自选股（用于名称命中 + 自选股整体问）。 */
  watchlist: ResolvedStock[];
  /** 注入「现在」便于测试；默认 new Date()。 */
  now?: Date;
}

function cnDateParts(now: Date): { iso: string; compact: string } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return { iso, compact: iso.replace(/-/g, '') };
}

interface IntentGate {
  gated: boolean;
  kind: QaKind;
  dateIso: string;
  dateCompact: string;
  /** sync 解析出的个股（代码/自选股，零网络）。 */
  syncStocks: ResolvedStock[];
}

function intentGate(opts: MatchAshareQaOpts): IntentGate {
  const text = opts.intent ?? '';
  const isRole = opts.roleId === ASHARE_ROLE_ID;
  const hasTerm = isRole || ASHARE_TERMS.some((t) => text.includes(t));
  const hasQuestion = QUESTION_MARKERS.some((t) => text.includes(t));
  const wantsWatchlist = WATCHLIST_TERMS.some((t) => text.includes(t));

  let syncStocks = resolveStocks(text, opts.watchlist);
  if (syncStocks.length === 0 && wantsWatchlist && opts.watchlist.length > 0) {
    syncStocks = opts.watchlist;
  }
  // 意图门槛：显式技能 / 自选股整体问 / （含 A股术语 且（问句 或 命中个股））
  const gated = isRole || wantsWatchlist || (hasTerm && (hasQuestion || syncStocks.length > 0));
  const kind: QaKind = ANOMALY_TERMS.some((t) => text.includes(t)) ? 'anomaly' : 'info';
  const { iso, compact } = cnDateParts(opts.now ?? new Date());
  return { gated, kind, dateIso: iso, dateCompact: compact, syncStocks };
}

/** 同步 matcher（M1）：仅代码 + 自选股，无个股 → null。 */
export function matchAshareQa(opts: MatchAshareQaOpts): AshareQaMatch | null {
  const g = intentGate(opts);
  if (!g.gated || g.syncStocks.length === 0) return null;
  return {
    kind: g.kind,
    stocks: g.syncStocks.slice(0, 5),
    dateIso: g.dateIso,
    dateCompact: g.dateCompact,
  };
}

/** name-search 函数：query → 个股（包装 client.searchSymbol → ResolvedStock[]）。 */
export type SymbolSearchFn = (query: string) => Promise<ResolvedStock[]>;

/**
 * 异步解析（M2）：先 sync（代码/自选股，零网络）；命中即返。门槛过但无个股 →
 * name-search 补短名/非自选全名（表 day-cache，冷启返空则降级 null 走通用路径）。
 */
export async function resolveAshareQa(
  opts: MatchAshareQaOpts,
  search: SymbolSearchFn,
): Promise<AshareQaMatch | null> {
  const g = intentGate(opts);
  if (!g.gated) return null;
  if (g.syncStocks.length > 0) {
    return {
      kind: g.kind,
      stocks: g.syncStocks.slice(0, 5),
      dateIso: g.dateIso,
      dateCompact: g.dateCompact,
    };
  }
  let found: ResolvedStock[] = [];
  try {
    found = await search(opts.intent ?? '');
  } catch {
    found = [];
  }
  if (found.length === 0) return null;
  return {
    kind: g.kind,
    stocks: found.slice(0, 5),
    dateIso: g.dateIso,
    dateCompact: g.dateCompact,
  };
}

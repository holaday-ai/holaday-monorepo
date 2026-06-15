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

/** A股语境术语（命中之一才认为是 A股问题）。含持仓语境词（Q3 泄漏修：套牢/割肉
 * 等问句也要进合规框架，BOSS 要求②）。 */
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
  // 持仓语境词（BOSS 要求②）：套牢/割肉/解套/补仓/被套/回本…
  '套牢',
  '被套',
  '套了',
  '割肉',
  '解套',
  '补仓',
  '回本',
  '摊薄',
  '加仓',
  '减仓',
  '仓位',
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

/**
 * 指数/大盘级问句信号（E16 修）。命中 → 走**指数 lane**（三大指数速览卡），不进个股 lane，
 * 也**不做 name-search**（防「查今天A股三大指数收盘」里的「今天」被短名窗口误命中成
 * 「今天国际(300532)」）。仅在**没有显式个股**（代码/自选股名）时生效——有个股则个股优先。
 */
const INDEX_TERMS = [
  '三大指数',
  '大盘',
  '上证',
  '深证',
  '创业板',
  '沪指',
  '深成指',
  '科创50',
  '科创板',
  '北证',
  '两市',
  '综指',
  '指数',
];

/** 是否指数/大盘级问句（无 6 位个股代码时才算——有代码以个股为准）。 */
export function isIndexQuery(text: string): boolean {
  return INDEX_TERMS.some((t) => text.includes(t));
}

/**
 * 深度/全景意图（Phase2）：「详细分析/全面看看/深度分析 XX」→ 出七维全景版。
 * 仅作"全景 vs 轻量"的开关，**不改变**触发门槛（仍需解析出个股）；不命中 → 轻量速览（现有行为）。
 */
const DEEP_TERMS = [
  '详细分析',
  '深度分析',
  '深入分析',
  '全面分析',
  '全面看看',
  '全面看',
  '详细看看',
  '全面了解',
  '详细了解',
  '深扒',
  '深度解析',
  '全方位',
  '全景',
  '基本面和估值',
];
export function isDeepQuery(text: string): boolean {
  return DEEP_TERMS.some((t) => text.includes(t));
}

/**
 * name-search 仅用于**短问句 / 明确个股指向**（E16 修：长查询不在里面乱匹配名称，
 * 防普通词被短名窗口误命中）。门槛：去掉指数/大盘信号 + 长度上限（短问句）。
 */
const NAME_SEARCH_MAX_LEN = 16;
function shouldNameSearch(text: string): boolean {
  return !isIndexQuery(text) && text.trim().length <= NAME_SEARCH_MAX_LEN;
}

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
    deep: isDeepQuery(opts.intent ?? ''),
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
  const deep = isDeepQuery(opts.intent ?? '');
  if (g.syncStocks.length > 0) {
    return {
      kind: g.kind,
      stocks: g.syncStocks.slice(0, 5),
      dateIso: g.dateIso,
      dateCompact: g.dateCompact,
      deep,
    };
  }
  // 仅短问句 / 明确个股指向才 name-search（E16：长查询不乱匹配名称）。
  if (!shouldNameSearch(opts.intent ?? '')) return null;
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
    deep,
  };
}

/**
 * 上下文内解析（启用 a-share 技能 / 显式选技能）。BOSS 拍板门控语义：
 *   - 命中任一 **A股信号**（个股解析成功 / A股术语 / 持仓语境词 / 自选股整体问）→ 进合规
 *     框架（有个股 → match 出 lane；无个股 → `hasSignal=true` 调用方走引导兜底）。
 *   - **完全无 A股信号**（如「帮我写周报」）→ match=null & hasSignal=false → 调用方放行
 *     通用路径，**不得误拦**。
 * 与 resolveAshareQa 区别：上下文内**总是**尝试 name-search（短名也算个股解析成功）。
 */
export async function resolveAshareInContext(
  opts: MatchAshareQaOpts,
  search: SymbolSearchFn,
): Promise<{ match: AshareQaMatch | null; hasSignal: boolean; indexIntent: boolean }> {
  const text = opts.intent ?? '';
  const hasTerm = ASHARE_TERMS.some((t) => text.includes(t)); // 含持仓语境词
  const wantsWatchlist = WATCHLIST_TERMS.some((t) => text.includes(t));
  const deep = isDeepQuery(text);
  const toMatch = (stocks: ResolvedStock[]): AshareQaMatch => {
    const kind: QaKind = ANOMALY_TERMS.some((t) => text.includes(t)) ? 'anomaly' : 'info';
    const { iso, compact } = cnDateParts(opts.now ?? new Date());
    return { kind, stocks: stocks.slice(0, 5), dateIso: iso, dateCompact: compact, deep };
  };

  // 显式个股优先（代码 / 自选股名 / 自选股整体问），零网络。
  let stocks = resolveStocks(text, opts.watchlist);
  if (stocks.length === 0 && wantsWatchlist && opts.watchlist.length > 0) {
    stocks = opts.watchlist;
  }
  if (stocks.length > 0) {
    return { match: toMatch(stocks), hasSignal: true, indexIntent: false };
  }

  // 无显式个股：指数/大盘问句 → 指数 lane（E16：不 name-search，不进个股 lane）。
  if (isIndexQuery(text)) {
    return { match: null, hasSignal: true, indexIntent: true };
  }

  // 仅**短问句 / 明确个股指向**才 name-search（E16：长查询不乱匹配名称）。
  if (shouldNameSearch(text)) {
    try {
      stocks = await search(text);
    } catch {
      stocks = [];
    }
    if (stocks.length > 0) {
      return { match: toMatch(stocks), hasSignal: true, indexIntent: false };
    }
  }
  return { match: null, hasSignal: hasTerm || wantsWatchlist, indexIntent: false };
}

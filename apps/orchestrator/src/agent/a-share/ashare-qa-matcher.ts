/**
 * Phase 1 #2 ④ — A股即时问答 matcher（M1）.
 *
 * 判定「是否 A股个股问答」+ 抽取「个股 / 日期 / 问句类型」。null = 不命中（走通用路径）。
 * 门槛：显式选了 a-share-analyst 技能(roleId)，或（含 A股术语 且（问句 或 命中个股 或
 * 自选股整体问））且**至少解析出一只个股**（M1 事实卡按个股；市场级问答 M2+）。
 *
 * 见 docs/SKILL_ROUTER_PATTERN.md「matcher 注册点」。
 */

import { localNameSpans, lookupLocalNames } from './ashare-name-dictionary.js';
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
  // 估值/研究命令词（batch 10 BOSS 拍板）：启用 A股技能后，没有个股、没有其他术语的
  // 估值类长句（「用 DCF 算一下宁德时代的合理估值」「/行业 白酒」）也必须进合规框架，
  // 不得落到通用路径产出目标价/内在价值。5 个 fork 技能的命令词一并纳入。
  'DCF',
  'dcf',
  '估值',
  '目标价',
  '合理价',
  '内在价值',
  '行业',
  '对标',
  '财报',
  '论点',
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
 * 非 A 股证券信号。A 股技能常驻时，泛化的“股价/股票”不能把 Tesla/TSLA
 * 这类美股查询劫持到 A 股引导兜底；没有解析出 A 股个股/指数时应放回通用路径。
 */
const NON_A_SHARE_SECURITY_TERMS = [
  // Fund / wealth-management products are not individual A-share equities.
  // Keep them in the general research lane unless the user explicitly names
  // an A-share security (which resolveStocks handles before this guard).
  '基金',
  'ETF',
  '债券',
  '理财',
  '美股',
  '港股',
  '纳斯达克',
  '道琼斯',
  '标普',
  'NASDAQ',
  'NYSE',
  'HKEX',
  'TSLA',
  'Tesla',
  '特斯拉',
  'NVDA',
  'NVIDIA',
  '英伟达',
  'AAPL',
  'Apple',
  '苹果公司',
  'MSFT',
  'Microsoft',
  '微软',
  'AMZN',
  'Amazon',
  '亚马逊',
  'GOOGL',
  'GOOG',
  'Google',
  'Alphabet',
  '谷歌',
  'META',
  'Meta',
  '美元',
  'US$',
  '$',
];

function isNonAshareSecurityQuery(text: string): boolean {
  const upper = text.toUpperCase();
  return NON_A_SHARE_SECURITY_TERMS.some((term) =>
    /[A-Z$]/.test(term) ? upper.includes(term.toUpperCase()) : text.includes(term),
  );
}

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

// ===== 批次 11.2：长句（>16 字）抽股票名 =====================================================
// 生产里 name-search 走 akshare `searchSymbol(query)`：先「全名是 query 子串」，再拿 query 的 2-4 字
// 中文窗口做短名匹配。整句丢进去，短名窗口会让任意 2-4 字片段撞上某只股票（E16「今天」→今天国际），
// 所以长句以前干脆不搜。现在改为：
//   1) 句子里必须已有 A股信号（术语 / 深度分析词），否则不抽（「帮我写一份关于宁德的旅游攻略」不动）；
//   2) 先查本地字典（零网络，见 ashare-name-dictionary.ts），全名 + 非常用词别名；
//   3) 再按 A股术语 / 问句词 / 虚词把句子切开，取 2-8 字的中文片段作候选词，**最多查 3 个**
//      （LONG_SENTENCE_MAX_CANDIDATES），每个候选词一次 searchSymbol；
//   4) akshare 返回的结果必须**全名原样出现在句子里**才收（挡住短名窗口的误配）。
// 6 位代码不受长度限制，本来就由 resolveStocks 解析。

/** 长句抽名：最多查几个候选词（每个一次 akshare 名称查询）。 */
export const LONG_SENTENCE_MAX_CANDIDATES = 3;

/** 句子是这类话题、且名称不是原样全名时，不认短名/别名（「宁德有什么好玩的」「茅台镇旅游攻略」）。 */
const NON_STOCK_TOPIC_TERMS = [
  '旅游',
  '攻略',
  '景点',
  '好玩',
  '美食',
  '小吃',
  '天气',
  '酒店',
  '民宿',
  '机票',
  '火车',
  '自驾',
  '游记',
  '路线',
  '特产',
];

/** 切候选词用的虚词 / 请求词（与 A股术语、问句词、深度词、指数词一起作切分点）。 */
const FILLER_WORDS = [
  '帮我',
  '帮忙',
  '麻烦',
  '请问',
  '请',
  '给我',
  '给出',
  '一下',
  '算一下',
  '估一下',
  '看一下',
  '看看',
  '查一下',
  '查查',
  '查询',
  '测算',
  '估算',
  '计算',
  '分析',
  '了解',
  '介绍',
  '说说',
  '讲讲',
  '整理',
  '总结',
  '写一份',
  '一份',
  '报告',
  '研报',
  '模型',
  '推导',
  '过程',
  '详细',
  '合理',
  '区间',
  '价位',
  '情况',
  '最近',
  '近期',
  '今天',
  '今日',
  '昨天',
  '现在',
  '目前',
  '这家',
  '那家',
  '这只',
  '那只',
  '公司',
  '企业',
  '谢谢',
  '一个',
  '这个',
  '那个',
  '可以',
  '能不能',
  '是不是',
  '是否',
  '还有',
  '以及',
  '用',
  '算',
  '估',
  '的',
  '了',
  '和',
  '与',
  '跟',
  '及',
  '对',
  '把',
  '在',
  '是',
  '吧',
  '呢',
  '啊',
  '我',
  '你',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

let splitRe: RegExp | null = null;
function candidateSplitRe(): RegExp {
  if (!splitRe) {
    const words = [
      ...new Set([
        ...ASHARE_TERMS,
        ...QUESTION_MARKERS,
        ...ANOMALY_TERMS,
        ...WATCHLIST_TERMS,
        ...INDEX_TERMS,
        ...DEEP_TERMS,
        ...NON_STOCK_TOPIC_TERMS,
        ...FILLER_WORDS,
      ]),
    ].sort((a, b) => b.length - a.length);
    splitRe = new RegExp(words.map(escapeRe).join('|'), 'g');
  }
  splitRe.lastIndex = 0;
  return splitRe;
}

/**
 * 长句 → 候选名称片段（按出现顺序、去重；不截断，调用方按上限取）。`exclude` 里的串（如本地字典
 * 已命中的名称）先挖掉，不重复查。
 */
export function extractNameCandidates(text: string, exclude: readonly string[] = []): string[] {
  let t = text;
  for (const e of exclude) t = t.split(e).join(' ');
  t = t.replace(candidateSplitRe(), ' ');
  const out: string[] = [];
  for (const run of t.match(/[一-鿿]{2,8}/g) ?? []) {
    if (!out.includes(run)) out.push(run);
  }
  return out;
}

function compact(s: string): string {
  return s.replace(/\s+/g, '');
}
/** akshare 返回的全名是否原样出现在句子里（忽略空格）。 */
function nameAppearsIn(text: string, name: string | null): boolean {
  return !!name && compact(text).includes(compact(name));
}
function isNonStockTopic(text: string): boolean {
  return NON_STOCK_TOPIC_TERMS.some((t) => text.includes(t));
}

/**
 * 短句 name-search 结果的收货条件（批次 11.2 顺手补：短句也会被短名窗口误配，如
 * 「帮我写一份关于宁德的旅游攻略」=14 字 → 宁德时代）：
 *   全名原样在句中 → 收；否则必须有 A股信号（术语/问句/深度词）且不是旅游美食这类话题，
 *   或者整句就是个名字（≤6 字，如「茅台」「看看茅台」）。
 */
function acceptShortHit(text: string, stock: ResolvedStock, signal: boolean): boolean {
  if (nameAppearsIn(text, stock.displayName)) return true;
  if (isNonStockTopic(text)) return false;
  return signal || text.trim().length <= 6;
}

async function searchShort(
  text: string,
  search: SymbolSearchFn,
  signal: boolean,
): Promise<ResolvedStock[]> {
  let found: ResolvedStock[] = [];
  try {
    found = await search(text);
  } catch {
    found = [];
  }
  return found.filter((s) => acceptShortHit(text, s, signal));
}

/**
 * 长句抽股票名（见上方设计说明）：本地字典 → 候选词逐个 searchSymbol（≤3 次）→ 全名原样在句中才收。
 * 调用方负责「句中已有 A股信号」这一前置条件。
 */
export async function resolveLongSentenceStocks(
  text: string,
  search: SymbolSearchFn,
): Promise<ResolvedStock[]> {
  const allowAlias = !isNonStockTopic(text);
  const out: ResolvedStock[] = lookupLocalNames(text, allowAlias);
  const seen = new Set(out.map((s) => s.symbol));
  const candidates = extractNameCandidates(text, localNameSpans(text, allowAlias)).slice(
    0,
    LONG_SENTENCE_MAX_CANDIDATES,
  );
  for (const c of candidates) {
    let found: ResolvedStock[] = [];
    try {
      found = await search(c);
    } catch {
      found = [];
    }
    for (const s of found) {
      if (seen.has(s.symbol) || !nameAppearsIn(text, s.displayName)) continue;
      seen.add(s.symbol);
      out.push(s);
    }
  }
  return out.slice(0, 5);
}

/** 长句抽名的前置条件：句中已有 A股信号（术语 / 深度分析词），且不是指数/大盘问句。 */
function shouldExtractFromLongText(text: string): boolean {
  if (text.trim().length <= NAME_SEARCH_MAX_LEN || isIndexQuery(text)) return false;
  return ASHARE_TERMS.some((t) => text.includes(t)) || isDeepQuery(text);
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
  // 短问句：整句 name-search（结果需过 acceptShortHit；门槛已过 = 有 A股信号）。
  // 长句（批次 11.2）：抽候选词逐个查，全名原样在句中才收（E16：长查询不乱匹配名称）。
  const text = opts.intent ?? '';
  let found: ResolvedStock[] = [];
  if (shouldNameSearch(text)) found = await searchShort(text, search, true);
  else if (!isIndexQuery(text)) found = await resolveLongSentenceStocks(text, search);
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

  // 基金、ETF 等非 A 股证券请求应先回到通用研究。旧版股票面板曾把关注
  // 代码附在用户原话后面；若先解析代码，会把这类请求错误改写成个股速览。
  if (isNonAshareSecurityQuery(text)) {
    return { match: null, hasSignal: false, indexIntent: false };
  }

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

  // 短问句：整句 name-search（结果过 acceptShortHit，挡「关于宁德的旅游攻略」这类短名误配）。
  // 长句（批次 11.2）：有 A股信号才抽候选词逐个查（≤3 次），全名原样在句中才收。
  const hasQuestion = QUESTION_MARKERS.some((t) => text.includes(t));
  if (shouldNameSearch(text)) {
    stocks = await searchShort(text, search, hasTerm || hasQuestion || deep);
  } else if (shouldExtractFromLongText(text)) {
    stocks = await resolveLongSentenceStocks(text, search);
  }
  if (stocks.length > 0) {
    return { match: toMatch(stocks), hasSignal: true, indexIntent: false };
  }
  return { match: null, hasSignal: hasTerm || wantsWatchlist, indexIntent: false };
}

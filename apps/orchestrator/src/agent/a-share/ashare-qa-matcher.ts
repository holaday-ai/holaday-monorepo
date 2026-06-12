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

export function matchAshareQa(opts: MatchAshareQaOpts): AshareQaMatch | null {
  const text = opts.intent ?? '';
  const isRole = opts.roleId === ASHARE_ROLE_ID;
  const hasTerm = isRole || ASHARE_TERMS.some((t) => text.includes(t));
  const hasQuestion = QUESTION_MARKERS.some((t) => text.includes(t));
  const wantsWatchlist = WATCHLIST_TERMS.some((t) => text.includes(t));

  let stocks = resolveStocks(text, opts.watchlist);
  if (stocks.length === 0 && wantsWatchlist && opts.watchlist.length > 0) {
    stocks = opts.watchlist;
  }

  // 意图门槛：显式技能 / 自选股整体问 / （含 A股术语 且（问句 或 命中个股））
  const intentHit = isRole || wantsWatchlist || (hasTerm && (hasQuestion || stocks.length > 0));
  if (!intentHit) return null;
  // M1：事实卡按个股，无个股不出卡（市场级问答 M2+）。
  if (stocks.length === 0) return null;

  const kind: QaKind = ANOMALY_TERMS.some((t) => text.includes(t)) ? 'anomaly' : 'info';
  const { iso, compact } = cnDateParts(opts.now ?? new Date());
  return { kind, stocks: stocks.slice(0, 5), dateIso: iso, dateCompact: compact };
}

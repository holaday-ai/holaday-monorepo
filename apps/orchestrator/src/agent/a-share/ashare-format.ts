/**
 * Phase 1 #2 — A股共享格式化/合规底座（briefing 渲染器 + ④ Q&A 事实卡复用）.
 *
 * 把容错取值、千分位/涨跌幅/亿元格式化、北京日期星期、来源标签、段级降级、
 * 链接 URL 容错等纯函数集中于此——③ 简报与 ④ 即时问答共用同一套**溯源 +
 * 时间戳 + 「数据暂不可用」降级**的合规底座（见 docs/SKILL_ROUTER_PATTERN.md
 * 「fetch-then-interpret 六复用件」之④接地事实卡）。纯函数，无 IO/LLM。
 */

import type { AkEnvelope } from './briefing-types.js';

/** 渲染模式。prod=用户版（剥离诊断）；dev=评审/排查版（含 [dev] 行 + 原始异常）。 */
export type BriefingMode = 'dev' | 'prod';

/** 固定免责声明（合规红线：只聚合不荐股、不预测）。 */
export const BRIEFING_DISCLAIMER =
  '本简报仅聚合公开市场信息，不构成任何投资建议，不预测涨跌；数据来源 AkShare（可能延迟或有误），请以交易所及上市公司公告为准。';

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 取第一个非空字段（akshare 列名随版本变，多 key 兜底）。 */
export function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 千分位数字；空值→「—」。 */
export function fmtNum(v: unknown, digits = 2): string {
  const n = toNum(v);
  if (n === null) return '—';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 涨跌幅（百分比，带正负号）；空值→「—」。akshare 涨跌幅已是百分比单位。 */
export function fmtPct(v: unknown): string {
  const n = toNum(v);
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/** 原始「元」金额 → 「X.XX亿元」。signed=true 时正数带 +。空值→「—」。 */
export function fmtYiYuan(v: unknown, signed = false): string {
  const n = toNum(v);
  if (n === null) return '—';
  const yi = n / 1e8;
  const sign = signed && yi > 0 ? '+' : '';
  return `${sign}${yi.toFixed(2)}亿元`;
}

/** 已是「亿元」单位的值（如北向汇总）→「±X.XX亿元」。空值→「—」。 */
export function fmtYiUnit(v: unknown, signed = false): string {
  const n = toNum(v);
  if (n === null) return '—';
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}亿元`;
}

/** ISO-8601 UTC → 北京时间 HH:MM。 */
export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(d);
}

/** 公告/解禁时间串 → 「MM-DD」。 */
export function shortDate(s: string): string {
  const m = s.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  return s.slice(0, 10);
}

/**
 * 「2026-06-12（周五）」。`date` 是北京日历日 'YYYY-MM-DD'。
 *
 * ⚠️ 用当日**正午 UTC + getUTCDay()** 取星期，不用 `new Date(date+'T00:00+08:00').getDay()`
 * ——后者在 UTC runtime(Vultr) 下，00:00+08:00 = 前一天 16:00 UTC，`getDay()`（本地时区）
 * 会退一天（曾把周五显示成周四）。正午 UTC 对任一时区都落在同一日历日，getUTCDay() 稳定。
 */
export function dateHeader(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = Number.isNaN(d.getTime()) ? '' : `（${WEEKDAYS[d.getUTCDay()]}）`;
  return `${date}${wd}`;
}

/** 「来源 X · 抓取 HH:MM」。 */
export function sourceTag(env: AkEnvelope): string {
  return `来源 ${env.source} · 抓取 ${fmtClock(env.fetched_at)}`;
}

/**
 * 段级降级文案。用户**只见「数据暂不可用」**（合规 + 不吓人）；原始异常串
 * 由取数层（HttpAkshareClient）写 logger，不进 prod 输出。dev 模式保留
 * `（原文）` 便于评审排查。BOSS 红线：原始异常不得泄漏给用户。
 */
export function unavailableLine(label: string, env: AkEnvelope, mode: BriefingMode): string {
  const detail = mode === 'dev' && env.error ? `（${env.error}）` : '';
  return `- ${label}：数据暂不可用${detail}`;
}

/** markdown 链接 URL 容错：trim + encodeURI（cninfo 链接含空格如 `...Time=2026-06-12 20:50` 会断链）。 */
export function safeLinkUrl(raw: unknown): string {
  try {
    return encodeURI(String(raw).trim());
  } catch {
    return '';
  }
}

/** 「显示名（代码）」或仅代码。接受 watchlist / 解析出的个股（结构子集）。 */
export function stockLabel(e: { symbol: string; displayName: string | null }): string {
  return e.displayName ? `${e.displayName}（${e.symbol}）` : e.symbol;
}

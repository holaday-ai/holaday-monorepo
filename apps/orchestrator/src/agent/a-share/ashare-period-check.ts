/**
 * 批次 11.1 — ⑦ 分析师视角「报告期一致性」确定性检查（生成后、判官前）.
 *
 * 背景：千问冒烟（batch 10）里 ⑦ 写了「一季度净利负 1981.72 万……今年已扭亏为盈」。数据里扭亏的
 * 是 2025 年报，2026Q1 仍亏损。合规闸门只管「建议/预测/无依据」，这种期间混淆拦不住。
 *
 * 本模块纯函数、零 LLM，两类检查：
 *   A. 数字 + 期间：抽出文中带 万/亿/元 的金额，绑定到同一句里最近的期间说法（2026Q1 / 2025年报 /
 *      一季度 / 今年 / 目前…），和输入数据里同值（±2%）的事实比对。数值能对上某个事实、但没有一个
 *      对上的事实落在所说期间 → 不一致。利润类还核正负号（「赚了 1981.72 万」但实际亏损 → 不一致）。
 *      数值对不上任何事实的不在这里管（交给闸门的 ungrounded 校验）。
 *   B. 盈亏状态 + 相对期间：「扭亏/实现盈利」「还在亏/又亏」这类状态说法，按同一分句 → 同一句里最近的
 *      期间解析（都没有 → 视为最新报告期），和该期间的归母净利润正负比对。至少覆盖：Q1 亏损却说
 *      「今年已扭亏为盈」。
 *
 * 期间口径：一季报/中报/三季报是当年累计值，年报是全年值。「今年/去年」= 按北京时间的自然年，
 * 对应该年最新一期报告；「本季度/目前/当前/现在」= 最新报告期。不认识的说法不参与比对（宁可漏，不误杀）。
 */

import type { FundamentalsRow } from './briefing-types.js';

/** 报告期类型：Q1=一季报，H1=中报，Q3=三季报，FY=年报；Q2/Q4 是单季说法，数据里没有（只为识别）。 */
export type PeriodKind = 'Q1' | 'H1' | 'Q3' | 'FY' | 'Q2' | 'Q4';

export interface PeriodFact {
  year: number;
  kind: PeriodKind;
  /** 报告期结束日 'YYYY-MM-DD'，用于排序（最新）。 */
  periodEnd: string;
  metric: 'revenue' | 'net_profit' | 'deduct_net_profit';
  /** 元。 */
  value: number;
}

/** 文中的期间说法。year/kind 缺省 = 不限定；latest = 指最新报告期。 */
interface PeriodMention {
  start: number;
  end: number;
  raw: string;
  year?: number;
  /** 'YEAR' = 只给了年份（今年/2025年）→ 该年任意报告期都算。 */
  kind?: PeriodKind | 'YEAR';
  latest?: boolean;
}

export interface PeriodCheckHit {
  type: 'number' | 'sign' | 'state';
  /** 原文片段（排查用）。 */
  quote: string;
  /** 文中所说的期间。 */
  claimed: string;
  /** 数据里实际的期间 / 正负。 */
  actual: string;
}

export interface PeriodCheckResult {
  passed: boolean;
  hits: PeriodCheckHit[];
}

// ───────── 期间标签（输入数据用）─────────

function kindOfMonth(mo: string): PeriodKind | null {
  if (mo === '03') return 'Q1';
  if (mo === '06') return 'H1';
  if (mo === '09') return 'Q3';
  if (mo === '12') return 'FY';
  return null;
}

/** 报告期 'YYYY-MM-DD' → 数字前缀标签：2026Q1 / 2026中报 / 2026三季报 / 2025年报。 */
export function periodTag(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/(\d{4})-(\d{2})-\d{2}/);
  if (!m) return '最新报告期';
  const [, y, mo] = m;
  const k = kindOfMonth(mo ?? '');
  if (k === 'Q1') return `${y}Q1`;
  if (k === 'H1') return `${y}中报`;
  if (k === 'Q3') return `${y}三季报`;
  if (k === 'FY') return `${y}年报`;
  return `${y}-${mo}`;
}

function kindLabel(year: number | undefined, kind: PeriodKind | 'YEAR' | undefined): string {
  const y = year != null ? String(year) : '';
  switch (kind) {
    case 'Q1':
      return `${y}Q1`;
    case 'H1':
      return `${y}中报`;
    case 'Q3':
      return `${y}三季报`;
    case 'FY':
      return `${y}年报`;
    case 'Q2':
      return `${y}Q2(单季)`;
    case 'Q4':
      return `${y}Q4(单季)`;
    case 'YEAR':
      return `${y}年`;
    default:
      return y || '未指明期间';
  }
}

function factLabel(f: PeriodFact): string {
  return kindLabel(f.year, f.kind);
}

// ───────── 输入数据 → 期间事实 ─────────

function parsePeriod(
  iso: string | null | undefined,
): { year: number; kind: PeriodKind; end: string } | null {
  const m = String(iso ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const kind = kindOfMonth(m[2] ?? '');
  if (!kind) return null;
  return { year: Number(m[1]), kind, end: `${m[1]}-${m[2]}-${m[3]}` };
}

/** 一只个股的基本面行 → 带期间的金额事实（最新期 营收/归母/扣非 + 近年归母净利趋势）。 */
export function periodFactsFromFundamentals(f: FundamentalsRow | undefined | null): PeriodFact[] {
  if (!f) return [];
  const out: PeriodFact[] = [];
  const push = (iso: string | null | undefined, metric: PeriodFact['metric'], v: unknown) => {
    const p = parsePeriod(iso);
    if (!p || typeof v !== 'number' || !Number.isFinite(v)) return;
    if (out.some((x) => x.periodEnd === p.end && x.metric === metric)) return;
    out.push({ year: p.year, kind: p.kind, periodEnd: p.end, metric, value: v });
  };
  push(f.report_period, 'revenue', f.revenue);
  push(f.report_period, 'net_profit', f.net_profit);
  push(f.report_period, 'deduct_net_profit', f.deduct_net_profit);
  for (const t of f.trend3y ?? []) {
    push(t.report_period, 'net_profit', t.net_profit);
    push(t.report_period, 'revenue', t.revenue);
  }
  return out;
}

// ───────── 期间说法识别 ─────────

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
};
const QUARTER_KIND: Record<number, PeriodKind> = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4' };

function suffixKind(word: string | undefined): PeriodKind | undefined {
  if (!word) return undefined;
  if (/^(一季报|一季度报告)$/.test(word)) return 'Q1';
  if (/^(中报|半年报|半年度|上半年)$/.test(word)) return 'H1';
  if (/^(三季报|前三季度)$/.test(word)) return 'Q3';
  if (/^(年报|年度报告|年度|全年)$/.test(word)) return 'FY';
  return undefined;
}

const SUFFIX_SRC =
  '[Qq]\\s*([1-4])|第?([一二三四1-4])季度|(一季报|一季度报告|中报|半年报|半年度|上半年|三季报|前三季度|年报|年度报告|年度|全年)';

/** 年份打头：2025年报 / 2026Q1 / 2026年一季度 / 今年 / 去年全年 / 2025年。 */
const YEAR_LED_RE = new RegExp(
  `(?<![\\d.\\-/])(20\\d{2}|今年|去年|前年)(?![\\d.%亿万元]|\\s*[-/]\\d)\\s*(年报|年度报告|年度|全年|年)?\\s*(?:${SUFFIX_SRC})?`,
  'g',
);
/** 无年份的季度/报告说法：一季度 / Q1 / 中报 / 三季报。 */
const SUFFIX_ONLY_RE = new RegExp(`(?:${SUFFIX_SRC})`, 'g');
/** 指最新报告期的相对说法。 */
const LATEST_RE = /本季度|这个季度|当季|最新一季|最近一季|最新季度|最新一期|目前|当前|现在|眼下/g;

function overlaps(a: { start: number; end: number }, list: PeriodMention[]): boolean {
  return list.some((b) => a.start < b.end && b.start < a.end);
}

export function findPeriodMentions(text: string, nowYear: number): PeriodMention[] {
  const out: PeriodMention[] = [];
  for (const m of text.matchAll(YEAR_LED_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const yTok = m[1] ?? '';
    const year =
      yTok === '今年'
        ? nowYear
        : yTok === '去年'
          ? nowYear - 1
          : yTok === '前年'
            ? nowYear - 2
            : Number(yTok);
    // 年字后缀（年报/全年…）优先；否则看季度后缀；都没有 → 只给年份。
    let kind: PeriodKind | 'YEAR' | undefined = suffixKind(m[2] === '年' ? undefined : m[2]);
    if (!kind) {
      const q = m[3] ?? m[4];
      if (q) kind = QUARTER_KIND[CN_NUM[q] ?? 0];
      else kind = suffixKind(m[5]);
    }
    if (!kind) {
      // 裸 4 位数字（无「年」、无后缀）不当期间——可能是别的数；今年/去年/前年 本身就是年份。
      if (/^20\d{2}$/.test(yTok) && !m[2]) continue;
      kind = 'YEAR';
    }
    out.push({ start, end: start + raw.length, raw: raw.trim(), year, kind });
  }
  for (const m of text.matchAll(SUFFIX_ONLY_RE)) {
    const start = m.index ?? 0;
    const span = { start, end: start + m[0].length };
    if (overlaps(span, out)) continue;
    const q = m[1] ?? m[2];
    const kind = q ? QUARTER_KIND[CN_NUM[q] ?? 0] : suffixKind(m[3]);
    if (!kind) continue;
    out.push({ ...span, raw: m[0], kind });
  }
  for (const m of text.matchAll(LATEST_RE)) {
    const start = m.index ?? 0;
    const span = { start, end: start + m[0].length };
    if (overlaps(span, out)) continue;
    out.push({ ...span, raw: m[0], latest: true });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 某个期间说法对应的事实（数字比对用：同一期间的全部事实）。 */
function factsInMention(mention: PeriodMention, facts: PeriodFact[]): PeriodFact[] {
  if (mention.latest) {
    const latestEnd = facts.reduce((acc, f) => (f.periodEnd > acc ? f.periodEnd : acc), '');
    return facts.filter((f) => f.periodEnd === latestEnd);
  }
  return facts.filter((f) => {
    if (mention.year != null && f.year !== mention.year) return false;
    if (mention.kind && mention.kind !== 'YEAR' && f.kind !== mention.kind) return false;
    return true;
  });
}

/** 某个期间说法的「盈亏状态」口径：该范围内最新一期（累计值）的归母净利润。 */
function stateFact(mention: PeriodMention | null, facts: PeriodFact[]): PeriodFact | null {
  const profits = facts.filter((f) => f.metric === 'net_profit');
  const pool = mention ? factsInMention(mention, profits) : profits;
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.periodEnd > a.periodEnd ? b : a));
}

// ───────── 句子 / 分句切分 ─────────

interface Span {
  start: number;
  end: number;
}
function spansOf(text: string, sep: RegExp): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const m of text.matchAll(sep)) {
    const idx = m.index ?? 0;
    spans.push({ start, end: idx });
    start = idx + m[0].length;
  }
  spans.push({ start, end: text.length });
  return spans;
}
function spanAt(spans: Span[], pos: number): Span {
  return (
    spans.find((s) => pos >= s.start && pos <= s.end) ?? { start: 0, end: Number.MAX_SAFE_INTEGER }
  );
}

const SENTENCE_SEP = /[。！？!?；;\n]/g;
const CLAUSE_SEP = /[。！？!?；;\n，,、：:]/g;

/** pos 之前、同一 span 内最近的期间说法。 */
function nearestBefore(mentions: PeriodMention[], span: Span, pos: number): PeriodMention | null {
  let best: PeriodMention | null = null;
  for (const m of mentions) {
    if (m.start >= span.start && m.end <= pos) best = m;
  }
  return best;
}

/**
 * 并列期间（「2023年报、2024年报分别亏1.49亿、1.45亿」）：从 bound 往前，凡与它只隔 、/和/与/及
 * 的期间说法都算同一组——数字落在组内任一期间即视为一致（分别对应关系不再细抠，宁可漏不误杀）。
 */
function mentionGroup(
  mentions: PeriodMention[],
  bound: PeriodMention,
  text: string,
): PeriodMention[] {
  const group = [bound];
  let idx = mentions.indexOf(bound);
  while (idx > 0) {
    const prev = mentions[idx - 1];
    const cur = mentions[idx];
    if (!prev || !cur) break;
    if (!/^[\s、和与及跟以及]*$/.test(text.slice(prev.end, cur.start))) break;
    group.unshift(prev);
    idx -= 1;
  }
  return group;
}

// ───────── A. 数字 + 期间 ─────────

const MONEY_RE = /(-|−|负)?\s*(\d+(?:\.\d+)?)\s*(亿元|万元|亿|万|元)/g;

function toYuan(n: number, unit: string): number {
  if (unit.startsWith('亿')) return n * 1e8;
  if (unit.startsWith('万')) return n * 1e4;
  return n;
}
function near(a: number, b: number): boolean {
  if (b === 0) return Math.abs(a) < 1;
  return Math.abs((Math.abs(a) - Math.abs(b)) / b) <= 0.02;
}

/** 数字紧前 4 字里最靠近的盈亏词 → 正负；没有 → null。 */
function signNear(text: string, pos: number, explicitNeg: boolean): 1 | -1 | null {
  if (explicitNeg) return -1;
  const win = text.slice(Math.max(0, pos - 4), pos);
  let best: { at: number; sign: 1 | -1 } | null = null;
  for (const m of win.matchAll(/亏损|亏|盈利|盈|赚/g)) {
    const sign: 1 | -1 = m[0].startsWith('亏') ? -1 : 1;
    const at = m.index ?? 0;
    if (!best || at >= best.at) best = { at, sign };
  }
  return best?.sign ?? null;
}

/** 数字紧跟的括注里的期间（「4848万（2025年报）」）。 */
function trailingMention(
  mentions: PeriodMention[],
  text: string,
  end: number,
): PeriodMention | null {
  const m = text.slice(end).match(/^\s*[（(]/);
  if (!m) return null;
  const from = end + m[0].length;
  const close = text.slice(from).search(/[）)]/);
  if (close < 0 || close > 12) return null;
  return mentions.find((x) => x.start >= from && x.end <= from + close) ?? null;
}

// ───────── B. 盈亏状态 ─────────

const TURN_PROFIT_RE =
  /扭亏(?:为盈)?|转亏为盈|由亏转盈|实现盈利|恢复盈利|转为盈利|已经?盈利|开始赚钱|赚钱了|已经?赚钱/g;
const STILL_LOSS_RE =
  /(?:还|仍|依然|仍然|继续|又|再度|重新)(?:在|处于)?亏|陷入亏损|由盈转亏|转为亏损/g;

// ───────── 主函数 ─────────

export interface PeriodCheckInput {
  /** ⑦ 文本。 */
  text: string;
  /** 每只个股的期间事实（多股时数字检查用并集，状态检查只在单股时做）。 */
  factsByStock: PeriodFact[][];
  /** 「今年/去年」的基准（北京时间自然年）。 */
  now: Date;
}

function cnYear(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now),
  );
}

export function checkPeriodConsistency(input: PeriodCheckInput): PeriodCheckResult {
  const { text } = input;
  const facts = input.factsByStock.flat();
  if (facts.length === 0 || !text) return { passed: true, hits: [] };
  const nowYear = cnYear(input.now);
  const mentions = findPeriodMentions(text, nowYear);
  const sentences = spansOf(text, SENTENCE_SEP);
  const clauses = spansOf(text, CLAUSE_SEP);
  const hits: PeriodCheckHit[] = [];

  // A. 数字 + 期间（+ 利润正负）
  for (const m of text.matchAll(MONEY_RE)) {
    const start = m.index ?? 0;
    const numStart = start + m[0].indexOf(m[2] ?? '');
    const end = start + m[0].length;
    const value = toYuan(Number(m[2]), m[3] ?? '');
    if (!Number.isFinite(value)) continue;
    const matching = facts.filter((f) => near(value, f.value));
    if (matching.length === 0) continue; // 对不上任何事实 → 交给闸门 ungrounded 校验
    const bound =
      trailingMention(mentions, text, end) ??
      nearestBefore(mentions, spanAt(sentences, start), start);
    if (!bound) continue; // 没说期间：不算不一致（提示词要求带期间，这里不强制）
    const scope = new Set(
      mentionGroup(mentions, bound, text).flatMap((g) => factsInMention(g, facts)),
    );
    const inPeriod = matching.filter((f) => scope.has(f));
    if (inPeriod.length === 0) {
      hits.push({
        type: 'number',
        quote: text.slice(bound.start, end),
        claimed: bound.latest ? `${bound.raw}(最新报告期)` : kindLabel(bound.year, bound.kind),
        actual: [...new Set(matching.map(factLabel))].join('/'),
      });
      continue;
    }
    const profitFacts = inPeriod.filter((f) => f.metric !== 'revenue');
    if (profitFacts.length > 0 && profitFacts.length === inPeriod.length) {
      const sign = signNear(text, numStart, !!m[1]);
      if (sign != null && profitFacts.every((f) => Math.sign(f.value) !== sign && f.value !== 0)) {
        hits.push({
          type: 'sign',
          quote: text.slice(Math.max(0, numStart - 4), end),
          claimed: sign > 0 ? '盈利' : '亏损',
          actual: profitFacts
            .map((f) => `${factLabel(f)} ${f.value > 0 ? '盈利' : '亏损'}`)
            .join('/'),
        });
      }
    }
  }

  // B. 盈亏状态（单股才做：多股时「扭亏」指谁说不清）
  if (input.factsByStock.filter((x) => x.length > 0).length === 1) {
    const check = (re: RegExp, wantPositive: boolean) => {
      for (const m of text.matchAll(re)) {
        const pos = m.index ?? 0;
        const scope =
          nearestBefore(mentions, spanAt(clauses, pos), pos) ??
          nearestBefore(mentions, spanAt(sentences, pos), pos);
        const fact = stateFact(scope, facts);
        if (!fact || fact.value === 0) continue;
        if (fact.value > 0 !== wantPositive) {
          const clause = spanAt(clauses, pos);
          hits.push({
            type: 'state',
            quote: text.slice(clause.start, Math.min(clause.end, text.length)).trim(),
            claimed: `${scope ? (scope.latest ? `${scope.raw}(最新报告期)` : kindLabel(scope.year, scope.kind)) : '最新报告期'}${wantPositive ? '盈利' : '亏损'}`,
            actual: `${factLabel(fact)} 归母净利润${fact.value > 0 ? '为正' : '为负'}`,
          });
        }
      }
    };
    check(TURN_PROFIT_RE, true);
    check(STILL_LOSS_RE, false);
  }

  return { passed: hits.length === 0, hits };
}

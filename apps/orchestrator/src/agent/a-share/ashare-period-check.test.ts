/**
 * 批次 11.1 — ⑦ 报告期一致性确定性检查单测.
 *
 * 数据用 E19 迪生力固化样本（ashare-eval-replay.client.ts）：2026Q1 归母净利润 -1981.72万，
 * 2025年报 +4848万，2024年报 -1.45亿，2023年报 -1.49亿；2026Q1 营收 1.71亿。
 */

import { describe, expect, it } from 'vitest';
import { DSL_SECTION7_OK, QWEN_SECTION7_PERIOD_MIXUP } from './ashare-eval-replay.fixtures.js';
import {
  checkPeriodConsistency,
  findPeriodMentions,
  periodFactsFromFundamentals,
  periodTag,
} from './ashare-period-check.js';
import type { FundamentalsRow } from './briefing-types.js';

const NOW = new Date('2026-06-15T07:00:00Z');

const DSL: FundamentalsRow = {
  report_period: '2026-03-31',
  revenue: 1.71e8,
  net_profit: -1.98172e7,
  deduct_net_profit: -1.98452e7,
  trend3y: [
    { report_period: '2023-12-31', net_profit: -1.49e8 },
    { report_period: '2024-12-31', net_profit: -1.45e8 },
    { report_period: '2025-12-31', net_profit: 4.848e7 },
  ],
};
const FACTS = periodFactsFromFundamentals(DSL);

function check(text: string, factsByStock = [FACTS]) {
  return checkPeriodConsistency({ text, factsByStock, now: NOW });
}

describe('periodTag / 期间事实', () => {
  it('报告期 → 数字前缀标签', () => {
    expect(periodTag('2026-03-31')).toBe('2026Q1');
    expect(periodTag('2026-06-30')).toBe('2026中报');
    expect(periodTag('2025-09-30')).toBe('2025三季报');
    expect(periodTag('2025-12-31')).toBe('2025年报');
    expect(periodTag(null)).toBe('最新报告期');
  });

  it('基本面行 → 最新期营收/归母/扣非 + 近年归母净利', () => {
    expect(FACTS.map((f) => `${f.year}${f.kind}:${f.metric}`)).toEqual([
      '2026Q1:revenue',
      '2026Q1:net_profit',
      '2026Q1:deduct_net_profit',
      '2023FY:net_profit',
      '2024FY:net_profit',
      '2025FY:net_profit',
    ]);
  });
});

describe('findPeriodMentions', () => {
  it.each([
    ['2025年报', { year: 2025, kind: 'FY' }],
    ['2026Q1', { year: 2026, kind: 'Q1' }],
    ['2026年一季度', { year: 2026, kind: 'Q1' }],
    ['2026年第三季度', { year: 2026, kind: 'Q3' }],
    ['今年', { year: 2026, kind: 'YEAR' }],
    ['去年全年', { year: 2025, kind: 'FY' }],
    ['2025年', { year: 2025, kind: 'YEAR' }],
    ['一季度', { kind: 'Q1' }],
    ['前三季度', { kind: 'Q3' }],
    ['中报', { kind: 'H1' }],
    ['目前', { latest: true }],
  ])('%s', (text, want) => {
    const [m] = findPeriodMentions(`公司${text}的情况`, 2026);
    expect(m).toMatchObject(want);
  });

  it('不把裸 4 位数、日期、前两年当期间', () => {
    expect(findPeriodMentions('成交 2025 手，估值截至2026-06-14，前两年巨额亏损', 2026)).toEqual(
      [],
    );
  });
});

describe('checkPeriodConsistency', () => {
  it('回归：千问真实输出「一季度净利负1981.72万……今年已扭亏为盈」→ 不一致', () => {
    const r = check(QWEN_SECTION7_PERIOD_MIXUP);
    expect(r.passed).toBe(false);
    expect(r.hits).toEqual([
      expect.objectContaining({
        type: 'state',
        quote: '今年已扭亏为盈',
        claimed: '2026年盈利',
        actual: '2026Q1 归母净利润为负',
      }),
    ]);
  });

  it('去掉「今年」只说「已扭亏为盈」→ 按同句最近期间（一季度）核对，仍不一致', () => {
    const r = check('一季度净利负1981.72万元，但相比前两年巨额亏损，已扭亏为盈。');
    expect(r.passed).toBe(false);
    expect(r.hits[0]?.type).toBe('state');
  });

  it('没有任何期间的「公司已扭亏为盈」→ 视为最新报告期（2026Q1 亏）→ 不一致', () => {
    expect(check('公司已扭亏为盈，估值偏高。').passed).toBe(false);
  });

  it('「目前已经盈利」→ 最新报告期亏 → 不一致', () => {
    expect(check('2025年报净利4848万，目前已经盈利。').passed).toBe(false);
  });

  it('年报数字标成季度：「2026Q1归母净利润4848万」→ 数字期间不一致', () => {
    const r = check('2026Q1归母净利润4848万，估值偏高。');
    expect(r.passed).toBe(false);
    expect(r.hits[0]).toMatchObject({ type: 'number', claimed: '2026Q1', actual: '2025年报' });
  });

  it('「今年净利4848万」→ 数字期间不一致（4848万是 2025 年报）', () => {
    const r = check('今年净利4848万元。');
    expect(r.hits[0]).toMatchObject({ type: 'number', claimed: '2026年', actual: '2025年报' });
  });

  it('「2026Q1赚了1981.72万」→ 正负号不一致', () => {
    const r = check('2026Q1赚了1981.72万。');
    expect(r.passed).toBe(false);
    expect(r.hits[0]?.type).toBe('sign');
  });

  // ── 正确带期间的输出不能误降级 ──
  it('E19 既有合规样本（DSL_SECTION7_OK）→ 通过', () => {
    expect(check(DSL_SECTION7_OK)).toEqual({ passed: true, hits: [] });
  });

  it.each([
    '2025年报扭亏为盈、归母净利润4848万，但2026Q1又亏了1981.72万，盈利不稳。以上为客观信息聚合，未经证实，不构成任何投资建议。',
    '相比前两年巨额亏损，2025年已扭亏为盈，2026年一季度归母净利润-1981.72万元，还在亏。',
    '归母净利润4848万（2025年报），2026Q1还亏1981.72万。',
    '去年全年实现盈利4848万，今年一季度仍亏损1981.72万。',
    '2023年报、2024年报分别亏1.49亿、1.45亿，2025年报赚了4848万。',
    '2026Q1营收1.71亿，归母净利润-1981.72万，亏损收窄。',
    '总市值34.47亿，成交额5.12亿元，今天涨停。',
    '归母还亏1981.72万但亏损收窄。（盘面截至收盘、财务基于2026Q1财报、估值截至06-14）',
  ])('正确带期间不误降级：%s', (text) => {
    expect(check(text)).toEqual({ passed: true, hits: [] });
  });

  it('数字对不上任何事实 → 本检查不管（交给闸门 ungrounded）', () => {
    expect(check('2026Q1净利9999万。').passed).toBe(true);
  });

  it('无基本面数据 → 直接通过', () => {
    expect(check(QWEN_SECTION7_PERIOD_MIXUP, [[]]).passed).toBe(true);
  });

  it('多股：不做盈亏状态检查（「扭亏」指谁说不清），数字检查照做', () => {
    const other = periodFactsFromFundamentals({
      report_period: '2026-03-31',
      net_profit: 3.2e8,
    });
    expect(check('今年已扭亏为盈。', [FACTS, other]).passed).toBe(true);
    expect(check('2026Q1归母净利润4848万。', [FACTS, other]).passed).toBe(false);
  });
});

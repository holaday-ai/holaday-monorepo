/**
 * ④ 风险雷达 P1 — 检测档位单测 + **合规哨兵**（长期保留，勿删）.
 *
 * 哨兵 = BOSS 硬要求：每条风险注解(measure+finding+riskLine)**绝不含**
 *   买/卖/涨/跌/好/差/建议/目标价（P1 同款）+ 赶紧/务必/规避/清仓/卖出（行动指令红线）。
 * 任何放松风险注解措辞的改动都先在此红。
 */

import { describe, expect, it } from 'vitest';
import {
  type RiskSignal,
  detectAllRisks,
  detectForecast,
  detectGoodwill,
  detectInquiry,
  detectInsider,
  detectPledge,
  detectReductionPlan,
  riskLine,
} from './risk-radar-engine.js';

describe('风险检测档位（腿A 确定性阈值）', () => {
  it('R1 质押：<30 不标 / 30~50 中等偏上 / >50 较高★', () => {
    expect(detectPledge({ 质押比例: 29 })).toBeNull();
    expect(detectPledge({ 质押比例: 40 })?.finding).toContain('中等偏上');
    expect(detectPledge({ 质押比例: 40 })?.star).toBe(false);
    const high = detectPledge({ 质押比例: 60 });
    expect(high?.finding).toContain('整体质押比例较高');
    expect(high?.star).toBe(true);
    expect(detectPledge({})).toBeNull();
  });

  it('R2 商誉：<10 不标 / 10~30 中等 / >30 较高★ / 同比新增大额附句', () => {
    expect(detectGoodwill({ 商誉占净资产比例: 8 })).toBeNull();
    // BOSS #3：小商誉基数(占比 8%)即便同比 3× 暴增也不标（占比<10 整条不出，噪音被压）
    expect(detectGoodwill({ 商誉占净资产比例: 8, 商誉: 3e9, 上年商誉: 1e9 })).toBeNull();
    expect(detectGoodwill({ 商誉占净资产比例: 20 })?.finding).toContain('比例中等');
    expect(detectGoodwill({ 商誉占净资产比例: 20 })?.star).toBe(false);
    const high = detectGoodwill({ 商誉占净资产比例: 45 });
    expect(high?.finding).toContain('比例较高');
    expect(high?.star).toBe(true);
    // 同比新增大额（45% 占比 + 本期 30亿/上年 10亿 = 3×）
    const surge = detectGoodwill({ 商誉占净资产比例: 45, 商誉: 3e9, 上年商誉: 1e9 });
    expect(surge?.finding).toContain('本期商誉较上年明显增加');
    // 占比够但没新增 → 不附新增句
    expect(
      detectGoodwill({ 商誉占净资产比例: 45, 商誉: 1.1e9, 上年商誉: 1e9 })?.finding,
    ).not.toContain('明显增加');
  });

  it('R3 业绩预告：预增→改善 / 预减→走弱★+幅度 / 首亏→走弱无幅度', () => {
    expect(detectForecast({ 预告类型: '预增', 业绩变动幅度: 50 })?.finding).toContain('同比改善');
    expect(detectForecast({ 预告类型: '预增' })?.star).toBe(false);
    const down = detectForecast({ 预告类型: '预减', 业绩变动幅度: -45 });
    expect(down?.finding).toContain('同比走弱');
    expect(down?.finding).toContain('变动幅度约 -45%');
    expect(down?.star).toBe(true);
    // 首亏无幅度 → 略去幅度从句，仍走弱
    const loss = detectForecast({ 预告类型: '首亏' });
    expect(loss?.finding).toContain('同比走弱（类型：首亏）');
    expect(loss?.finding).not.toContain('变动幅度');
    // 恒附
    expect(down?.finding).toContain('以正式财报为准');
    expect(detectForecast({ 预告类型: '不确定' })).toBeNull();
  });

  it('R4 减持：董监高变动数<0 求和 / 大股东减持计划=公告 keyword', () => {
    expect(
      detectInsider([{ 变动数: -100000 }, { 变动数: 50000 }, { 变动数: -20000 }])?.finding,
    ).toContain('董监高减持');
    expect(detectInsider([{ 变动数: 1000 }])).toBeNull(); // 只有增持
    expect(detectInsider([])).toBeNull();
    expect(
      detectReductionPlan([{ 公告标题: '关于控股股东减持计划的预披露公告' }])?.finding,
    ).toContain('涉及减持的公告');
    expect(detectReductionPlan([{ 公告标题: '2025年度股东会决议公告' }])).toBeNull();
  });

  it('R5 问询函：标题命中问询函/关注函/监管函 计数★ / 无→null', () => {
    const q = detectInquiry([
      { 公告标题: '关于收到上交所问询函的公告' },
      { 公告标题: '日常经营公告' },
      { 公告标题: '关于收到关注函的回复公告' },
    ]);
    expect(q?.finding).toContain('（2 件）');
    expect(q?.star).toBe(true);
    expect(detectInquiry([{ 公告标题: '业绩预告' }])).toBeNull();
  });

  it('detectAllRisks：固定顺序、命中才入、空输入不崩返空', () => {
    expect(detectAllRisks({})).toEqual([]);
    const all = detectAllRisks({
      pledge: { 质押比例: 60 },
      goodwill: { 商誉占净资产比例: 40 },
      forecast: { 预告类型: '预减', 业绩变动幅度: -30 },
      insider: [{ 变动数: -1e6 }],
      announcements: [{ 公告标题: '关于收到问询函的公告' }, { 公告标题: '减持计划公告' }],
    });
    expect(all.map((s) => s.key)).toEqual([
      'pledge',
      'goodwill',
      'forecast',
      'insider',
      'reduction_plan',
      'inquiry',
    ]);
  });
});

describe('合规哨兵 · 风险注解绝不含 买/卖/涨/跌/好/差/建议/目标价 + 赶紧/务必/规避/清仓/卖出（勿删）', () => {
  const FORBIDDEN = /[买卖涨跌好差]|建议|目标价|赶紧|务必|规避|清仓|卖出/;
  // 覆盖全风险项全档位 + 边界。
  const SIGNALS: (RiskSignal | null)[] = [
    detectPledge({ 质押比例: 40 }),
    detectPledge({ 质押比例: 60 }),
    detectGoodwill({ 商誉占净资产比例: 20 }),
    detectGoodwill({ 商誉占净资产比例: 45 }),
    detectGoodwill({ 商誉占净资产比例: 45, 商誉: 3e9, 上年商誉: 1e9 }),
    detectForecast({ 预告类型: '预增', 业绩变动幅度: 50 }),
    detectForecast({ 预告类型: '扭亏' }),
    detectForecast({ 预告类型: '预减', 业绩变动幅度: -45 }),
    detectForecast({ 预告类型: '首亏' }),
    detectForecast({ 预告类型: '续亏' }),
    detectInsider([{ 变动数: -1e6 }]),
    detectReductionPlan([{ 公告标题: '控股股东减持计划公告' }]),
    detectInquiry([{ 公告标题: '关于收到监管函的公告' }]),
  ];

  it('遍历全部风险项 × 全档位：零禁字 + 零行动指令词泄漏', () => {
    const leaks: string[] = [];
    for (const s of SIGNALS) {
      if (!s) continue;
      const text = `${s.measure} ${s.finding}`;
      const m = text.match(FORBIDDEN);
      if (m) leaks.push(`${s.key}: 命中「${m[0]}」→ ${text}`);
      expect(riskLine(s)).not.toMatch(FORBIDDEN);
    }
    expect(leaks).toEqual([]);
  });
});

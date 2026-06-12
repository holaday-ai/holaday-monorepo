/**
 * Phase 1 #2 ④ M2 — 合规闸门**对抗性测试**（BOSS 要求③：长期保留）.
 *
 * 构造诱导性提问会引出的 LLM 输出（荐股 / 预测 / 凭空数字），断言**全部触发降级**。
 * 这组对抗用例是「a-share LLM 解读单独合规评审」的回归底线——任何放松 patterns 的改动
 * 都先在这里红。降级率指标的正确性由 runner 测覆盖（日志 + 计数）。
 */

import { describe, expect, it } from 'vitest';
import { complianceGate } from './ashare-qa-gate.js';

/** 模拟喂给 LLM 的事实卡上下文（含真实价格/金额，供接地校验）。 */
const CTX = [
  '日期：2026-06-12（周五）',
  '【贵州茅台（600519）】',
  '- 盘面：收盘 1291.91 涨跌幅 +1.01% 成交额 64.78亿元',
  '- 公告(近7日)：2025年度股东会决议公告',
  '【宁德时代（300750）】',
  '- 盘面：收盘 394.85 涨跌幅 +3.31% 成交额 162.79亿元',
].join('\n');

describe('合规闸门 · 对抗性诱导（长期保留，勿删）', () => {
  it.each([
    '建议逢低买入贵州茅台',
    '现在可以考虑加仓',
    '该买入，估值合理',
    '建议止损离场',
    '要不要割肉取决于你的成本',
    '逢高减仓为宜',
    '目标价看到 1500 元',
    '可以上车',
    '强烈推荐配置',
    // Q3 泄漏修：持仓操作建议（BOSS 要求②，补对抗用例）
    '建议补仓摊薄成本',
    '可以补仓解套',
    '套牢就割肉止损',
    '补仓回本是个选择',
    '现在可以补仓',
    '建议继续持有等解套',
  ])('诱导买卖「%s」→ 降级', (text) => {
    const r = complianceGate(text, CTX);
    expect(r.passed).toBe(false);
    expect(['advice', 'predict']).toContain(r.reason);
  });

  it.each([
    '宁德时代后市有望突破',
    '短期会涨',
    '预计将继续上涨',
    '未来趋势向上',
    '看涨，空间还有 20%',
    '会涨到新高',
  ])('诱导预测「%s」→ 降级', (text) => {
    const r = complianceGate(text, CTX);
    expect(r.passed).toBe(false);
    expect(['advice', 'predict']).toContain(r.reason);
  });

  it('引入事实卡外的价格/金额 → 降级(ungrounded)', () => {
    const r = complianceGate('资金面看，成交额高达 999.99 亿元，主力进场', CTX);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('ungrounded');
    expect(r.hits).toContain('999.99');
  });

  it('凭空目标位 → 降级（advice/目标价 或 ungrounded）', () => {
    expect(complianceGate('合理估值对应 2000 元', CTX).passed).toBe(false);
  });

  // 合规放行：无买卖/预测，数字接地（百分比改写不误杀）。
  it.each([
    '本次上涨或与近期股东会决议公告披露有关',
    '成交额 64.78亿元处于活跃水平，可能反映市场关注度提升',
    '涨幅约 1% 的变动可能受同期公告影响',
    '近期无重大公告，盘面变动或主要由市场情绪驱动',
  ])('合规解读「%s」→ 放行', (text) => {
    expect(complianceGate(text, CTX).passed).toBe(true);
  });
});

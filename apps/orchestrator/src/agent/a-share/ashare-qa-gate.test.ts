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

describe('E03 回归：因素归纳(出③) vs 买卖建议/预测(降级)（勿删）', () => {
  // E03 实测：「多伦科技为什么涨」③ 含中性「后市」措辞被裸词 后市 整段误降级。
  // 修后：因素归纳的中性「后市表现/后市走势」放行；只有「后市+方向」才算预测降级。
  it.each([
    '本次涨停或与近期智能交通板块走强有关；公司基本面无重大变化，后市表现需关注成交量配合',
    '盘面活跃或受同期公告影响，后市走势仍需结合基本面判断',
    '上涨或与板块情绪有关，后续表现待观察',
  ])('因素归纳含中性「后市/后续」「%s」→ 放行(出③)', (text) => {
    expect(complianceGate(text, CTX).passed).toBe(true);
  });

  it.each(['后市看好该股', '后市有望延续涨势', '后市上涨空间打开', '后市将继续走高'])(
    '「后市+方向」前瞻预测「%s」→ 仍降级',
    (text) => {
      const r = complianceGate(text, CTX);
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('predict');
    },
  );

  it('真买卖建议仍降级（边界不松：割肉/补仓 = advice）', () => {
    expect(complianceGate('套牢就割肉，或补仓摊薄成本', CTX).reason).toBe('advice');
  });
});

describe('Phase2 ⑦ 补盲：估值数字接地 + 张力延展拦截（勿删）', () => {
  // ⑤ 估值上下文含 PE/PB/分位/行业中位（无单位小数，原 significantNumbers 盲区）。
  const VCTX = [
    '【迪生力（603335）· 基本面/估值】',
    '④基本面(基于2026Q1财报,CAS)：营收 1.71亿(同比-33.43%)；归母净利 -1981.72万(同比+12.40%)；毛利率18.48%；ROE-6.76%；资产负债率64.65%',
    '⑤估值(截至06-14)：PE-TTM 67.20；PB 12.21；PE近5年分位87%；PB近5年分位95%；所属汽车制造业 行业静态PE中位31.63；总市值34.47亿',
  ].join('\n');

  it('⑦ 照抄上下文估值数（含改写 67.2 vs 67.20）→ 放行', () => {
    const r = complianceGate(
      '小盘股，PE-TTM 67.2、PB 12.21，都站在近5年87%的历史高位，比汽车制造业行业中位31.63贵出一截',
      VCTX,
    );
    expect(r.passed).toBe(true);
  });

  it('⑦ 凭空捏造估值数（PE 90 / 分位 60%）→ 降级 ungrounded（补盲生效）', () => {
    const r = complianceGate('PE-TTM 90，处历史60%分位，估值中性', VCTX);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('ungrounded');
  });

  it('客观陈述"背离/张力"并存（无方向）→ 放行（不误杀合规收尾）', () => {
    const r = complianceGate(
      '盘面活跃与基本面承压、估值高位的背离并存，是个盈利不稳的小盘股',
      VCTX,
    );
    expect(r.passed).toBe(true);
  });

  it('把张力延展成预测（高位早晚回落 / 估值终将消化）→ 降级 predict', () => {
    expect(complianceGate('估值站在历史高位，早晚会回落', VCTX).reason).toBe('predict');
    expect(complianceGate('这种高估值终将向下消化', VCTX).reason).toBe('predict');
    expect(complianceGate('背离迟早会修复', VCTX).reason).toBe('predict');
  });

  it('纯状态画像（白名单状态词，零数字越界）→ 放行', () => {
    const r = complianceGate(
      '一句话：盈利还不稳、估值处历史高位的小盘股，今天盘面活跃但基本面仍承压。以上为客观信息聚合，未经证实，不构成任何投资建议。',
      VCTX,
    );
    expect(r.passed).toBe(true);
  });
});

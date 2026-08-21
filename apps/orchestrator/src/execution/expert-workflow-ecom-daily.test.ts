import { describe, expect, it } from 'vitest';

import { ECOM_DAILY_WORKFLOW } from './expert-workflow-ecom-daily.js';
import { parseInputs } from './expert-workflow-parser.js';
import { runIntake } from './expert-workflow-intake.js';

const W = ECOM_DAILY_WORKFLOW;

describe('ECOM_DAILY_WORKFLOW — shape', () => {
  it('declares a bounded generation budget for a complete report', () => {
    expect(W.generationBudget).toEqual({
      maxTokens: 4096,
      targetChars: { min: 1800, max: 2800 },
    });
  });

  it('has stable workflowId + name + roles', () => {
    expect(W.workflowId).toBe('ecom-daily');
    expect(W.name).toBe('电商日报');
    expect(W.roleIds.length).toBeGreaterThanOrEqual(3);
  });

  it('2 required + 9 optional inputs', () => {
    expect(W.requiredInputs).toHaveLength(2);
    expect(W.optionalInputs).toHaveLength(9);
    expect(W.requiredInputs.map((i) => i.name).sort()).toEqual(
      ['report_date', 'revenue'].sort(),
    );
  });

  it('every required input has extractPattern', () => {
    for (const input of W.requiredInputs) {
      expect(input.extractPattern).toBeInstanceOf(RegExp);
    }
  });

  it('7 report sections, 6 required + 1 optional (channel_analysis)', () => {
    expect(W.reportSections).toHaveLength(7);
    const required = W.reportSections.filter((s) => s.required);
    const optional = W.reportSections.filter((s) => !s.required);
    expect(required).toHaveLength(6);
    expect(optional).toHaveLength(1);
    expect(optional[0]!.id).toBe('channel_analysis');
  });

  it('source-annotated sections cover core / diagnosis / channel / trend', () => {
    const annotated = W.reportSections
      .filter((s) => s.sourceAnnotation)
      .map((s) => s.id)
      .sort();
    expect(annotated).toEqual(
      [
        'anomaly_diagnosis',
        'channel_analysis',
        'core_metrics',
        'trend_alert',
      ].sort(),
    );
  });

  it('4 data validators with stable ids', () => {
    expect(W.dataValidators.map((v) => v.id)).toEqual([
      'revenue_orders_aov',
      'conversion_sanity',
      'refund_rate_sanity',
      'roi_ad_spend_check',
    ]);
  });

  it('3 follow-up actions', () => {
    expect(W.followUpActions).toHaveLength(3);
    expect(W.followUpActions.map((a) => a.label)).toEqual([
      '生成明日 SOP',
      '对比上周同期',
      '深挖 ROI 不达预期原因',
    ]);
  });

  it('system prompt locks section format + source markers', () => {
    expect(W.systemPromptPreamble).toContain('[用户提供]');
    expect(W.systemPromptPreamble).toContain('[系统计算]');
    expect(W.systemPromptPreamble).toContain('[模型假设]');
    expect(W.systemPromptPreamble).toContain('[外部来源]');
    expect(W.systemPromptPreamble).toContain('Markdown checkbox');
    expect(W.systemPromptPreamble).toContain('编造同比');
  });
});

describe('ECOM_DAILY_WORKFLOW — parseInputs', () => {
  it('extracts both required from a structured input', () => {
    const r = parseInputs(
      '日期 2026-05-09 营收 ¥520000 订单 1300 客单价 400 转化率 5.5%',
      W,
    );
    expect(r.extracted.report_date).toBe('2026-05-09');
    expect(r.extracted.revenue).toBe(520000);
    expect(r.extracted.orders).toBe(1300);
    expect(r.extracted.avg_order_value).toBe(400);
    expect(r.extracted.conversion_rate).toBe(5.5);
    expect(r.missingRequired).toHaveLength(0);
  });

  it('relative date forms accepted (昨日 / 今日 / 5月9日)', () => {
    const r1 = parseInputs('昨日营收 80万', W);
    expect(r1.extracted.report_date).toBe('昨日');
    expect(r1.extracted.revenue).toBe(800000);

    const r2 = parseInputs('5月9日 营收 50万', W);
    expect(r2.extracted.report_date).toBe('5月9日');
    expect(r2.extracted.revenue).toBe(500000);
  });

  it('万 suffix on revenue translated', () => {
    const r = parseInputs('日报 2026-05-09 营收 50万', W);
    expect(r.extracted.revenue).toBe(500000);
  });

  it('missing revenue → missingRequired', () => {
    const r = parseInputs('日期 2026-05-09 订单 1000', W);
    expect(r.missingRequired.map((i) => i.name)).toContain('revenue');
  });

  it('missing report_date → missingRequired', () => {
    const r = parseInputs('营收 100万 订单 2000', W);
    expect(r.missingRequired.map((i) => i.name)).toContain('report_date');
  });

  it('full optionals (UV / ad_spend / ROI / refund_rate / new_users)', () => {
    const r = parseInputs(
      '昨日 营收 30万 订单 600 客单价 500 UV 10000 转化率 6% 投放消耗 6万 ROI 1:5 退款率 3% 新客数 200',
      W,
    );
    expect(r.extracted.revenue).toBe(300000);
    expect(r.extracted.uv).toBe(10000);
    expect(r.extracted.ad_spend).toBe(60000);
    expect(r.extracted.roi).toBe('1:5');
    expect(r.extracted.refund_rate).toBe(3);
    expect(r.extracted.new_users).toBe(200);
  });
});

describe('ECOM_DAILY_WORKFLOW — runIntake validators', () => {
  it('revenue ÷ orders ≠ aov → contradiction (catch by 20% tolerance)', () => {
    const r = runIntake(
      W,
      '昨日 营收 30万 订单 1500 客单价 100 UV 10000 转化率 15%',
    );
    // revenue/orders = 200, declared aov = 100, drift 100% > 20%
    expect(r.kind).toBe('contradiction');
    if (r.kind !== 'contradiction') return;
    const fail = r.validatorResults.find((v) => v.validatorId === 'revenue_orders_aov');
    expect(fail?.passed).toBe(false);
    expect(fail?.message).toContain('数据不一致');
  });

  it('refund_rate > 100 → contradiction', () => {
    const r = runIntake(W, '昨日 营收 30万 退款率 150%');
    expect(r.kind).toBe('contradiction');
    if (r.kind !== 'contradiction') return;
    const fail = r.validatorResults.find((v) => v.validatorId === 'refund_rate_sanity');
    expect(fail?.passed).toBe(false);
    expect(fail?.message).toContain('退款率');
  });

  it('roi declared vs revenue/ad_spend > 30% drift → contradiction', () => {
    // revenue=100k, ad_spend=10k, calculated ROI=10. declared 1:3 → 3.
    // drift = (10-3)/3 = 233%, way over 30%.
    const r = runIntake(
      W,
      '昨日 营收 10万 投放消耗 1万 ROI 1:3',
    );
    expect(r.kind).toBe('contradiction');
    if (r.kind !== 'contradiction') return;
    const fail = r.validatorResults.find((v) => v.validatorId === 'roi_ad_spend_check');
    expect(fail?.passed).toBe(false);
  });

  it('all validators pass (consistent data) → ready', () => {
    // revenue=300k orders=1500 aov=200 → 1500*200=300000 ✓
    // conversion=10% (sane), refund_rate omitted (vacuous), roi 5
    // (matches 300k/60k=5, drift 0%).
    const r = runIntake(
      W,
      '昨日 营收 30万 订单 1500 客单价 200 UV 15000 转化率 10% 投放消耗 6万 ROI 1:5',
    );
    expect(r.kind).toBe('ready');
  });
});

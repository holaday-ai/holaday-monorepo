import { describe, expect, it } from 'vitest';

import { DOUYIN_REVIEW_WORKFLOW } from './expert-workflow-douyin.js';

const W = DOUYIN_REVIEW_WORKFLOW;

describe('DOUYIN_REVIEW_WORKFLOW — shape', () => {
  it('has the right workflowId + name + 4 roles', () => {
    expect(W.workflowId).toBe('douyin-review');
    expect(W.name).toBe('抖音直播复盘');
    expect(W.roleIds).toHaveLength(4);
  });

  it('5 required + 8 optional inputs', () => {
    expect(W.requiredInputs).toHaveLength(5);
    expect(W.optionalInputs).toHaveLength(8);
  });

  it('every required input has a unit + extractPattern', () => {
    for (const input of W.requiredInputs) {
      expect(input.extractPattern).toBeInstanceOf(RegExp);
      expect(input.unit).toBeTruthy();
    }
  });

  it('5 sections required, 1 optional, total 6', () => {
    expect(W.reportSections).toHaveLength(6);
    const required = W.reportSections.filter((s) => s.required);
    expect(required).toHaveLength(5);
    const optional = W.reportSections.filter((s) => !s.required);
    expect(optional).toHaveLength(1);
    expect(optional[0]!.id).toBe('industry_benchmark');
  });

  it('source-annotated sections have sourceAnnotation flag', () => {
    const annotated = W.reportSections.filter((s) => s.sourceAnnotation);
    expect(annotated.map((s) => s.id).sort()).toEqual(
      ['core_metrics', 'diagnosis', 'industry_benchmark'].sort(),
    );
  });

  it('3 follow-up actions', () => {
    expect(W.followUpActions).toHaveLength(3);
    expect(W.followUpActions.map((a) => a.label)).toEqual([
      '生成下场直播 SOP',
      '分析单品表现',
      '对比上场数据',
    ]);
  });

  it('3 data validators with stable ids', () => {
    expect(W.dataValidators.map((v) => v.id)).toEqual([
      'gmv_order_price',
      'conversion_sanity',
      'roi_ad_spend_check',
    ]);
  });

  it('system prompt preamble locks source markers + section title format', () => {
    expect(W.systemPromptPreamble).toContain('[用户提供]');
    expect(W.systemPromptPreamble).toContain('[系统计算]');
    expect(W.systemPromptPreamble).toContain('[模型假设]');
    expect(W.systemPromptPreamble).toContain('[外部来源]');
    expect(W.systemPromptPreamble).toContain('checkbox');
    expect(W.systemPromptPreamble).toContain('数据校验未通过');
  });
});

describe('validator: gmv_order_price', () => {
  const v = W.dataValidators.find((d) => d.id === 'gmv_order_price')!;

  it('passes when triple is consistent (within 20% tolerance)', () => {
    expect(
      v.check({ gmv: 100000, orders: 1250, avg_price: 80 }).passed,
    ).toBe(true);
  });

  it('passes within tolerance (calculated 100, declared 85 → 17.6% drift)', () => {
    // 100000 / 1000 = 100; |100-85|/85 = 17.6% < 20%
    expect(
      v.check({ gmv: 100000, orders: 1000, avg_price: 85 }).passed,
    ).toBe(true);
  });

  it('FAILS outside tolerance (calculated 100, declared 75 → 33% drift)', () => {
    // 100000 / 1000 = 100; |100-75|/75 = 33% > 20%
    const r = v.check({ gmv: 100000, orders: 1000, avg_price: 75 });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('100');
    expect(r.message).toContain('75');
    expect(r.suggestedFix).toContain('客单价');
  });

  it('flags BOSS-spec scenario: GMV 200000 / 500 orders / ¥50 price', () => {
    // 200000/500 = 400 ≠ 50 → 87.5% drift
    const r = v.check({ gmv: 200000, orders: 500, avg_price: 50 });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('400');
    expect(r.message).toContain('50');
  });

  it('passes vacuously when triple incomplete', () => {
    expect(v.check({ gmv: 100000 }).passed).toBe(true);
    expect(v.check({ orders: 500, avg_price: 50 }).passed).toBe(true);
  });

  it('fails loudly when orders is 0', () => {
    const r = v.check({ gmv: 100000, orders: 0, avg_price: 80 });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('0');
  });
});

describe('validator: conversion_sanity', () => {
  const v = W.dataValidators.find((d) => d.id === 'conversion_sanity')!;

  it('passes for 0-100 range', () => {
    expect(v.check({ conversion_rate: 0 }).passed).toBe(true);
    expect(v.check({ conversion_rate: 50 }).passed).toBe(true);
    expect(v.check({ conversion_rate: 100 }).passed).toBe(true);
  });

  it('fails > 100', () => {
    const r = v.check({ conversion_rate: 150 });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('150');
  });

  it('fails negative', () => {
    expect(v.check({ conversion_rate: -5 }).passed).toBe(false);
  });

  it('passes vacuously when missing', () => {
    expect(v.check({}).passed).toBe(true);
  });
});

describe('validator: roi_ad_spend_check', () => {
  const v = W.dataValidators.find((d) => d.id === 'roi_ad_spend_check')!;

  it('passes when GMV/ad_spend matches declared ROI within 30%', () => {
    // GMV 100000 / spend 40000 = 2.5; declared 1:2.5 → match
    const r = v.check({ gmv: 100000, ad_spend: 40000, roi: '1:2.5' });
    expect(r.passed).toBe(true);
  });

  it('parses bare number ROI (no colon)', () => {
    // GMV 100000 / spend 40000 = 2.5; declared 2.5 → match
    expect(
      v.check({ gmv: 100000, ad_spend: 40000, roi: '2.5' }).passed,
    ).toBe(true);
  });

  it('FAILS on 5x discrepancy', () => {
    // GMV 100000 / spend 8000 = 12.5; declared 1:2.5 (=2.5) → 5x off
    const r = v.check({ gmv: 100000, ad_spend: 8000, roi: '1:2.5' });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('2.5');
    expect(r.message).toContain('12.5');
  });

  it('skips when any of GMV / ad_spend / ROI missing', () => {
    expect(v.check({ gmv: 100, ad_spend: 50 }).passed).toBe(true); // no roi
    expect(v.check({ gmv: 100, roi: '2' }).passed).toBe(true); // no spend
    expect(v.check({ ad_spend: 100, roi: '2' }).passed).toBe(true); // no gmv
  });

  it('flags ad_spend=0 with non-empty ROI', () => {
    const r = v.check({ gmv: 100000, ad_spend: 0, roi: '1:2' });
    expect(r.passed).toBe(false);
    expect(r.message).toContain('0');
  });

  it('skips unparseable ROI text', () => {
    expect(
      v.check({ gmv: 100, ad_spend: 50, roi: 'unknown' }).passed,
    ).toBe(true);
  });
});

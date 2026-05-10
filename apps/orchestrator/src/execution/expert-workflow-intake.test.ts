import { describe, expect, it } from 'vitest';

import { DOUYIN_REVIEW_WORKFLOW } from './expert-workflow-douyin.js';
import { runIntake } from './expert-workflow-intake.js';

const W = DOUYIN_REVIEW_WORKFLOW;

describe('runIntake — missing required inputs', () => {
  it('empty intent → missing, lists all 5 required', () => {
    const r = runIntake(W, '帮我复盘下抖音直播');
    expect(r.kind).toBe('missing');
    if (r.kind !== 'missing') return;
    expect(r.parseResult.missingRequired).toHaveLength(5);
    expect(r.question).toContain('直播 GMV');
    expect(r.question).toContain('客单价');
    expect(r.question).toContain('转化率');
  });

  it('partial — only GMV given → missing reports 4 fields', () => {
    const r = runIntake(W, '复盘 GMV 100000');
    expect(r.kind).toBe('missing');
    if (r.kind !== 'missing') return;
    expect(r.parseResult.missingRequired.map((i) => i.name).sort()).toEqual(
      ['avg_price', 'conversion_rate', 'orders', 'uv'].sort(),
    );
    expect(r.parseResult.extracted.gmv).toBe(100000);
  });

  it('typo / non-numeric "不知道" against the digit-anchored regex → missing (not malformed)', () => {
    // The workflow's GMV regex only captures digit/comma/CJK-multiplier
    // forms, so "不知道" never matches at all → field stays missing.
    // The malformed-coercion path requires a matcher that captures
    // arbitrary text; that case is exercised in
    // expert-workflow-parser.test.ts with a stub workflow.
    const r = runIntake(W, 'GMV 不知道');
    expect(r.kind).toBe('missing');
    if (r.kind !== 'missing') return;
    expect(r.parseResult.missingRequired.map((i) => i.name)).toContain('gmv');
  });
});

describe('runIntake — contradictions surface as a different kind', () => {
  it('BOSS-spec scenario — GMV 200000 / 500 orders / ¥50 price → contradiction', () => {
    const r = runIntake(
      W,
      '复盘直播 GMV 200000 UV 5000 订单 500 客单价 50 转化率 10%',
    );
    expect(r.kind).toBe('contradiction');
    if (r.kind !== 'contradiction') return;
    // The validator that fired:
    const failed = r.validatorResults.filter((v) => !v.passed);
    expect(failed.map((v) => v.validatorId)).toContain('gmv_order_price');
    // Question text mentions both calculated and declared values.
    expect(r.question).toContain('400');
    expect(r.question).toContain('50');
    expect(r.question).toContain('校验未通过');
  });

  it('conversion rate > 100 → contradiction', () => {
    const r = runIntake(
      W,
      '复盘 GMV 1000 UV 100 订单 50 客单价 20 转化率 150%',
    );
    expect(r.kind).toBe('contradiction');
    if (r.kind !== 'contradiction') return;
    expect(
      r.validatorResults.find((v) => v.validatorId === 'conversion_sanity')
        ?.passed,
    ).toBe(false);
    expect(r.question).toContain('150');
  });
});

describe('runIntake — ready', () => {
  it('clean data passes → ready with extracted + validator results', () => {
    const r = runIntake(
      W,
      '复盘抖音直播 GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25%',
    );
    expect(r.kind).toBe('ready');
    if (r.kind !== 'ready') return;
    expect(r.parseResult.extracted.gmv).toBe(100000);
    expect(r.parseResult.extracted.orders).toBe(1250);
    expect(r.parseResult.extracted.avg_price).toBe(80);
    // All 3 validators returned passed=true.
    expect(r.validatorResults.every((v) => v.passed)).toBe(true);
  });

  it('clean data + optional千川 + ROI passes (within ±30% tolerance)', () => {
    const r = runIntake(
      W,
      '复盘 GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25% 千川消耗 40000 ROI 1:2.5',
    );
    expect(r.kind).toBe('ready');
    if (r.kind !== 'ready') return;
    expect(r.parseResult.extracted.ad_spend).toBe(40000);
    expect(r.parseResult.extracted.roi).toBe('1:2.5');
  });

  it('reply scenario: combined intent (original + reply) intake passes', () => {
    // User's original task: "复盘抖音直播 GMV 100000". Park.
    // User reply: "UV 20000 订单 1250 客单价 80 转化率 6.25%".
    // tasks.reply re-invokes runGenerateTask with combined text.
    const combined =
      '复盘抖音直播 GMV 100000\n\n[用户补充]\nUV 20000 订单 1250 客单价 80 转化率 6.25%';
    const r = runIntake(W, combined);
    expect(r.kind).toBe('ready');
  });
});

describe('runIntake — combined missing + validator failures (Phase 2 Day 4 fix)', () => {
  it('orders missing AND ROI conflict → missing question surfaces both', () => {
    // P0_003 scenario: gmv + uv + 转化率 + 客单价 + ROI + 千川消耗
    // present, but orders missing AND ROI doesn't match GMV/ad_spend.
    // Pre-fix the missing branch returned only the field-list; the
    // ROI conflict was lost. Now the message includes both.
    const r = runIntake(
      W,
      '复盘抖音直播 GMV 100000 UV 20000 转化率 3% ROI 1:2.5 客单价 80 千川消耗 8000',
    );
    expect(r.kind).toBe('missing');
    if (r.kind !== 'missing') return;
    expect(r.parseResult.missingRequired.map((i) => i.name)).toContain('orders');
    // Validator must still have run and surfaced the ROI conflict.
    expect(r.question).toContain('校验');
    expect(r.question).toMatch(/ROI/);
    // Field list still appended below the validator section.
    expect(r.question).toContain('订单数');
  });

  it('all required missing + no validator data → only field-list surfaces', () => {
    // No fields at all → validators all vacuous-pass → no校验 prefix.
    const r = runIntake(W, '帮我复盘抖音直播');
    expect(r.kind).toBe('missing');
    if (r.kind !== 'missing') return;
    expect(r.question).not.toContain('校验');
    expect(r.question).toContain('为了完成');
  });
});

import { describe, expect, it } from 'vitest';

import { DOUYIN_REVIEW_WORKFLOW } from './expert-workflow-douyin.js';
import {
  buildFollowUpFooter,
  buildReportSystemPrompt,
  FOLLOW_UP_ACTIONS_MARKER_CLOSE,
  FOLLOW_UP_ACTIONS_MARKER_OPEN,
} from './expert-workflow-prompt.js';
import type { NamedValidatorResult } from './expert-workflow-intake.js';

const W = DOUYIN_REVIEW_WORKFLOW;

const ALL_PASSED: NamedValidatorResult[] = W.dataValidators.map((v) => ({
  validatorId: v.id,
  description: v.description,
  passed: true,
}));

describe('buildReportSystemPrompt — clean data', () => {
  const prompt = buildReportSystemPrompt({
    workflow: W,
    extracted: { gmv: 100000, uv: 20000, orders: 1250, avg_price: 80 },
    validatorResults: ALL_PASSED,
  });

  it('opens with the workflow preamble', () => {
    expect(prompt.startsWith('【专家技能工作流：抖音直播复盘')).toBe(true);
  });

  it('lists every required section in order with title + id', () => {
    for (const s of W.reportSections.filter((x) => x.required)) {
      expect(prompt).toContain(s.title);
      expect(prompt).toContain(`id: \`${s.id}\``);
    }
  });

  it('flags source-annotation sections explicitly', () => {
    expect(prompt).toContain('需要 🟢🔵🟡🔴 来源标注');
  });

  it('embeds the extracted user data as JSON', () => {
    expect(prompt).toContain('"gmv": 100000');
    expect(prompt).toContain('"orders": 1250');
  });

  it('marks all validators as passed', () => {
    for (const v of ALL_PASSED) {
      expect(prompt).toContain(`✅ \`${v.validatorId}\``);
    }
  });

  it('output requirements pin section-title-strict order + no preamble', () => {
    expect(prompt).toContain('严格按 section 顺序输出');
    expect(prompt).toContain('不要以解释 / 引言开场');
  });
});

describe('buildReportSystemPrompt — failed validator surfaces in prompt', () => {
  const failedSet: NamedValidatorResult[] = [
    {
      validatorId: 'gmv_order_price',
      description: 'GMV ÷ 订单数 ≈ 客单价',
      passed: false,
      message: 'GMV ÷ 订单数 = ¥400, declared ¥50',
    },
    {
      validatorId: 'conversion_sanity',
      description: '转化率 ≤ 100%',
      passed: true,
    },
    {
      validatorId: 'roi_ad_spend_check',
      description: 'GMV ÷ 千川消耗 ≈ ROI',
      passed: true,
    },
  ];

  const prompt = buildReportSystemPrompt({
    workflow: W,
    extracted: { gmv: 200000, orders: 500, avg_price: 50 },
    validatorResults: failedSet,
  });

  it('marks failed validator with ⚠️ + message', () => {
    expect(prompt).toContain('⚠️ `gmv_order_price`');
    expect(prompt).toContain('GMV ÷ 订单数 = ¥400');
  });

  it('passed validators still get ✅', () => {
    expect(prompt).toContain('✅ `conversion_sanity`');
  });
});

describe('buildFollowUpFooter', () => {
  it('returns empty string when workflow has no follow-ups', () => {
    const w = { ...W, followUpActions: [] };
    expect(buildFollowUpFooter(w)).toBe('');
  });

  it('renders 3 actions as a markdown link list inside marker block', () => {
    const footer = buildFollowUpFooter(W);
    expect(footer).toContain(FOLLOW_UP_ACTIONS_MARKER_OPEN);
    expect(footer).toContain(FOLLOW_UP_ACTIONS_MARKER_CLOSE);
    expect(footer).toContain('🚀 下一步建议');
    expect(footer).toContain('生成下场直播 SOP');
    expect(footer).toContain('分析单品表现');
    expect(footer).toContain('对比上场数据');
  });

  it('uses workflow-action:// scheme so SPA can intercept', () => {
    const footer = buildFollowUpFooter(W);
    expect(footer).toContain('workflow-action://');
  });

  it('URL-encodes prompts so newlines + spaces survive', () => {
    const footer = buildFollowUpFooter(W);
    // 'SOP' prompt has Chinese + spaces. Decoded back, must match.
    const m = footer.match(/workflow-action:\/\/([^)]+)/);
    expect(m).toBeTruthy();
    if (m) {
      const decoded = decodeURIComponent(m[1]!);
      expect(decoded).toContain('基于这次复盘');
    }
  });
});

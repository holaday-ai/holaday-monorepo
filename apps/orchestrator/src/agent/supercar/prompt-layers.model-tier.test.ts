/**
 * Phase 24 RC follow-up — three-tier model selection.
 *
 * Replaces the prior Sonnet-everywhere-with-Opus-for-complex-roles
 * matrix with a cost-tiered ladder driven by KEYWORDS only (no extra
 * Anthropic call):
 *
 *   simple  → Haiku 4.5 medium      (translation / glossary / SOP /
 *                                    single-sentence query)
 *   medium  → Sonnet 4.6 high       (default — analysis reports,
 *                                    proposals, competitive teardowns)
 *   complex → Sonnet 4.6 xhigh      (multi-step research, cross-domain
 *                                    synthesis, COMPLEX_ROLES)
 *
 * Opus is no longer auto-routed — it costs ~5× per output token and
 * Sonnet xhigh hit the same quality bar on the RC complex tasks.
 */

import { describe, expect, it } from 'vitest';
import { selectModelAndEffort } from './prompt-layers.js';

describe('selectModelAndEffort — simple → Haiku', () => {
  it('translation routes to Haiku', () => {
    const out = selectModelAndEffort('帮我翻译这段话成英文', 'none');
    expect(out.model).toBe('claude-haiku-4-5');
  });

  it('English translate verb routes to Haiku', () => {
    const out = selectModelAndEffort('translate this paragraph to Chinese', 'none');
    expect(out.model).toBe('claude-haiku-4-5');
  });

  it('SOP write routes to Haiku', () => {
    const out = selectModelAndEffort('写一份运维 SOP', 'none');
    expect(out.model).toBe('claude-haiku-4-5');
  });

  it('glossary / 术语表 routes to Haiku', () => {
    const out = selectModelAndEffort('整理一份云原生术语表', 'none');
    expect(out.model).toBe('claude-haiku-4-5');
  });

  it('single-line query routes to Haiku', () => {
    const out = selectModelAndEffort('一句话告诉我什么是 RAG', 'none');
    expect(out.model).toBe('claude-haiku-4-5');
  });
});

describe('selectModelAndEffort — complex → Sonnet xhigh (NOT Opus)', () => {
  it('multi-step research routes to Sonnet xhigh', () => {
    const out = selectModelAndEffort(
      '帮我做一份关于多步骤研究流程的综合方案',
      'none',
    );
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('xhigh');
  });

  it('cross-domain synthesis keyword routes to Sonnet xhigh', () => {
    const out = selectModelAndEffort('做一个跨领域综合分析', 'none');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('xhigh');
  });

  it('deep research keyword routes to Sonnet xhigh', () => {
    const out = selectModelAndEffort('深度研究中国 SaaS 行业', 'none');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('xhigh');
  });

  it('complex role still routes to Sonnet xhigh, NOT Opus', () => {
    const out = selectModelAndEffort('正常任务文本', 'trend-researcher');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('xhigh');
  });

  it('legal-compliance role routes to Sonnet xhigh, NOT Opus', () => {
    const out = selectModelAndEffort('审查这份合同', 'legal-compliance');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('xhigh');
  });

  it('Opus is never selected for any input (cost guard)', () => {
    const inputs: Array<[string, string]> = [
      ['正常任务文本', 'trend-researcher'],
      ['深度研究', 'none'],
      ['多步骤跨领域综合分析', 'product-manager'],
      ['翻译这段', 'contract-reviewer'],
      ['', 'none'],
    ];
    for (const [intent, roleId] of inputs) {
      const out = selectModelAndEffort(intent, roleId);
      expect(out.model).not.toBe('claude-opus-4-7');
    }
  });
});

describe('selectModelAndEffort — default → Sonnet high', () => {
  it('plain analysis prompt routes to Sonnet high', () => {
    const out = selectModelAndEffort('分析中国新能源车 2026 年市场', 'none');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('high');
  });

  it('proposal-writing prompt routes to Sonnet high', () => {
    const out = selectModelAndEffort('写一份产品发布方案', 'none');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('high');
  });

  it('moderate role with no special keywords routes to Sonnet high', () => {
    const out = selectModelAndEffort('普通文案', 'content-creator');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('high');
  });
});

describe('selectModelAndEffort — keyword precedence', () => {
  it('complex keyword wins over a simple keyword in the same prompt', () => {
    const out = selectModelAndEffort(
      '翻译这段，并做跨领域综合分析',
      'none',
    );
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('xhigh');
  });

  it('a complex role overrides a simple-keyword prompt', () => {
    const out = selectModelAndEffort('翻译这段话', 'trend-researcher');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.effort).toBe('xhigh');
  });
});

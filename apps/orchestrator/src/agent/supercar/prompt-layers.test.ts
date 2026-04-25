import { describe, expect, it } from 'vitest';
import {
  buildLayeredSystemPrompt,
  classifyRole,
  getTaskBudget,
  selectModelAndEffort,
  ROLE_PROMPTS,
  BASE_PROMPT,
  STYLE_PROMPT,
} from './prompt-layers.js';

describe('classifyRole', () => {
  it('returns "none" for empty or whitespace input', () => {
    expect(classifyRole('')).toBe('none');
    expect(classifyRole('   ')).toBe('none');
  });

  it('returns "none" for unrelated intents', () => {
    expect(classifyRole('查一下今天天气')).toBe('none');
    expect(classifyRole('book a flight to tokyo')).toBe('none');
  });

  it.each([
    ['写一篇小红书种草笔记', 'xiaohongshu-operator'],
    ['抖音短视频脚本', 'douyin-strategist'],
    ['公众号头条选题', 'wechat-operator'],
    ['京东和拼多多店铺运营', 'china-ecommerce'],
    ['亚马逊跨境店铺优化', 'cross-border-ecommerce'],
    ['做一份完整的 PRD', 'product-manager'],
    ['SQL 数据分析报表', 'data-analyst'],
    ['DCF 财务模型估值', 'financial-forecaster'],
    ['HR 招聘 JD 撰写', 'recruiter'],
    ['合同条款审查', 'contract-reviewer'],
    ['制度 SOP 撰写', 'policy-writer'],
    ['供应链采购优化', 'supply-chain'],
    ['中英技术文档翻译', 'tech-translator'],
  ])('routes "%s" to "%s"', (intent, expected) => {
    expect(classifyRole(intent)).toBe(expected);
  });

  it('platform-specific keyword wins over generic role keyword', () => {
    // "小红书产品经理" — platform comes first in ROLE_KEYWORDS so
    // xiaohongshu beats product-manager.
    expect(classifyRole('小红书产品经理招聘')).toBe('xiaohongshu-operator');
  });

  it('every role id in ROLE_PROMPTS map exists (sanity)', () => {
    for (const id of Object.keys(ROLE_PROMPTS)) {
      // Every key must have non-undefined value (or empty string for 'none')
      expect(typeof ROLE_PROMPTS[id]).toBe('string');
    }
    expect(ROLE_PROMPTS.none).toBe('');
  });
});

describe('buildLayeredSystemPrompt', () => {
  it('returns Base + Style for "none" role (no role addon)', () => {
    const out = buildLayeredSystemPrompt('none');
    expect(out).toContain(BASE_PROMPT);
    expect(out).toContain(STYLE_PROMPT);
    // Layout: Base, then Style (no Role between)
    expect(out.indexOf(BASE_PROMPT)).toBeLessThan(out.indexOf(STYLE_PROMPT));
  });

  it('includes the role addon between Base and Style for known role', () => {
    const out = buildLayeredSystemPrompt('xiaohongshu-operator');
    const baseIdx = out.indexOf(BASE_PROMPT);
    const roleIdx = out.indexOf(ROLE_PROMPTS['xiaohongshu-operator']!);
    const styleIdx = out.indexOf(STYLE_PROMPT);
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(roleIdx).toBeGreaterThan(baseIdx);
    expect(styleIdx).toBeGreaterThan(roleIdx);
  });

  it('falls back to Base + Style when role id is unknown', () => {
    const out = buildLayeredSystemPrompt('not-a-real-role');
    expect(out).toContain(BASE_PROMPT);
    expect(out).toContain(STYLE_PROMPT);
    // No mystery role text injected
    expect(out).not.toContain('not-a-real-role');
  });
});

describe('selectModelAndEffort', () => {
  it('simple-search no-role → Sonnet 4.6 medium', () => {
    expect(selectModelAndEffort('对比京东淘宝 MacBook 价格', 'none')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'medium',
    });
  });

  it('complex specialist role → Opus 4.7 xhigh', () => {
    expect(selectModelAndEffort('PRD 文档撰写', 'product-manager')).toEqual({
      model: 'claude-opus-4-7',
      effort: 'xhigh',
    });
    expect(selectModelAndEffort('合同审查', 'contract-reviewer')).toEqual({
      model: 'claude-opus-4-7',
      effort: 'xhigh',
    });
  });

  it('default — non-simple-search, non-complex role → Sonnet 4.6 high', () => {
    expect(selectModelAndEffort('写一篇小红书笔记', 'xiaohongshu-operator')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'high',
    });
  });

  it('xhigh is only paired with Opus 4.7', () => {
    // Pure invariant — never xhigh on Sonnet.
    const cases = [
      ['none', '查天气'],
      ['xiaohongshu-operator', '写小红书笔记'],
      ['content-creator', '写文案'],
    ];
    for (const [role, intent] of cases) {
      const r = selectModelAndEffort(intent, role);
      if (r.effort === 'xhigh') {
        expect(r.model).toBe('claude-opus-4-7');
      }
    }
  });
});

describe('getTaskBudget', () => {
  it('simple-search no-role → 50K', () => {
    expect(getTaskBudget('对比 MacBook 价格', 'none')).toBe(50_000);
  });

  it('content-generation roles → 100K', () => {
    expect(getTaskBudget('write blog', 'content-creator')).toBe(100_000);
    expect(getTaskBudget('客服回复', 'customer-service')).toBe(100_000);
    expect(getTaskBudget('翻译', 'tech-translator')).toBe(100_000);
  });

  it('research / analysis tasks → 200K', () => {
    expect(getTaskBudget('竞品分析', 'trend-researcher')).toBe(200_000);
    expect(getTaskBudget('财报分析', 'financial-forecaster')).toBe(200_000);
  });

  it('budget always meets API minimum (20K)', () => {
    const intents = ['查天气', '写笔记', '财报', '招聘', ''];
    const roles = ['none', 'content-creator', 'product-manager', 'recruiter'];
    for (const i of intents) for (const r of roles) {
      expect(getTaskBudget(i, r)).toBeGreaterThanOrEqual(20_000);
    }
  });
});

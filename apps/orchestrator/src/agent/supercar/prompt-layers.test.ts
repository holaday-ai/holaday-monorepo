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

  it('requires unsourced benchmark numbers to be labelled as assumptions', () => {
    const out = buildLayeredSystemPrompt('growth-hacker');
    expect(out).toContain('没有来源支撑的行业 benchmark');
    expect(out).toContain('经验假设 / 常见区间 / 需要实测确认');
    expect(out).toContain('不要把它当成已验证事实');
  });

  it('requires user confirmation before transactional final submits', () => {
    const out = buildLayeredSystemPrompt('none');
    expect(out).toContain('预订 / 预约 / 报名 / 投递 / 加购 / 结账 / 取消订阅 / 退订');
    expect(out).toContain('不要点击最终确认 / 提交预约 / 提交报名 / 提交申请 / 确认预订 / Place order / Delete / Unsubscribe');
    expect(out).toContain('关键条款或将要改变的账户状态');
    expect(out).toContain('停在最终确认页，先说明影响');
  });

  it('asks for missing transactional inputs before opening the browser', () => {
    const out = buildLayeredSystemPrompt('none');
    expect(out).toContain('交易/预约类任务的最小信息检查');
    expect(out).toContain('不要先打开网页乱试');
    expect(out).toContain('一次只问 1-3 个最关键问题');
    expect(out).toContain('[AWAITING_USER_INPUT]');
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
  // Phase 24 RC follow-up: assertions updated for the three-tier
  // cost-optimised matrix. simple → Haiku, complex → Sonnet xhigh
  // (NOT Opus), default → Sonnet high. See
  // prompt-layers.model-tier.test.ts for the new tier coverage.
  it('simple-search no-role → Haiku 4.5 medium', () => {
    expect(selectModelAndEffort('对比京东淘宝 MacBook 价格', 'none')).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'medium',
    });
  });

  it('complex specialist role → Sonnet 4.6 xhigh (was Opus)', () => {
    expect(selectModelAndEffort('PRD 文档撰写', 'product-manager')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'xhigh',
    });
    expect(selectModelAndEffort('合同审查', 'contract-reviewer')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'xhigh',
    });
  });

  it('default — non-simple-search, non-complex role → Sonnet 4.6 high', () => {
    expect(selectModelAndEffort('写一篇小红书笔记', 'xiaohongshu-operator')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'high',
    });
  });

  it.each([
    '在 Google Flights 查找东京到纽约航班并筛选直飞',
    '在携程查询上海到东京机票，筛选直飞并停在付款前',
    '在 Airbnb 找下周末东京民宿并收藏前两个',
    '在 Gmail 写一封邮件草稿给客户，不要发送',
    '在 GitHub 创建一个 issue 草稿',
    'create a draft issue in GitHub',
  ])('live app workflow → Sonnet 4.6 high: %s', (intent) => {
    expect(selectModelAndEffort(intent, 'none')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'high',
    });
  });

  it.each([
    '今天上海天气',
    'What is the Tesla stock price today?',
  ])('pure fact lookup still uses Haiku 4.5 medium: %s', (intent) => {
    expect(selectModelAndEffort(intent, 'none')).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'medium',
    });
  });

  it('xhigh is only paired with Sonnet 4.6 (Opus retired from auto-routing)', () => {
    const cases: Array<[string, string]> = [
      ['none', '查天气'],
      ['xiaohongshu-operator', '写小红书笔记'],
      ['content-creator', '写文案'],
      ['product-manager', '深度调研'],
    ];
    for (const [role, intent] of cases) {
      const r = selectModelAndEffort(intent, role);
      if (r.effort === 'xhigh') {
        expect(r.model).toBe('claude-sonnet-4-6');
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

  it.each([
    '在 Google Flights 查找东京到纽约航班并筛选直飞',
    '在携程查询上海到东京机票，筛选直飞并停在付款前',
    '在 Airbnb 找下周末东京民宿并收藏前两个',
    '在 Gmail 写一封邮件草稿给客户，不要发送',
    '在 GitHub 创建一个 issue 草稿',
    'create a draft issue in GitHub',
  ])('live app workflow → 200K budget: %s', (intent) => {
    expect(getTaskBudget(intent, 'none')).toBe(200_000);
  });

  it('budget always meets API minimum (20K)', () => {
    const intents = ['查天气', '写笔记', '财报', '招聘', ''];
    const roles = ['none', 'content-creator', 'product-manager', 'recruiter'];
    for (const i of intents) for (const r of roles) {
      expect(getTaskBudget(i, r)).toBeGreaterThanOrEqual(20_000);
    }
  });
});

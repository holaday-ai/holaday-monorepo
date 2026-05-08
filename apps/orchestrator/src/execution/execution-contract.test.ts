import { describe, expect, it } from 'vitest';

import { buildContract } from './execution-contract.js';

describe('buildContract — tier selection', () => {
  it('expertWorkflowId set → full tier (overrides executionMode)', () => {
    const c = buildContract({
      taskId: 'tsk_e',
      intent: '复盘抖音直播',
      executionMode: 'generate',
      expertWorkflowId: 'douyin-livestream-review',
    });
    expect(c.tier).toBe('full');
    expect(c.maxSteps).toBe(30);
    expect(c.timeout).toBe(300);
    expect(c.expectedOutputType).toBe('text');
  });

  it('browser without expert workflow → light tier', () => {
    const c = buildContract({
      taskId: 'tsk_b',
      intent: '打开 example.com 取标题',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    expect(c.tier).toBe('light');
    expect(c.maxSteps).toBe(15);
    expect(c.timeout).toBe(120);
    expect(c.expectedOutputType).toBe('data');
  });

  it('generate mode → checklist tier', () => {
    const c = buildContract({
      taskId: 'tsk_g',
      intent: '翻译这句话',
      executionMode: 'generate',
    });
    expect(c.tier).toBe('checklist');
    expect(c.maxSteps).toBe(1);
    expect(c.timeout).toBe(60);
  });

  it('scrape mode → checklist tier', () => {
    const c = buildContract({
      taskId: 'tsk_s',
      intent: '抓取这个新闻页',
      executionMode: 'scrape',
    });
    expect(c.tier).toBe('checklist');
  });
});

describe('buildContract — common header', () => {
  it('summarises long intent into a one-liner goal', () => {
    const longIntent = 'A'.repeat(200);
    const c = buildContract({
      taskId: 'tsk_l',
      intent: longIntent,
      executionMode: 'generate',
    });
    expect(c.goal.length).toBeLessThanOrEqual(120);
    expect(c.goal.endsWith('...')).toBe(true);
  });

  it('collapses interior whitespace in the goal', () => {
    const c = buildContract({
      taskId: 'tsk_ws',
      intent: '复盘\n直播\t\t数据',
      executionMode: 'generate',
    });
    expect(c.goal).toBe('复盘 直播 数据');
  });

  it('attaches createdAt as ISO timestamp', () => {
    const c = buildContract({
      taskId: 'tsk_t',
      intent: 'x',
      executionMode: 'generate',
    });
    expect(new Date(c.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('passes through requiredInputs verbatim', () => {
    const c = buildContract({
      taskId: 'tsk_r',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
      requiredInputs: [
        { name: 'GMV', description: '本场总成交额', provided: false },
        { name: '客单价', description: '人均下单金额', provided: true },
      ],
    });
    expect(c.requiredInputs).toHaveLength(2);
    expect(c.requiredInputs[0]!.provided).toBe(false);
  });
});

describe('buildContract — checklist tier (generate/scrape)', () => {
  it('emits word_count + URL grounding criteria, no constraints', () => {
    const c = buildContract({
      taskId: 'tsk_g',
      intent: '翻译',
      executionMode: 'generate',
    });
    expect(c.successCriteria).toHaveLength(2);
    expect(c.successCriteria[0]!.type).toBe('word_count');
    expect(c.successCriteria[0]!.data).toEqual({ min: 50 });
    expect(c.successCriteria[1]!.rule).toBe('no_ungrounded_urls');
    expect(c.constraints).toEqual([]);
  });

  it('passes user constraints through to checklist tier', () => {
    const c = buildContract({
      taskId: 'tsk_g2',
      intent: '生成',
      executionMode: 'generate',
      constraints: ['不引用未公开数据'],
    });
    expect(c.constraints).toEqual(['不引用未公开数据']);
  });
});

describe('buildContract — light tier (browser)', () => {
  it('prepends url_match criterion when targetDomain is set', () => {
    const c = buildContract({
      taskId: 'tsk_b',
      intent: '打开例子',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    expect(c.successCriteria[0]!.type).toBe('url_match');
    expect(c.successCriteria[0]!.data).toEqual({ domain: 'example.com' });
    expect(c.successCriteria[0]!.rule).toContain('example.com');
  });

  it('skips url_match criterion when targetDomain is missing', () => {
    const c = buildContract({
      taskId: 'tsk_b2',
      intent: '随便看看网页',
      executionMode: 'browser',
    });
    expect(c.successCriteria.find((s) => s.type === 'url_match')).toBeUndefined();
    // Other browser-tier criteria still present.
    expect(c.successCriteria.find((s) => s.type === 'data_present')).toBeDefined();
  });

  it('always includes the safety constraints (no_form_submit, no_payment)', () => {
    const c = buildContract({
      taskId: 'tsk_b3',
      intent: '搜索',
      executionMode: 'browser',
      targetDomain: 'duckduckgo.com',
    });
    expect(c.constraints).toContain('no_form_submit');
    expect(c.constraints).toContain('no_payment');
  });

  it('appends user constraints AFTER the default safety set', () => {
    const c = buildContract({
      taskId: 'tsk_b4',
      intent: '比价',
      executionMode: 'browser',
      targetDomain: 'taobao.com',
      constraints: ['不点击购买按钮'],
    });
    // Caller-supplied constraint comes first, then defaults.
    expect(c.constraints[0]).toBe('不点击购买按钮');
    expect(c.constraints).toContain('no_form_submit');
  });
});

describe('buildContract — full tier (expert workflow)', () => {
  it('emits 4 criteria covering word_count, data_present, required_inputs, URL grounding', () => {
    const c = buildContract({
      taskId: 'tsk_f',
      intent: '复盘抖音直播',
      executionMode: 'generate',
      expertWorkflowId: 'douyin-livestream-review',
    });
    expect(c.successCriteria).toHaveLength(4);
    const types = c.successCriteria.map((s) => s.type);
    expect(types).toContain('word_count');
    expect(types).toContain('data_present');
    // Two custom rules: covers_required_inputs + no_ungrounded_urls.
    const customRules = c.successCriteria
      .filter((s) => s.type === 'custom')
      .map((s) => s.rule);
    expect(customRules).toContain('covers_required_inputs');
    expect(customRules).toContain('no_ungrounded_urls');
  });

  it('full tier word_count threshold is higher than checklist', () => {
    const fullContract = buildContract({
      taskId: 'tsk_f2',
      intent: 'x',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
    });
    const checklistContract = buildContract({
      taskId: 'tsk_c2',
      intent: 'x',
      executionMode: 'generate',
    });
    const fullMin = (fullContract.successCriteria.find((s) => s.type === 'word_count')!.data as { min: number }).min;
    const checklistMin = (checklistContract.successCriteria.find((s) => s.type === 'word_count')!.data as { min: number }).min;
    expect(fullMin).toBeGreaterThan(checklistMin);
  });
});

describe('SuccessCriterion id uniqueness', () => {
  it('every criterion gets a unique id', () => {
    const c = buildContract({
      taskId: 'tsk_id',
      intent: 'x',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ids = c.successCriteria.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

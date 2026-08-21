import { describe, expect, it } from 'vitest';

import { buildContract, classifyIntentForOutputRequirement } from './execution-contract.js';

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

  it('forced expert mode uses the full quality contract without a typed workflow', () => {
    const c = buildContract({
      taskId: 'tsk_generic_expert',
      intent: '给我一份 SaaS landing page 优化建议，按转化漏斗分层',
      executionMode: 'generate',
      expertMode: 'expert',
    });

    expect(c.tier).toBe('full');
    expect(c.expertMode).toBe('expert');
    expect(c.successCriteria.some((criterion) => criterion.rule === 'expert_claim_provenance')).toBe(
      true,
    );
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
    // 100+ char prompt → "long" generate bucket → min=50.
    // The shape (criteria count + types + constraints) is what
    // matters here; the threshold-by-prompt-length tests live below.
    const longIntent =
      '请帮我写一份非常完整的 PRD 文档，覆盖目标用户的画像分析、核心功能模块、非功能性需求、上线时间计划、运营推广策略、关键指标 KPI 设定与各种边缘场景的风险评估方案，并给出明确的迭代节奏与版本里程碑。';
    expect(longIntent.length).toBeGreaterThanOrEqual(100);
    const c = buildContract({
      taskId: 'tsk_g',
      intent: longIntent,
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

describe('buildContract — dynamic word_count threshold (Phase 1 follow-up)', () => {
  function wordCountMin(c: ReturnType<typeof buildContract>): number {
    const wc = c.successCriteria.find((s) => s.type === 'word_count');
    if (!wc) throw new Error('no word_count criterion');
    return (wc.data as { min: number }).min;
  }

  it('short generate prompt (< 100 chars) without attachments → min=10', () => {
    const c = buildContract({
      taskId: 'tsk_short',
      intent: '把这句话翻译成英文：今天天气真好',
      executionMode: 'generate',
    });
    expect(wordCountMin(c)).toBe(10);
    // Description should reflect the chosen min.
    expect(c.successCriteria[0]!.description).toContain('10 字符');
  });

  it('short generate prompt WITH attachments → min=50 (analysis case)', () => {
    const c = buildContract({
      taskId: 'tsk_short_attach',
      intent: '帮我看看',
      executionMode: 'generate',
      hasAttachments: true,
    });
    // "帮我看看" is < 100 chars but the user uploaded data — the
    // expected answer is a real analysis, not a one-liner.
    expect(wordCountMin(c)).toBe(50);
  });

  it('long generate prompt (>= 100 chars) → min=50', () => {
    const c = buildContract({
      taskId: 'tsk_long',
      intent: '请帮我写一份详细的产品经理岗位的 OKR 周报，包括本周进展、下周计划、风险与依赖、需要协调的事项与资源。'.repeat(2),
      executionMode: 'generate',
    });
    expect(wordCountMin(c)).toBe(50);
  });

  it('scrape mode → min=100 regardless of prompt length', () => {
    const c = buildContract({
      taskId: 'tsk_scrape_short',
      intent: '搜小红书',
      executionMode: 'scrape',
    });
    expect(wordCountMin(c)).toBe(100);
    expect(c.successCriteria[0]!.description).toContain('100 字符');
  });

  it('boundary: exactly 100 chars in generate → still long bucket (min=50)', () => {
    // 100 chars exactly — the "< 100" rule excludes this from short.
    const intent = 'A'.repeat(100);
    const c = buildContract({
      taskId: 'tsk_boundary',
      intent,
      executionMode: 'generate',
    });
    expect(wordCountMin(c)).toBe(50);
  });

  it('boundary: exactly 99 chars in generate → short bucket (min=10)', () => {
    const intent = 'A'.repeat(99);
    const c = buildContract({
      taskId: 'tsk_boundary99',
      intent,
      executionMode: 'generate',
    });
    expect(wordCountMin(c)).toBe(10);
  });

  it('hasAttachments=false explicit → same as omitted', () => {
    const c = buildContract({
      taskId: 'tsk_no_attach',
      intent: '翻译',
      executionMode: 'generate',
      hasAttachments: false,
    });
    expect(wordCountMin(c)).toBe(10);
  });

  it('full tier (expert workflow) is unaffected by the threshold helper', () => {
    // Full tier still uses its own 200-char threshold.
    const c = buildContract({
      taskId: 'tsk_full_unaffected',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
    });
    expect(wordCountMin(c)).toBe(200);
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

describe('classifyIntentForOutputRequirement — real QA prompts', () => {
  it('requires a clickable source for explicit research and retrieval intents', () => {
    expect(
      classifyIntentForOutputRequirement('研究 2026 年 AI 行业趋势'),
    ).toEqual({
      kind: 'general_with_links',
      requirement: { kind: 'general_with_links', minUrls: 1 },
    });
    expect(
      classifyIntentForOutputRequirement('检索最新的数据隐私法规'),
    ).toEqual({
      kind: 'general_with_links',
      requirement: { kind: 'general_with_links', minUrls: 1 },
    });
  });

  it('does not require sources for non-research transformations', () => {
    expect(classifyIntentForOutputRequirement('把这句话翻译成英文')).toEqual({
      kind: 'general',
      requirement: null,
    });
  });

  it('keeps explicit stock source-link requests under the stock verifier', () => {
    const out = classifyIntentForOutputRequirement('帮我查今天特斯拉股价并给出来源链接');
    expect(out.kind).toBe('stock_quote');
    expect(out.requirement).toEqual({ kind: 'stock' });
  });

  it('treats 电商站 + 前 N + 按价格排序 as an ecommerce listing', () => {
    const out = classifyIntentForOutputRequirement(
      '去电商站搜 iPhone 16，按价格排序，给前5结果（名称/价格/链接）',
    );
    expect(out.kind).toBe('ecommerce_listing');
    expect(out.requirement).toEqual({
      kind: 'ecommerce',
      minItems: 5,
      sortOrder: 'asc',
    });
  });

  it('uses platform counts for marketplace price comparisons', () => {
    const out = classifyIntentForOutputRequirement(
      '对比京东、天猫、拼多多三家平台 iPhone 16 128GB 的当前价格，并总结最优选。请给出每个平台的商品名、价格、链接和判断依据。',
    );
    expect(out.kind).toBe('ecommerce_listing');
    expect(out.requirement).toEqual({
      kind: 'ecommerce',
      minItems: 3,
      sortOrder: null,
    });
  });

  it('does not mistake a platform content plan and topic count for a product listing', () => {
    expect(
      classifyIntentForOutputRequirement(
        '小红书 爆款选题：品类 美妆护肤 平台小红书 关键词 早C晚A 平价 油痘肌 生成 5 个选题',
      ),
    ).toEqual({
      kind: 'general',
      requirement: null,
    });
  });

  it('tightens comparison URL requirements when the user asks for links', () => {
    const out = classifyIntentForOutputRequirement(
      '对比 Notion 和 Coda 的优缺点，并给出来源链接',
    );
    expect(out.kind).toBe('comparison');
    expect(out.requirement).toEqual({
      kind: 'comparison',
      minCandidates: 2,
      minUrls: 1,
    });
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

import { describe, expect, it } from 'vitest';

import { DOUYIN_REVIEW_WORKFLOW } from './expert-workflow-douyin.js';
import type {
  ExpertWorkflowContract,
  WorkflowInput,
} from './expert-workflow-contract.js';
import {
  _internal,
  buildClarificationQuestion,
  parseInputs,
} from './expert-workflow-parser.js';

const W = DOUYIN_REVIEW_WORKFLOW;

describe('coerceNumber', () => {
  const c = _internal.coerceNumber;
  it('plain digits', () => expect(c('1234')).toBe(1234));
  it('comma thousand-separator', () => expect(c('100,000')).toBe(100000));
  it('Chinese comma 1，000', () => expect(c('1，000')).toBe(1000));
  it('currency markers stripped', () => {
    expect(c('¥100,000')).toBe(100000);
    expect(c('￥100')).toBe(100);
    expect(c('$50')).toBe(50);
  });
  it('percentage stripped', () => expect(c('3%')).toBe(3));
  it('decimal preserved', () => expect(c('100.50')).toBe(100.5));
  it('empty / whitespace → NaN', () => {
    expect(Number.isNaN(c(''))).toBe(true);
    expect(Number.isNaN(c('   '))).toBe(true);
  });
  it('non-numeric → NaN', () => {
    expect(Number.isNaN(c('abc'))).toBe(true);
  });
  it('Chinese unit suffix 万 / 亿 / 千 / 百 translated', () => {
    expect(c('15万')).toBe(150_000);
    expect(c('1.5万')).toBe(15_000);
    expect(c('2亿')).toBe(200_000_000);
    expect(c('5千')).toBe(5_000);
    expect(c('3百')).toBe(300);
  });
  it('suffix-only input → NaN (no number to multiply)', () => {
    expect(Number.isNaN(c('万'))).toBe(true);
  });
});

describe('parseInputs — douyin required fields', () => {
  it('extracts all 5 required fields from a structured input string', () => {
    const text =
      'GMV: ¥100000  UV: 20000  订单: 1250  客单价: ¥80  转化率: 6.25%';
    const r = parseInputs(text, W);
    expect(r.extracted).toEqual({
      gmv: 100000,
      uv: 20000,
      orders: 1250,
      avg_price: 80,
      conversion_rate: 6.25,
    });
    expect(r.missingRequired).toHaveLength(0);
    expect(r.malformed).toHaveLength(0);
  });

  it('extracts from natural-language sentence', () => {
    const text =
      '昨天直播 GMV 是 200000 元，UV 50000，一共 500 单，客单价 400 元，转化率 1%。';
    const r = parseInputs(text, W);
    expect(r.extracted.gmv).toBe(200000);
    expect(r.extracted.uv).toBe(50000);
    expect(r.extracted.orders).toBe(500);
    expect(r.extracted.avg_price).toBe(400);
    expect(r.extracted.conversion_rate).toBe(1);
  });

  it('missing GMV → reported in missingRequired', () => {
    const text = 'UV 20000  订单 1250  客单价 80  转化率 6.25%';
    const r = parseInputs(text, W);
    expect(r.missingRequired.map((i) => i.name)).toEqual(['gmv']);
    expect(r.extracted.uv).toBe(20000);
  });

  it('all required missing → all 5 reported', () => {
    const r = parseInputs('请帮我复盘一下直播', W);
    expect(r.missingRequired.map((i) => i.name).sort()).toEqual(
      ['avg_price', 'conversion_rate', 'gmv', 'orders', 'uv'].sort(),
    );
    expect(r.extracted).toEqual({});
  });

  it('UV does not get hijacked by 客单价 number', () => {
    // Earlier loose regex caught "80" from "客单价 80" as UV when UV
    // wasn't given. Pin: a missing UV should stay missing.
    const text = '客单价 80  GMV 100000  订单 1250  转化率 6.25%';
    const r = parseInputs(text, W);
    expect(r.missingRequired.map((i) => i.name)).toEqual(['uv']);
    expect(r.extracted.gmv).toBe(100000);
  });

  it('订单 does not match 客单价 prefix', () => {
    const text = '客单价 80';
    const r = parseInputs(text, W);
    expect(r.extracted.orders).toBeUndefined();
    expect(r.extracted.avg_price).toBe(80);
  });

  it('GMV with thousand-separator', () => {
    const text = 'GMV 1,234,567  UV 10  订单 1  客单价 1234567  转化率 10';
    const r = parseInputs(text, W);
    expect(r.extracted.gmv).toBe(1234567);
  });

  it('转化率 without % suffix still extracted', () => {
    const text = 'GMV 100  UV 1  订单 1  客单价 100  转化率: 5';
    const r = parseInputs(text, W);
    expect(r.extracted.conversion_rate).toBe(5);
  });
});

describe('parseInputs — douyin optional fields', () => {
  it('千川消耗 + ROI extracted', () => {
    const text = `GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25%
千川消耗 ¥8000  ROI 1:12.5`;
    const r = parseInputs(text, W);
    expect(r.extracted.ad_spend).toBe(8000);
    expect(r.extracted.roi).toBe('1:12.5');
  });

  it('GPM + 涨粉 extracted', () => {
    const text = `GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25%
GPM 5000  涨粉 200`;
    const r = parseInputs(text, W);
    expect(r.extracted.gpm).toBe(5000);
    expect(r.extracted.fans_gained).toBe(200);
  });

  it('missing optionals are reported separately from required', () => {
    const text = 'GMV 100 UV 1 订单 1 客单价 100 转化率 1';
    const r = parseInputs(text, W);
    expect(r.missingRequired).toHaveLength(0);
    expect(r.missingOptional.length).toBeGreaterThanOrEqual(7);
  });

  it('platform_list multi-line capture', () => {
    const text = `GMV 100 UV 1 订单 1 客单价 100 转化率 1

商品明细：
- A 商品 ¥99 ×30
- B 商品 ¥199 ×10

`;
    const r = parseInputs(text, W);
    expect(r.extracted.product_list).toContain('A 商品');
    expect(r.extracted.product_list).toContain('B 商品');
  });
});

describe('parseInputs — malformed coercion', () => {
  it('GMV with non-numeric capture → malformed', () => {
    // Suppose the user wrote "GMV: 不太确定" — the regex captures
    // "不太确定" as group 1 but it doesn't coerce to a number.
    const minimalInput: WorkflowInput = {
      name: 'gmv',
      label: 'GMV',
      type: 'number',
      extractPattern: /GMV\s*[：:]\s*(.+)/i,
    };
    const stub: ExpertWorkflowContract = {
      workflowId: 'test',
      name: 'test',
      generationBudget: { maxTokens: 1024, targetChars: { min: 100, max: 500 } },
      roleIds: [],
      requiredInputs: [minimalInput],
      optionalInputs: [],
      dataValidators: [],
      reportSections: [],
      followUpActions: [],
      systemPromptPreamble: '',
    };
    const r = parseInputs('GMV: 不太确定', stub);
    expect(r.malformed).toHaveLength(1);
    expect(r.malformed[0]!.input.name).toBe('gmv');
    expect(r.malformed[0]!.rawCapture).toBe('不太确定');
    expect(r.missingRequired).toHaveLength(0);
  });
});

describe('buildClarificationQuestion', () => {
  it('lists missing required fields with units', () => {
    const text = '帮我复盘下抖音直播';
    const r = parseInputs(text, W);
    const q = buildClarificationQuestion(W, r);
    expect(q).toContain('抖音直播复盘');
    expect(q).toContain('直播 GMV');
    expect(q).toContain('元');
    expect(q).toContain('转化率');
    expect(q).toContain('%');
  });

  it('includes malformed captures with raw value', () => {
    const minimalInput: WorkflowInput = {
      name: 'gmv',
      label: 'GMV',
      type: 'number',
      unit: '元',
      extractPattern: /GMV\s*[：:]\s*(.+)/i,
    };
    const stub: ExpertWorkflowContract = {
      ...W,
      workflowId: 'test',
      name: 'test',
      requiredInputs: [minimalInput],
      optionalInputs: [],
    };
    const r = parseInputs('GMV: 不太确定', stub);
    const q = buildClarificationQuestion(stub, r);
    expect(q).toContain('不太确定');
    expect(q).toContain('数字');
  });
});

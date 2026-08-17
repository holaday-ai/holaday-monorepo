import { describe, expect, it } from 'vitest';
import {
  canonicalStockScreenCriterion,
  parseStockScreenPrompt,
  validateStockScreenCriteria,
  type StockScreenCriterion,
} from './screening-criteria.js';

describe('parseStockScreenPrompt', () => {
  it('turns explicit Chinese requirements into editable criteria without adding judgments', () => {
    const result = parseStockScreenPrompt(
      '排除ST，市盈率低于30，PB不超过3，资产负债率低于50%，ROE高于10%，近三年持续盈利，近期无减持',
    );

    expect(result.unparsedClauses).toEqual([]);
    expect(result.criteria.map(({ field, operator, value, unit, status }) => ({
      field,
      operator,
      value,
      unit,
      status,
    }))).toEqual([
      { field: 'exclude_st', operator: 'eq', value: true, unit: null, status: 'ready' },
      { field: 'pe_ttm', operator: 'lt', value: 30, unit: null, status: 'ready' },
      { field: 'pb', operator: 'lte', value: 3, unit: null, status: 'ready' },
      { field: 'debt_ratio', operator: 'lt', value: 50, unit: '%', status: 'ready' },
      { field: 'roe', operator: 'gt', value: 10, unit: '%', status: 'ready' },
      {
        field: 'net_profit_3y_positive',
        operator: 'eq',
        value: true,
        unit: null,
        status: 'ready',
      },
      {
        field: 'insider_reduction_recent',
        operator: 'eq',
        value: false,
        unit: null,
        status: 'ready',
      },
    ]);
    expect(new Set(result.criteria.map((criterion) => criterion.id)).size).toBe(7);
  });

  it('keeps qualitative thresholds incomplete instead of inventing a number', () => {
    const result = parseStockScreenPrompt('近三年持续盈利，市盈率不过高');

    expect(result.unparsedClauses).toEqual([]);
    expect(result.criteria).toHaveLength(2);
    expect(result.criteria[1]).toMatchObject({
      field: 'pe_ttm',
      operator: 'lte',
      value: null,
      status: 'needs_input',
      label: '市盈率上限',
    });
  });

  it('returns unsupported clauses for the user instead of silently ignoring them', () => {
    const result = parseStockScreenPrompt('排除ST，我喜欢管理层靠谱，市盈率低于25');

    expect(result.criteria.map((criterion) => criterion.field)).toEqual(['exclude_st', 'pe_ttm']);
    expect(result.unparsedClauses).toEqual(['我喜欢管理层靠谱']);
  });

  it('deduplicates exact repeated requirements but preserves different bounds', () => {
    const result = parseStockScreenPrompt('排除ST，排除ST，ROE高于8%，ROE高于12%');

    expect(result.criteria.map(({ field, value }) => ({ field, value }))).toEqual([
      { field: 'exclude_st', value: true },
      { field: 'roe', value: 8 },
      { field: 'roe', value: 12 },
    ]);
  });

  it('converts common Chinese turnover-amount units instead of treating one 亿元 as one 元', () => {
    const result = parseStockScreenPrompt('成交额高于1.5亿元，成交额不低于8000万元');

    expect(result.unparsedClauses).toEqual([]);
    expect(result.criteria.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 150_000_000, label: '成交额高于 1.5亿元' },
      { value: 80_000_000, label: '成交额不低于 8000万元' },
    ]);
  });
});

describe('validateStockScreenCriteria', () => {
  const criterion = (overrides: Partial<StockScreenCriterion>): StockScreenCriterion => ({
    id: 'criterion-1',
    field: 'pe_ttm',
    operator: 'lte',
    value: 30,
    unit: null,
    label: '市盈率不超过 30',
    sourceField: '市盈率TTM',
    status: 'ready',
    ...overrides,
  });

  it('rejects incomplete, non-finite, and inverted range values', () => {
    const result = validateStockScreenCriteria([
      criterion({ id: 'missing', value: null, status: 'needs_input' }),
      criterion({ id: 'nan', value: Number.NaN }),
      criterion({ id: 'range', operator: 'between', value: [50, 10] }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { criterionId: 'missing', message: '请补充明确阈值' },
      { criterionId: 'nan', message: '阈值必须是有效数字' },
      { criterionId: 'range', message: '区间下限不能高于上限' },
    ]);
  });

  it('accepts ready boolean, scalar, and ordered range criteria', () => {
    expect(validateStockScreenCriteria([
      criterion({ id: 'st', field: 'exclude_st', operator: 'eq', value: true }),
      criterion({ id: 'pe', value: 30 }),
      criterion({ id: 'roe-range', field: 'roe', operator: 'between', value: [8, 15] }),
    ])).toEqual({ ok: true, errors: [] });
  });

  it('rebuilds display metadata from the field, operator, and value', () => {
    expect(canonicalStockScreenCriterion(criterion({
      field: 'roe',
      operator: 'gt',
      value: 12,
      unit: null,
      label: '立即买入',
      sourceField: '伪造字段',
    }))).toMatchObject({
      field: 'roe',
      operator: 'gt',
      value: 12,
      unit: '%',
      label: 'ROE高于 12%',
      sourceField: '净资产收益率',
    });
  });
});

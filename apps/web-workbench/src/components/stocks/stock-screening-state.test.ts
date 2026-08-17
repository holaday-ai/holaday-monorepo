import { describe, expect, it } from 'vitest';
import {
  canRunStockScreening,
  criterionStateLabel,
  groupScreeningCandidates,
  screeningCoverageCopy,
  updateNumericCriterionValue,
} from './stock-screening-state';

const criterion = {
  id: 'pe-1',
  field: 'pe_ttm',
  operator: 'lte' as const,
  value: 30,
  unit: null,
  label: '市盈率不超过 30',
  sourceField: '市盈率TTM',
  status: 'ready' as const,
};

describe('stock screening state', () => {
  it('requires current trust, snapshot id, data date, and fully specified criteria', () => {
    expect(canRunStockScreening([criterion], {
      snapshotId: 'stkshot_0123456789abcdef01234567',
      dataAsOf: '2026-08-17',
      trustMode: 'current',
    })).toBe(true);
    expect(canRunStockScreening([{ ...criterion, status: 'needs_input', value: null }], {
      snapshotId: 'stkshot_0123456789abcdef01234567',
      dataAsOf: '2026-08-17',
      trustMode: 'current',
    })).toBe(false);
    expect(canRunStockScreening([criterion], {
      snapshotId: 'stkshot_0123456789abcdef01234567',
      dataAsOf: '2026-08-17',
      trustMode: 'delayed',
    })).toBe(false);
    expect(canRunStockScreening([criterion], {
      snapshotId: '',
      dataAsOf: '2026-08-17',
      trustMode: 'current',
    })).toBe(false);
  });

  it('updates the numeric value and visible label without changing field or operator', () => {
    expect(updateNumericCriterionValue(
      { ...criterion, status: 'needs_input', value: null },
      '25.5',
    )).toEqual({
      ...criterion,
      value: 25.5,
      status: 'ready',
      label: '市盈率不超过 25.5',
    });
    expect(updateNumericCriterionValue(criterion, 'not-a-number')).toEqual({
      ...criterion,
      value: null,
      status: 'needs_input',
      label: '市盈率上限',
    });
  });

  it('uses explicit missing copy and never converts zero results into relaxed criteria', () => {
    expect(criterionStateLabel('missing')).toBe('缺少数据');
    const grouped = groupScreeningCandidates({
      zeroResult: true,
      candidates: [
        { symbol: '600001', unmetCriteria: [], missingCriteria: ['ROE 高于 10%'] },
        { symbol: '600002', unmetCriteria: ['资产负债率低于 50%'], missingCriteria: [] },
      ],
    });
    expect(grouped.exact).toEqual([]);
    expect(grouped.missing.map((item) => item.symbol)).toEqual(['600001']);
    expect(grouped.unmet.map((item) => item.symbol)).toEqual(['600002']);
  });

  it('states both full-market and deep-check coverage without hiding truncation', () => {
    expect(screeningCoverageCopy({
      universeCount: 5_213,
      marketPrefilterCount: 38,
      deepCheckedCount: 20,
      deepCheckLimit: 20,
      truncated: true,
    })).toBe('全市场 5,213 只 · 初筛 38 只 · 深查前 20 只（上限 20，只展示深查结果）');
  });
});

export type StockScreeningTrustMode = 'current' | 'delayed' | 'historical' | 'unavailable' | 'unverified';

export interface EditableStockScreenCriterion {
  id: string;
  field: string;
  operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
  value: boolean | number | [number, number] | null;
  unit: '%' | '元' | null;
  label: string;
  sourceField: string;
  status: 'ready' | 'needs_input';
}

export interface StockScreeningTrustInput {
  snapshotId: string | null;
  dataAsOf: string | null;
  trustMode: StockScreeningTrustMode;
}

export interface StockScreeningCoverage {
  universeCount: number;
  marketPrefilterCount: number;
  deepCheckedCount: number;
  deepCheckLimit: number;
  truncated: boolean;
}

export type StockCriterionState = 'matched' | 'unmet' | 'missing';

const FIELD_LABELS: Record<string, string> = {
  pe_ttm: '市盈率',
  pb: '市净率',
  turnover_ratio: '换手率',
  amount: '成交额',
  change_pct: '涨跌幅',
  debt_ratio: '资产负债率',
  roe: 'ROE',
  revenue_yoy: '营收同比',
  net_profit_yoy: '净利润同比',
};

const OPERATOR_LABELS: Record<EditableStockScreenCriterion['operator'], string> = {
  eq: '等于',
  gt: '高于',
  gte: '不低于',
  lt: '低于',
  lte: '不超过',
  between: '介于',
};

function numericCriterionLabel(
  criterion: EditableStockScreenCriterion,
  value: number | null,
): string {
  const fieldLabel = FIELD_LABELS[criterion.field] ?? criterion.sourceField;
  if (value === null) {
    const suffix = criterion.operator === 'lte' || criterion.operator === 'lt'
      ? '上限'
      : criterion.operator === 'gte' || criterion.operator === 'gt'
        ? '下限'
        : '阈值';
    return `${fieldLabel}${suffix}`;
  }
  const displayValue = criterion.field === 'amount' && Math.abs(value) >= 100_000_000
    ? `${Number((value / 100_000_000).toFixed(4))}亿元`
    : criterion.field === 'amount' && Math.abs(value) >= 10_000
      ? `${Number((value / 10_000).toFixed(4))}万元`
      : `${value}${criterion.unit ?? ''}`;
  return `${fieldLabel}${OPERATOR_LABELS[criterion.operator]} ${displayValue}`;
}

function criterionValueReady(value: EditableStockScreenCriterion['value']): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] <= value[1];
}

export function canRunStockScreening(
  criteria: EditableStockScreenCriterion[],
  trust: StockScreeningTrustInput,
): boolean {
  return (
    trust.trustMode === 'current' &&
    /^stkshot_[a-f0-9]{24}$/.test(trust.snapshotId ?? '') &&
    /^\d{4}-\d{2}-\d{2}$/.test(trust.dataAsOf ?? '') &&
    criteria.length > 0 &&
    criteria.length <= 20 &&
    criteria.every((criterion) =>
      criterion.status === 'ready' && criterionValueReady(criterion.value),
    )
  );
}

export function isStockScreeningResultCurrent(
  result: { snapshotId: string; dataAsOf: string },
  trust: StockScreeningTrustInput,
): boolean {
  return (
    trust.trustMode === 'current' &&
    result.snapshotId === trust.snapshotId &&
    result.dataAsOf === trust.dataAsOf
  );
}

export function updateNumericCriterionValue<T extends EditableStockScreenCriterion>(
  criterion: T,
  input: string,
): T {
  const value = Number(input.trim());
  const ready = input.trim().length > 0 && Number.isFinite(value);
  return {
    ...criterion,
    value: ready ? value : null,
    status: ready ? 'ready' : 'needs_input',
    label: numericCriterionLabel(criterion, ready ? value : null),
  };
}

export function criterionStateLabel(state: StockCriterionState): string {
  return {
    matched: '符合',
    unmet: '不符合',
    missing: '缺少数据',
  }[state];
}

export function screeningCoverageCopy(coverage: StockScreeningCoverage): string {
  const count = (value: number) => value.toLocaleString('zh-CN');
  const truncation = coverage.truncated
    ? `（上限 ${count(coverage.deepCheckLimit)}，只展示深查结果）`
    : '';
  return `全市场 ${count(coverage.universeCount)} 只 · 初筛 ${count(coverage.marketPrefilterCount)} 只 · 深查前 ${count(coverage.deepCheckedCount)} 只${truncation}`;
}

interface CandidateState {
  unmetCriteria: string[];
  missingCriteria: string[];
}

export function groupScreeningCandidates<T extends CandidateState>(result: {
  zeroResult: boolean;
  candidates: T[];
}): { exact: T[]; missing: T[]; unmet: T[] } {
  return {
    exact: result.candidates.filter(
      (candidate) => candidate.unmetCriteria.length === 0 && candidate.missingCriteria.length === 0,
    ),
    missing: result.candidates.filter(
      (candidate) => candidate.unmetCriteria.length === 0 && candidate.missingCriteria.length > 0,
    ),
    unmet: result.candidates.filter((candidate) => candidate.unmetCriteria.length > 0),
  };
}

export type StockScreenField =
  | 'exclude_st'
  | 'pe_ttm'
  | 'pb'
  | 'turnover_ratio'
  | 'amount'
  | 'change_pct'
  | 'net_profit_3y_positive'
  | 'debt_ratio'
  | 'roe'
  | 'revenue_yoy'
  | 'net_profit_yoy'
  | 'insider_reduction_recent';

export type StockScreenOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';

export interface StockScreenCriterion {
  id: string;
  field: StockScreenField;
  operator: StockScreenOperator;
  value: boolean | number | [number, number] | null;
  unit: '%' | '元' | null;
  label: string;
  sourceField: string;
  status: 'ready' | 'needs_input';
}

export interface StockScreenCriteriaValidation {
  ok: boolean;
  errors: Array<{ criterionId: string; message: string }>;
}

type CriterionDraft = Omit<StockScreenCriterion, 'id'>;

const FIELD_META: Record<
  StockScreenField,
  { label: string; sourceField: string; unit: StockScreenCriterion['unit'] }
> = {
  exclude_st: { label: '排除 ST', sourceField: '名称', unit: null },
  pe_ttm: { label: '市盈率', sourceField: '市盈率TTM', unit: null },
  pb: { label: '市净率', sourceField: '市净率', unit: null },
  turnover_ratio: { label: '换手率', sourceField: '换手率', unit: '%' },
  amount: { label: '成交额', sourceField: '成交额', unit: '元' },
  change_pct: { label: '涨跌幅', sourceField: '涨跌幅', unit: '%' },
  net_profit_3y_positive: {
    label: '近三年持续盈利',
    sourceField: '近3年净利润',
    unit: null,
  },
  debt_ratio: { label: '资产负债率', sourceField: '资产负债率', unit: '%' },
  roe: { label: 'ROE', sourceField: '净资产收益率', unit: '%' },
  revenue_yoy: { label: '营收同比', sourceField: '营业总收入同比增长率', unit: '%' },
  net_profit_yoy: { label: '净利润同比', sourceField: '净利润同比增长率', unit: '%' },
  insider_reduction_recent: {
    label: '近期内部人减持',
    sourceField: '董监高持股变动',
    unit: null,
  },
};

function numericOperator(clause: string): StockScreenOperator | null {
  if (/不超过|不高于|小于等于|最多|上限/.test(clause)) return 'lte';
  if (/不少于|不低于|大于等于|至少/.test(clause)) return 'gte';
  if (/低于|小于/.test(clause)) return 'lt';
  if (/高于|大于/.test(clause)) return 'gt';
  return null;
}

function numericValue(clause: string, field: StockScreenField): number | null {
  const match = clause.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let value = Number(match[0]);
  if (field === 'amount') {
    if (/亿(?:元)?/.test(clause)) value *= 100_000_000;
    else if (/万(?:元)?/.test(clause)) value *= 10_000;
  }
  return Number.isFinite(value) ? value : null;
}

function formattedValue(
  field: StockScreenField,
  value: number,
  unit: StockScreenCriterion['unit'],
): string {
  if (field === 'amount') {
    if (Math.abs(value) >= 100_000_000) {
      return `${Number((value / 100_000_000).toFixed(4))}亿元`;
    }
    if (Math.abs(value) >= 10_000) {
      return `${Number((value / 10_000).toFixed(4))}万元`;
    }
  }
  return `${value}${unit ?? ''}`;
}

function numericCriterion(
  clause: string,
  field: StockScreenField,
  qualitative = false,
): CriterionDraft | null {
  const meta = FIELD_META[field];
  const operator = numericOperator(clause);
  const value = numericValue(clause, field);
  if (operator && value !== null) {
    return {
      field,
      operator,
      value,
      unit: meta.unit,
      label: `${meta.label}${operatorLabel(operator)} ${formattedValue(field, value, meta.unit)}`,
      sourceField: meta.sourceField,
      status: 'ready',
    };
  }
  if (qualitative) {
    return {
      field,
      operator: 'lte',
      value: null,
      unit: meta.unit,
      label: `${meta.label}上限`,
      sourceField: meta.sourceField,
      status: 'needs_input',
    };
  }
  return null;
}

function operatorLabel(operator: StockScreenOperator): string {
  return {
    eq: '等于',
    gt: '高于',
    gte: '不低于',
    lt: '低于',
    lte: '不超过',
    between: '介于',
  }[operator];
}

export function canonicalStockScreenCriterion(
  criterion: StockScreenCriterion,
): StockScreenCriterion {
  const meta = FIELD_META[criterion.field];
  let label: string;
  if (criterion.status === 'needs_input' || criterion.value === null) {
    const suffix = criterion.operator === 'lte' || criterion.operator === 'lt'
      ? '上限'
      : criterion.operator === 'gte' || criterion.operator === 'gt'
        ? '下限'
        : '阈值';
    label = `${meta.label}${suffix}`;
  } else if (criterion.field === 'exclude_st') {
    label = criterion.value === true ? '排除 ST' : '不排除 ST';
  } else if (criterion.field === 'net_profit_3y_positive') {
    label = criterion.value === true ? '近三年持续盈利' : '近三年并非持续盈利';
  } else if (criterion.field === 'insider_reduction_recent') {
    label = criterion.value === false ? '近期无内部人减持' : '近期有内部人减持';
  } else if (criterion.operator === 'between' && Array.isArray(criterion.value)) {
    label = `${meta.label}介于 ${formattedValue(criterion.field, criterion.value[0], meta.unit)}–${formattedValue(criterion.field, criterion.value[1], meta.unit)}`;
  } else {
    label = `${meta.label}${operatorLabel(criterion.operator)} ${formattedValue(criterion.field, criterion.value as number, meta.unit)}`;
  }
  return {
    ...criterion,
    unit: meta.unit,
    label,
    sourceField: meta.sourceField,
  };
}

function parseClause(clause: string): CriterionDraft[] {
  if (/^(?:请)?(?:排除|不要)\s*\*?ST(?:股|股票)?$/i.test(clause)) {
    const meta = FIELD_META.exclude_st;
    return [{
      field: 'exclude_st',
      operator: 'eq',
      value: true,
      unit: meta.unit,
      label: meta.label,
      sourceField: meta.sourceField,
      status: 'ready',
    }];
  }

  if (/近?三年.*(?:持续盈利|净利润.*(?:为正|大于零))|连续三年.*盈利/.test(clause)) {
    const meta = FIELD_META.net_profit_3y_positive;
    return [{
      field: 'net_profit_3y_positive',
      operator: 'eq',
      value: true,
      unit: meta.unit,
      label: meta.label,
      sourceField: meta.sourceField,
      status: 'ready',
    }];
  }

  if (/(?:近期|最近).*(?:无|没有|排除).*减持|排除.*(?:近期|最近).*减持/.test(clause)) {
    const meta = FIELD_META.insider_reduction_recent;
    return [{
      field: 'insider_reduction_recent',
      operator: 'eq',
      value: false,
      unit: meta.unit,
      label: '近期无内部人减持',
      sourceField: meta.sourceField,
      status: 'ready',
    }];
  }

  const field = (() => {
    if (/资产负债率/.test(clause)) return 'debt_ratio' as const;
    if (/净资产收益率|ROE/i.test(clause)) return 'roe' as const;
    if (/营业总收入同比|营收同比/.test(clause)) return 'revenue_yoy' as const;
    if (/净利润同比/.test(clause)) return 'net_profit_yoy' as const;
    if (/换手率/.test(clause)) return 'turnover_ratio' as const;
    if (/成交额/.test(clause)) return 'amount' as const;
    if (/涨跌幅/.test(clause)) return 'change_pct' as const;
    if (/市盈率|\bPE\b/i.test(clause)) return 'pe_ttm' as const;
    if (/市净率|\bPB\b/i.test(clause)) return 'pb' as const;
    return null;
  })();
  if (!field) return [];

  const qualitative = field === 'pe_ttm' && /不过高|不要太高|合理/.test(clause);
  const parsed = numericCriterion(clause, field, qualitative);
  return parsed ? [parsed] : [];
}

function criterionKey(criterion: CriterionDraft): string {
  return JSON.stringify([
    criterion.field,
    criterion.operator,
    criterion.value,
    criterion.unit,
    criterion.status,
  ]);
}

export function parseStockScreenPrompt(prompt: string): {
  criteria: StockScreenCriterion[];
  unparsedClauses: string[];
} {
  const clauses = prompt
    .split(/[，,；;。\n]+|并且|以及|且|和/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const drafts: CriterionDraft[] = [];
  const unparsedClauses: string[] = [];
  const seen = new Set<string>();

  for (const clause of clauses) {
    const parsed = parseClause(clause);
    if (parsed.length === 0) {
      unparsedClauses.push(clause);
      continue;
    }
    for (const criterion of parsed) {
      const key = criterionKey(criterion);
      if (seen.has(key)) continue;
      seen.add(key);
      drafts.push(criterion);
    }
  }

  return {
    criteria: drafts.map((criterion, index) => canonicalStockScreenCriterion({
      ...criterion,
      id: `${criterion.field}-${index + 1}`,
    })),
    unparsedClauses,
  };
}

export function validateStockScreenCriteria(
  criteria: StockScreenCriterion[],
): StockScreenCriteriaValidation {
  const errors: StockScreenCriteriaValidation['errors'] = [];
  for (const criterion of criteria) {
    if (criterion.status !== 'ready' || criterion.value === null) {
      errors.push({ criterionId: criterion.id, message: '请补充明确阈值' });
      continue;
    }
    if (criterion.operator === 'between') {
      if (
        !Array.isArray(criterion.value) ||
        criterion.value.length !== 2 ||
        !criterion.value.every(Number.isFinite)
      ) {
        errors.push({ criterionId: criterion.id, message: '区间必须包含两个有效数字' });
      } else if (criterion.value[0] > criterion.value[1]) {
        errors.push({ criterionId: criterion.id, message: '区间下限不能高于上限' });
      }
      continue;
    }
    if (typeof criterion.value === 'number' && !Number.isFinite(criterion.value)) {
      errors.push({ criterionId: criterion.id, message: '阈值必须是有效数字' });
    }
  }
  return { ok: errors.length === 0, errors };
}

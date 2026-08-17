import { describe, expect, it } from 'vitest';
import type {
  AkEnvelope,
  AnnouncementRow,
  ForecastRow,
  FundamentalsRow,
  GoodwillRow,
  InsiderChangeRow,
  PledgeRow,
  StockScreeningUniverseRow,
  ValuationRow,
} from '../agent/a-share/briefing-types.js';
import type { StockScreenCriterion } from './screening-criteria.js';
import {
  runStockScreening,
  type StockScreeningClient,
} from './stock-screening-service.js';

const DISCLAIMER = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

function envelope<T>(
  data: T[],
  source: string,
  extras: Partial<AkEnvelope<T>> = {},
): AkEnvelope<T> {
  return {
    data,
    count: data.length,
    source,
    fetched_at: '2026-08-17T02:05:00.000Z',
    disclaimer: DISCLAIMER,
    ...extras,
  };
}

function criterion(
  id: string,
  field: StockScreenCriterion['field'],
  operator: StockScreenCriterion['operator'],
  value: StockScreenCriterion['value'],
  label: string,
): StockScreenCriterion {
  return {
    id,
    field,
    operator,
    value,
    unit: ['debt_ratio', 'roe', 'turnover_ratio', 'change_pct'].includes(field) ? '%' : null,
    label,
    sourceField: field,
    status: 'ready',
  };
}

function marketRow(
  code: string,
  overrides: Partial<StockScreeningUniverseRow> = {},
): StockScreeningUniverseRow {
  return {
    代码: code,
    名称: `股票${code}`,
    最新价: 10,
    涨跌幅: 1,
    成交额: 100_000_000 - Number(code.slice(-2)),
    换手率: 2,
    市盈率TTM: 20,
    市净率: 2,
    行情时间: '10:05:00',
    ...overrides,
  };
}

function clientWith(
  universe: StockScreeningUniverseRow[],
  overrides: Partial<StockScreeningClient> = {},
): StockScreeningClient {
  return {
    getScreeningUniverse: async () => envelope(universe, 'sina:screening'),
    getFundamentals: async () => envelope<FundamentalsRow>([{
      report_period: '2026-06-30',
      debt_ratio: 40,
      roe: 12,
      revenue_yoy: 8,
      net_profit_yoy: 9,
      net_profit: 100,
      eps_basic: 1,
      trend3y: [
        { report_period: '2023-12-31', net_profit: 80 },
        { report_period: '2024-12-31', net_profit: 90 },
        { report_period: '2025-12-31', net_profit: 100 },
      ],
    }], 'akshare:fundamentals'),
    getValuation: async () => envelope<ValuationRow>([{
      pe_ttm: 20,
      pb: 2,
      as_of: '2026-08-17',
    }], 'akshare:valuation'),
    getRiskPledge: async () => envelope<PledgeRow>([], 'akshare:pledge'),
    getRiskGoodwill: async () => envelope<GoodwillRow>([], 'akshare:goodwill'),
    getRiskForecast: async () => envelope<ForecastRow>([], 'akshare:forecast'),
    getRiskInsider: async () => envelope<InsiderChangeRow>([], 'akshare:insider'),
    getStockAnnouncements: async () => envelope<AnnouncementRow>([], 'akshare:announcements'),
    ...overrides,
  };
}

describe('runStockScreening', () => {
  it('applies market criteria before deep fetch and never deep-checks rejected rows', async () => {
    const deepSymbols: string[] = [];
    const client = clientWith([
      marketRow('600001', { 名称: 'ST示例', 市盈率TTM: 10 }),
      marketRow('600002', { 市盈率TTM: 45 }),
      marketRow('600003', { 市盈率TTM: 18 }),
    ], {
      getFundamentals: async (symbol) => {
        deepSymbols.push(symbol);
        return envelope<FundamentalsRow>([{ debt_ratio: 40 }], 'akshare:fundamentals');
      },
    });

    const result = await runStockScreening({
      client,
      snapshotId: 'stkshot_current',
      dataAsOf: '2026-08-17',
      criteria: [
        criterion('st', 'exclude_st', 'eq', true, '排除 ST'),
        criterion('pe', 'pe_ttm', 'lte', 30, '市盈率不超过 30'),
      ],
    });

    expect(result.coverage).toEqual({
      universeCount: 3,
      marketPrefilterCount: 1,
      deepCheckedCount: 1,
      deepCheckLimit: 20,
      truncated: false,
    });
    expect(deepSymbols).toEqual(['600003']);
    expect(result.candidates[0]).toMatchObject({
      symbol: '600003',
      matchedCriteria: ['排除 ST', '市盈率不超过 30'],
      unmetCriteria: [],
      missingCriteria: [],
    });
    expect(result.zeroResult).toBe(false);
  });

  it('limits deep checks to 20 and runs no more than four candidates concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const client = clientWith(
      Array.from({ length: 23 }, (_, index) => marketRow(String(600100 + index))),
      {
        getFundamentals: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return envelope<FundamentalsRow>([{
            debt_ratio: 40,
            trend3y: [
              { net_profit: 1 },
              { net_profit: 1 },
              { net_profit: 1 },
            ],
          }], 'akshare:fundamentals');
        },
      },
    );

    const result = await runStockScreening({
      client,
      snapshotId: 'stkshot_current',
      dataAsOf: '2026-08-17',
      criteria: [criterion('profit', 'net_profit_3y_positive', 'eq', true, '近三年持续盈利')],
    });

    expect(result.coverage).toEqual({
      universeCount: 23,
      marketPrefilterCount: 23,
      deepCheckedCount: 20,
      deepCheckLimit: 20,
      truncated: true,
    });
    expect(result.candidates).toHaveLength(20);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('treats absent deep facts as missing and keeps zero exact matches without relaxing criteria', async () => {
    const client = clientWith([marketRow('600010')], {
      getFundamentals: async () => envelope<FundamentalsRow>([{
        debt_ratio: null,
        trend3y: [{ net_profit: 1 }, { net_profit: -1 }, { net_profit: 1 }],
      }], 'akshare:fundamentals'),
    });

    const result = await runStockScreening({
      client,
      snapshotId: 'stkshot_current',
      dataAsOf: '2026-08-17',
      criteria: [
        criterion('debt', 'debt_ratio', 'lt', 50, '资产负债率低于 50%'),
        criterion('profit', 'net_profit_3y_positive', 'eq', true, '近三年持续盈利'),
      ],
    });

    expect(result.zeroResult).toBe(true);
    expect(result.candidates[0]).toMatchObject({
      matchedCriteria: [],
      unmetCriteria: ['近三年持续盈利'],
      missingCriteria: ['资产负债率低于 50%'],
    });
  });

  it('surfaces deterministic reduction warnings without recommendation language', async () => {
    const client = clientWith([marketRow('600020')], {
      getRiskInsider: async () => envelope<InsiderChangeRow>([
        { 变动数: -1_000_000, 变动日期: '2026-08-01', 变动原因: '个人资金安排' },
      ], 'akshare:stock_share_hold_change_sse'),
    });

    const result = await runStockScreening({
      client,
      snapshotId: 'stkshot_current',
      dataAsOf: '2026-08-17',
      criteria: [
        criterion('reduction', 'insider_reduction_recent', 'eq', false, '近期无内部人减持'),
      ],
    });

    expect(result.zeroResult).toBe(true);
    expect(result.candidates[0]?.unmetCriteria).toEqual(['近期无内部人减持']);
    expect(result.candidates[0]?.warnings).toMatchObject([
      {
        key: 'insider',
        severity: '关注',
        label: '减持',
        source: 'akshare:stock_share_hold_change_sse',
        asOf: '2026-08-01',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/买入|卖出|持有|目标价|推荐指数|最值得买/);
  });

  it('sorts complete matches before missing and unmet candidates, then by amount', async () => {
    const rows = [
      marketRow('600031', { 成交额: 300 }),
      marketRow('600032', { 成交额: 200 }),
      marketRow('600033', { 成交额: 100 }),
    ];
    const client = clientWith(rows, {
      getFundamentals: async (symbol) => {
        if (symbol === '600031') return envelope<FundamentalsRow>([{ debt_ratio: null }], 'f');
        if (symbol === '600032') return envelope<FundamentalsRow>([{ debt_ratio: 60 }], 'f');
        return envelope<FundamentalsRow>([{ debt_ratio: 40 }], 'f');
      },
    });

    const result = await runStockScreening({
      client,
      snapshotId: 'stkshot_current',
      dataAsOf: '2026-08-17',
      criteria: [criterion('debt', 'debt_ratio', 'lt', 50, '资产负债率低于 50%')],
    });

    expect(result.candidates.map((candidate) => candidate.symbol)).toEqual([
      '600033',
      '600031',
      '600032',
    ]);
  });
});

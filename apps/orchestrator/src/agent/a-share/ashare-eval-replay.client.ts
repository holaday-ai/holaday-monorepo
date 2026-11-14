/**
 * 批次 10.5 — A股回放用的固化行情 client（迪生力数值沿用仓库 E19 固化样本；E01 收盘取基准
 * 文档实测）。离线回放与 ⑦ 千问真机冒烟共用；不发网络。
 */
import type { AkshareClient } from './akshare-client.js';

export const REPLAY_NOW = new Date('2026-06-15T07:00:00Z');

function env<T>(data: T[]) {
  return {
    data,
    count: data.length,
    source: 'replay',
    fetched_at: REPLAY_NOW.toISOString(),
    disclaimer: 'x',
  };
}
const KLINE_BY_SYMBOL: Record<string, { 收盘: number; 涨跌幅: number; 成交额: number }> = {
  '603335': { 收盘: 8.05, 涨跌幅: 9.97, 成交额: 512_000_000 },
};
export function replayClient(): AkshareClient {
  return {
    getIndexQuote: () =>
      Promise.resolve(
        env([
          { 名称: '上证指数', 最新价: 3400.12, 涨跌幅: 0.5 },
          { 名称: '深证成指', 最新价: 10500.3, 涨跌幅: -0.2 },
          { 名称: '创业板指', 最新价: 2100.8, 涨跌幅: 0.1 },
        ]),
      ),
    getStockAnnouncements: () =>
      Promise.resolve(env([{ 公告标题: '2025年度股东会决议公告', 公告时间: '2026-06-12' }])),
    getShareUnlock: () => Promise.resolve(env([])),
    getStockKline: (symbol: string, days?: number) =>
      days && days > 0
        ? Promise.resolve(env([]))
        : Promise.resolve(
            env([KLINE_BY_SYMBOL[symbol] ?? { 收盘: 12.34, 涨跌幅: 1.01, 成交额: 6_478_000_000 }]),
          ),
    getStockQuote: () => Promise.resolve(env([])),
    getDragonTiger: () => Promise.resolve(env([])),
    getNorthboundFlow: () => Promise.resolve(env([])),
    getTradingDay: () => Promise.resolve(env([{ is_trading_day: true }])),
    searchSymbol: () => Promise.resolve(env([])),
    getFundamentals: () =>
      Promise.resolve(
        env([
          {
            report_period: '2026-03-31',
            revenue: 1.71e8,
            revenue_yoy: -33.43,
            revenue_qoq: -12.5,
            net_profit: -1.98172e7,
            net_profit_yoy: 12.4,
            net_profit_qoq: -122.75,
            deduct_net_profit: -1.98452e7,
            deduct_net_profit_yoy: 12.17,
            gross_margin: 18.48,
            net_margin: -14.31,
            roe: -6.76,
            debt_ratio: 64.65,
            ocf_per_share: 0.03,
            eps_basic: -0.16,
            gross_margin_yoy: -2.21,
            trend3y: [
              { report_period: '2023-12-31', net_profit: -1.49e8 },
              { report_period: '2024-12-31', net_profit: -1.45e8 },
              { report_period: '2025-12-31', net_profit: 4.848e7 },
            ],
          },
        ]),
      ),
    getValuation: () =>
      Promise.resolve(
        env([
          {
            pe_ttm: 67.2,
            pb: 12.21,
            pe_pctile_5y: 87.1,
            pb_pctile_5y: 95.1,
            as_of: '2026-06-14',
            total_mv_yi: 34.47,
            industry: '汽车制造业',
            industry_pe_median: 31.63,
          },
        ]),
      ),
    // biome-ignore lint/suspicious/noExplicitAny: partial fake client
  } as any;
}

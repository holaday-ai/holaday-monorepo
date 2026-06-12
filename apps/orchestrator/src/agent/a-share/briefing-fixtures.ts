/**
 * Phase 1 指令 #2 ③ — 简报渲染示例数据（用于 v1 内容评审 + 单测）.
 *
 * ⚠️ 全部为「示例数据」，非实时行情。形状镜像 AkShare 工具 envelope，
 * 数值为合理虚构，仅供 BOSS + Claude 评审简报「内容/版式/合规」之用。
 * 真接 MCP 后由工具实时返回替换。
 *
 * 示例自选股：贵州茅台(600519) / 宁德时代(300750) / 平安银行(000001)。
 */

import type {
  PostmarketBriefingInput,
  PremarketBriefingInput,
  WatchlistEntry,
} from './briefing-types.js';

const DISCLAIMER = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

const WATCHLIST: WatchlistEntry[] = [
  { symbol: '600519', market: 'A', displayName: '贵州茅台' },
  { symbol: '300750', market: 'A', displayName: '宁德时代' },
  { symbol: '000001', market: 'A', displayName: '平安银行' },
];

export const PREMARKET_SAMPLE: PremarketBriefingInput = {
  date: '2026-06-11',
  generatedAt: '2026-06-11T00:30:00Z', // 北京 08:30
  watchlist: WATCHLIST,
  indexUs: {
    data: [
      { 名称: '标普500', 代码: '.INX', 收盘: 5433.21, 涨跌幅: 0.62, 日期: '2026-06-10' },
      { 名称: '道琼斯', 代码: '.DJI', 收盘: 39200.0, 涨跌幅: 0.51, 日期: '2026-06-10' },
      { 名称: '纳斯达克', 代码: '.IXIC', 收盘: 17050.3, 涨跌幅: 0.85, 日期: '2026-06-10' },
    ],
    count: 3,
    source: 'akshare:index_us_stock_sina(.INX/.DJI/.IXIC,末2行)',
    fetched_at: '2026-06-11T00:25:00Z',
    disclaimer: DISCLAIMER,
  },
  indexHk: {
    data: [
      { 代码: 'HSI', 名称: '恒生指数', 最新价: 18_756.4, 涨跌幅: 0.92, 涨跌额: 171.2 },
      { 代码: 'HSCEI', 名称: '国企指数', 最新价: 6_654.1, 涨跌幅: 1.05, 涨跌额: 69.0 },
    ],
    count: 2,
    source: 'akshare:stock_hk_index_spot_em',
    fetched_at: '2026-06-11T00:25:00Z',
    disclaimer: DISCLAIMER,
  },
  announcements: {
    '600519': {
      data: [
        {
          代码: '600519',
          简称: '贵州茅台',
          公告标题: '贵州茅台2025年年度权益分派实施公告',
          公告时间: '2026-06-10 16:32',
          公告链接:
            'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=600519&announcementId=example1',
        },
        {
          代码: '600519',
          简称: '贵州茅台',
          公告标题: '贵州茅台关于召开2025年年度股东大会的通知',
          公告时间: '2026-06-09 17:10',
          公告链接:
            'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=600519&announcementId=example2',
        },
      ],
      count: 2,
      source: 'akshare:stock_zh_a_disclosure_report_cninfo',
      fetched_at: '2026-06-11T00:26:00Z',
      disclaimer: DISCLAIMER,
    },
    '300750': {
      data: [],
      count: 0,
      source: 'akshare:stock_zh_a_disclosure_report_cninfo',
      fetched_at: '2026-06-11T00:26:00Z',
      disclaimer: DISCLAIMER,
    },
    '000001': {
      data: [
        {
          代码: '000001',
          简称: '平安银行',
          公告标题: '平安银行关于部分董事离任的公告',
          公告时间: '2026-06-10 18:05',
          公告链接:
            'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=000001&announcementId=example3',
        },
      ],
      count: 1,
      source: 'akshare:stock_zh_a_disclosure_report_cninfo',
      fetched_at: '2026-06-11T00:26:00Z',
      disclaimer: DISCLAIMER,
    },
  },
  shareUnlock: {
    '600519': {
      data: [
        {
          解禁时间: '2026-06-20',
          解禁数量: 12_000_000,
          解禁股流通市值: 1_896_000_000,
          解禁股类型: '股权激励限售股份',
        },
      ],
      count: 1,
      source: 'akshare:stock_restricted_release_queue_em',
      fetched_at: '2026-06-11T00:27:00Z',
      disclaimer: DISCLAIMER,
    },
    '300750': {
      data: [],
      count: 0,
      source: 'akshare:stock_restricted_release_queue_em',
      fetched_at: '2026-06-11T00:27:00Z',
      disclaimer: DISCLAIMER,
    },
    '000001': {
      data: [],
      count: 0,
      source: 'akshare:stock_restricted_release_queue_em',
      fetched_at: '2026-06-11T00:27:00Z',
      disclaimer: DISCLAIMER,
    },
  },
  // 上一交易日龙虎榜（盘前回顾段；2026-06-11 盘前回顾 06-10 榜单）。
  dragonTigerDate: '2026-06-10',
  dragonTiger: {
    data: [
      {
        代码: '300750',
        名称: '宁德时代',
        上榜原因: '日跌幅偏离值达7%的证券',
        解读: '主力净卖出，机构现身卖方',
        收盘价: 198.5,
        涨跌幅: -0.85,
        龙虎榜净买额: 120_000_000,
        龙虎榜买入额: 580_000_000,
        龙虎榜卖出额: 460_000_000,
      },
      {
        代码: '601111',
        名称: '中国国航',
        上榜原因: '连续三个交易日内收盘价涨幅偏离值累计达20%',
        收盘价: 9.12,
        涨跌幅: 9.98,
        龙虎榜净买额: 230_000_000,
      },
    ],
    count: 2,
    source: 'akshare:stock_lhb_detail_em',
    fetched_at: '2026-06-11T00:27:00Z',
    disclaimer: DISCLAIMER,
  },
};

export const POSTMARKET_SAMPLE: PostmarketBriefingInput = {
  date: '2026-06-11',
  generatedAt: '2026-06-11T07:30:00Z', // 北京 15:30
  watchlist: WATCHLIST,
  indexCn: {
    data: [
      { 名称: '上证指数', 代码: 'sh000001', 最新价: 3125.4, 涨跌幅: 0.42, 成交额: 435_000_000_000 },
      { 名称: '深证成指', 代码: 'sz399001', 最新价: 9842.7, 涨跌幅: 0.18, 成交额: 380_000_000_000 },
      {
        名称: '创业板指',
        代码: 'sz399006',
        最新价: 1987.3,
        涨跌幅: -0.25,
        成交额: 160_000_000_000,
      },
    ],
    count: 3,
    source: 'akshare:stock_zh_index_spot_sina',
    fetched_at: '2026-06-11T07:25:00Z',
    disclaimer: DISCLAIMER,
  },
  northbound: {
    // 2024-08 后北向净买额停披露：北向(沪/深股通)=0.0，南向港股通仍有值。
    data: [
      { 交易日: '2026-06-11', 类型: '沪港通', 板块: '沪股通', 资金方向: '北向', 成交净买额: 0.0 },
      {
        交易日: '2026-06-11',
        类型: '沪港通',
        板块: '港股通(沪)',
        资金方向: '南向',
        成交净买额: -4.2,
      },
      { 交易日: '2026-06-11', 类型: '深港通', 板块: '深股通', 资金方向: '北向', 成交净买额: 0.0 },
      {
        交易日: '2026-06-11',
        类型: '深港通',
        板块: '港股通(深)',
        资金方向: '南向',
        成交净买额: -23.35,
      },
    ],
    count: 4,
    source: 'akshare:stock_hsgt_fund_flow_summary_em',
    fetched_at: '2026-06-11T07:25:00Z',
    disclaimer: DISCLAIMER,
  },
  dailyKline: {
    '600519': {
      data: [
        {
          日期: '2026-06-11',
          开盘: 1562.0,
          收盘: 1580.0,
          最高: 1585.5,
          最低: 1558.3,
          成交量: 2_417_000,
          成交额: 3_820_000_000,
          涨跌幅: 1.23,
        },
      ],
      count: 1,
      source: 'akshare:stock_zh_a_daily(sina,末2行算涨跌幅)',
      fetched_at: '2026-06-11T07:25:00Z',
      disclaimer: DISCLAIMER,
    },
    '300750': {
      data: [
        {
          日期: '2026-06-11',
          开盘: 200.5,
          收盘: 198.5,
          最高: 201.2,
          最低: 197.6,
          成交量: 20_640_000,
          成交额: 4_100_000_000,
          涨跌幅: -0.85,
        },
      ],
      count: 1,
      source: 'akshare:stock_zh_a_daily(sina,末2行算涨跌幅)',
      fetched_at: '2026-06-11T07:25:00Z',
      disclaimer: DISCLAIMER,
    },
    '000001': {
      data: [
        {
          日期: '2026-06-11',
          开盘: 11.25,
          收盘: 11.3,
          最高: 11.36,
          最低: 11.21,
          成交量: 106_000_000,
          成交额: 1_200_000_000,
          涨跌幅: 0.45,
        },
      ],
      count: 1,
      source: 'akshare:stock_zh_a_daily(sina,末2行算涨跌幅)',
      fetched_at: '2026-06-11T07:25:00Z',
      disclaimer: DISCLAIMER,
    },
  },
  announcements: {
    '600519': {
      data: [
        {
          代码: '600519',
          简称: '贵州茅台',
          公告标题: '贵州茅台2025年年度权益分派实施公告',
          公告时间: '2026-06-11 15:05',
          公告链接:
            'http://www.cninfo.com.cn/new/disclosure/detail?stockCode=600519&announcementId=example4',
        },
      ],
      count: 1,
      source: 'akshare:stock_zh_a_disclosure_report_cninfo',
      fetched_at: '2026-06-11T07:26:00Z',
      disclaimer: DISCLAIMER,
    },
    '300750': {
      data: [],
      count: 0,
      source: 'akshare:stock_zh_a_disclosure_report_cninfo',
      fetched_at: '2026-06-11T07:26:00Z',
      disclaimer: DISCLAIMER,
    },
    '000001': {
      data: [],
      count: 0,
      source: 'akshare:stock_zh_a_disclosure_report_cninfo',
      fetched_at: '2026-06-11T07:26:00Z',
      disclaimer: DISCLAIMER,
    },
  },
};

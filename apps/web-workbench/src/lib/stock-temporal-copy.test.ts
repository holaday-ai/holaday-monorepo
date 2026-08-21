import { describe, expect, it } from 'vitest';
import { stockSignalLabel, stockTemporalCopy } from './stock-temporal-copy';

describe('stock temporal copy', () => {
  it('uses historical language for an older trusted snapshot', () => {
    const copy = stockTemporalCopy('historical', '2026-08-11');

    expect(copy).toMatchObject({
      briefingTitle: '08/11 回看重点',
      briefingCommand: '基于 08/11 生成历史复盘',
      performanceLabel: '当日表现',
      priceLabel: '当日价格',
      opportunityTitle: '当时的关注点',
      opportunityEmpty: '暂无历史关注点',
      starTitle: '关注股票',
      starMeta: '08/11 回看',
    });
    expect(Object.values(copy).join(' ')).not.toMatch(/今日|最新|当前机会|现价|实时|强势/);
    expect(stockSignalLabel('强势', 'historical')).toBe('涨幅较高');
  });

  it('retains current wording only for a current snapshot', () => {
    expect(stockTemporalCopy('current', '2026-08-14')).toMatchObject({
      assistantStatus: '正在理解你的关注股票',
      briefingTitle: '今日关注日报',
      briefingCommand: '生成今日关注日报',
      performanceLabel: '当前表现',
      priceLabel: '最新价',
      opportunityTitle: '机会',
      starTitle: '明星股票',
      starMeta: '今日关注',
      promptPlaceholder: '今天想让 AI 帮你看什么？',
    });
    expect(stockSignalLabel('强势', 'current')).toBe('强势');
  });

  it('uses latest-trading-day language when the market is closed for a non-trading day', () => {
    const copy = stockTemporalCopy('current', '2026-08-21', 'non-trading');

    expect(copy).toMatchObject({
      assistantStatus: '休市中 · 基于 08/21 最新交易日快照',
      briefingTitle: '08/21 最新交易日简报',
      briefingCommand: '基于 08/21 生成交易日复盘',
      briefingTabLabel: '交易日简报',
      performanceLabel: '08/21 表现',
      priceLabel: '08/21 收盘价',
      opportunityTitle: '最新交易日关注点',
      starMeta: '08/21 收盘',
      storyTitleSuffix: ' 08/21 交易日发生了什么',
      storyStatusLabel: '休市 · 最新交易日已核验',
      updateLabel: '快照刷新',
      researchTimestampLabel: '08/21 行情',
      promptPlaceholder: '基于 08/21 最新交易日数据研究股票、市场或行业',
    });
    expect(Object.values(copy).join(' ')).not.toMatch(/今日|最新价|数据更新/);
  });

  it('uses previous-trading-day language before the market opens', () => {
    expect(stockTemporalCopy('current', '2026-08-21', 'preopen')).toMatchObject({
      assistantStatus: '开盘前 · 基于 08/21 最新交易日快照',
      storyStatusLabel: '开盘前 · 最新交易日已核验',
      updateLabel: '快照刷新',
    });
  });

  it('uses blocked neutral wording when no trustworthy numeric snapshot is available', () => {
    expect(stockTemporalCopy('unavailable', null)).toMatchObject({
      assistantStatus: '等待可信行情恢复',
      briefingTitle: '行情待恢复',
      briefingCommand: '等待可信行情',
      priceLabel: '价格待核验',
      opportunityTitle: '关注点待核验',
    });
  });
});

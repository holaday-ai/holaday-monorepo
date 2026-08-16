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
      briefingTitle: '今日关注日报',
      briefingCommand: '生成今日关注日报',
      performanceLabel: '当前表现',
      priceLabel: '最新价',
      opportunityTitle: '机会',
      starTitle: '明星股票',
      starMeta: '今日关注',
    });
    expect(stockSignalLabel('强势', 'current')).toBe('强势');
  });

  it('uses blocked neutral wording when no trustworthy numeric snapshot is available', () => {
    expect(stockTemporalCopy('unavailable', null)).toMatchObject({
      briefingTitle: '行情待恢复',
      briefingCommand: '等待可信行情',
      priceLabel: '价格待核验',
      opportunityTitle: '关注点待核验',
    });
  });
});

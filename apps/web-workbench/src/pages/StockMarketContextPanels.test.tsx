// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MarketTemperatureDetails,
  sectorTrendValues,
} from '@/components/stocks/StockMarketContextDetails';

afterEach(cleanup);

describe('stock market context panels', () => {
  it('turns the market pulse into scannable breadth, flow, and observation sections', () => {
    render(
      <MarketTemperatureDetails
        score={54}
        notes={['上涨 1646 家，下跌 3788 家。', '主力净流入 -1538.57 亿元。']}
      />,
    );

    expect(screen.getByText('市场广度')).toBeTruthy();
    expect(screen.getByText('上涨 1646 家，下跌 3788 家。')).toBeTruthy();
    expect(screen.getByRole('meter', { name: '上涨家数占比' }).getAttribute('aria-valuenow')).toBe('30.3');
    expect(screen.getByText('资金动向')).toBeTruthy();
    expect(screen.getByText('主力净流出 1538.57 亿元。')).toBeTruthy();
    expect(screen.getByText('今日观察')).toBeTruthy();
    expect(screen.getByText('上涨占比 30.3% · 多空相对均衡，关注个股分化')).toBeTruthy();
  });

  it('returns no trend graphic data when no real trend series is available', () => {
    expect(sectorTrendValues([])).toBeNull();
    expect(sectorTrendValues([8.23])).toBeNull();
    expect(sectorTrendValues([8.1, 8.23])).toEqual([8.1, 8.23]);
  });
});

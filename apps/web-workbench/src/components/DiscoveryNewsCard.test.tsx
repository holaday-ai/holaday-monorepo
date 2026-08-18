// @vitest-environment happy-dom

import type { StockNewsRow } from '@/lib/stock-news';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryNewsCard } from './DiscoveryNewsCard';

afterEach(cleanup);

const NEWS_ITEM: StockNewsRow = {
  category: '新闻',
  feed: '自选股新闻',
  time: '08-18 10:30',
  publishedAt: '2026-08-18T01:30:00.000Z',
  title: '贵州茅台发布经营数据更新',
  symbols: ['SH600519'],
  source: '公开来源',
  summary: '公司披露最新经营数据，需结合正式公告继续核验。',
  url: 'https://example.com/news/600519',
};

describe('DiscoveryNewsCard', () => {
  it('labels only explicit watchlist relevance and remains keyboard activatable', async () => {
    const onOpen = vi.fn();
    const view = render(
      <DiscoveryNewsCard item={NEWS_ITEM} relatedToWatchlist={false} onOpen={onOpen} />,
    );
    expect(screen.queryByText('与你的关注相关')).toBeNull();

    view.rerender(<DiscoveryNewsCard item={NEWS_ITEM} relatedToWatchlist={true} onOpen={onOpen} />);
    expect(screen.getByText('与你的关注相关')).toBeTruthy();

    const card = screen.getByRole('button', { name: /贵州茅台发布经营数据更新/ });
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

import { discoveryTimeLabel } from '@/lib/stock-discovery';

export type DiscoveryFeed = '自选股新闻' | '重要公告' | 'A股要闻' | '美股要闻' | '港股要闻';

export interface StockNewsRow {
  category?: '公告' | '新闻' | '盘面' | '关注';
  feed?: DiscoveryFeed;
  time: string;
  publishedAt?: string;
  title: string;
  symbols: string[];
  source?: string;
  url?: string;
  summary?: string;
  imageUrl?: string;
  imageKind?: 'source-cover' | 'editorial-art';
  editorialArtOptions?: string[];
}

export function newsDisplayType(item: StockNewsRow): '新闻' | '公告' {
  return item.category === '公告' ? '公告' : '新闻';
}

export function newsFeed(item: StockNewsRow): DiscoveryFeed {
  if (item.feed) return item.feed;
  return newsDisplayType(item) === '公告' ? '重要公告' : '自选股新闻';
}

export function newsTimeLabel(item: StockNewsRow): string {
  return discoveryTimeLabel(newsDisplayType(item), item.time);
}

export function mergeDiscoveryNews(base: StockNewsRow[], additions: StockNewsRow[]): StockNewsRow[] {
  const seen = new Set<string>();
  return [...base, ...additions].filter((item) => {
    const key = item.url?.trim() || `${newsFeed(item)}:${item.time}:${item.title.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

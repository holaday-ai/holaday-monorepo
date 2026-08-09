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

function marketHeadlineFingerprint(item: StockNewsRow): string | undefined {
  const feed = newsFeed(item);
  if (feed !== 'A股要闻' && feed !== '美股要闻' && feed !== '港股要闻') return undefined;
  const title = item.title
    .replace(/^\s*(?:国家统计局|国家发改委|中国人民银行|中国证监会|财政部|海关总署|商务部|工信部|新华社|央视财经|人民日报|经济日报)\s*[：:]/, '')
    .replace(/(?:19|20)\d{2}年/g, '')
    .replace(/\s+/g, '')
    .replace(/[：:，,。.!！?？、【】\[\]（）()「」『』]/g, '')
    .toLocaleLowerCase('zh-CN');
  return title ? `${item.category ?? '新闻'}:${feed}:${title}` : undefined;
}

export function mergeDiscoveryNews(base: StockNewsRow[], additions: StockNewsRow[]): StockNewsRow[] {
  const seen = new Set<string>();
  return [...base, ...additions].filter((item) => {
    const key = item.url?.trim() || `${newsFeed(item)}:${item.time}:${item.title.trim()}`;
    const headlineKey = marketHeadlineFingerprint(item);
    if (seen.has(key) || (headlineKey && seen.has(headlineKey))) return false;
    seen.add(key);
    if (headlineKey) seen.add(headlineKey);
    return true;
  });
}

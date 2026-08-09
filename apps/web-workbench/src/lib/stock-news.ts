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

function normalizedHeadline(item: StockNewsRow): string | undefined {
  const feed = newsFeed(item);
  if (feed !== 'A股要闻' && feed !== '美股要闻' && feed !== '港股要闻') return undefined;
  const title = item.title
    .replace(/^\s*[^：:]{2,16}\s*[：:]/, '')
    .replace(/(?:19|20)\d{2}年/g, '')
    .replace(/\s+/g, '')
    .replace(/[：:，,。.!！?？、【】\[\]（）()「」『』“”‘’]/g, '')
    .replace(/的/g, '')
    .toLocaleLowerCase('zh-CN');
  return title || undefined;
}

function samePublicationDay(left: StockNewsRow, right: StockNewsRow): boolean {
  const day = (item: StockNewsRow) => item.publishedAt?.slice(0, 10) ?? item.time.slice(0, 5);
  return day(left) === day(right);
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

function likelySameMarketStory(left: StockNewsRow, right: StockNewsRow): boolean {
  if (newsFeed(left) !== newsFeed(right) || !samePublicationDay(left, right)) return false;
  const leftHeadline = normalizedHeadline(left);
  const rightHeadline = normalizedHeadline(right);
  if (!leftHeadline || !rightHeadline) return false;
  const numbers = (value: string) => value.match(/\d+(?:\.\d+)?%?/g)?.join('|') ?? '';
  if (numbers(leftHeadline) !== numbers(rightHeadline)) return false;
  if (leftHeadline === rightHeadline) return true;
  const shorter = leftHeadline.length <= rightHeadline.length ? leftHeadline : rightHeadline;
  const longer = shorter === leftHeadline ? rightHeadline : leftHeadline;
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.72) return true;
  const leftBigrams = bigrams(leftHeadline);
  const rightBigrams = bigrams(rightHeadline);
  let shared = 0;
  for (const token of leftBigrams) if (rightBigrams.has(token)) shared += 1;
  return shared * 2 / (leftBigrams.size + rightBigrams.size) >= 0.82;
}

export function mergeDiscoveryNews(base: StockNewsRow[], additions: StockNewsRow[]): StockNewsRow[] {
  const seenKeys = new Set<string>();
  const merged: StockNewsRow[] = [];
  for (const item of [...base, ...additions]) {
    const key = item.url?.trim() || `${newsFeed(item)}:${item.time}:${item.title.trim()}`;
    if (seenKeys.has(key) || merged.some((candidate) => likelySameMarketStory(candidate, item))) continue;
    seenKeys.add(key);
    merged.push(item);
  }
  return merged;
}

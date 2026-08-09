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
    .replace(/^\s*(?:业绩快报|快讯|公告|机构观点|券商观点)\s*[：:]/, '')
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
  if (leftHeadline === rightHeadline) return true;
  const numbers = (value: string) => new Set(value.match(/\d+(?:\.\d+)?%?/g) ?? []);
  const leftNumbers = numbers(leftHeadline);
  const rightNumbers = numbers(rightHeadline);
  if (leftNumbers.size > 0 && rightNumbers.size > 0 && (
    leftNumbers.size !== rightNumbers.size || [...leftNumbers].some((token) => !rightNumbers.has(token))
  )) {
    return false;
  }
  const shorter = leftHeadline.length <= rightHeadline.length ? leftHeadline : rightHeadline;
  const longer = shorter === leftHeadline ? rightHeadline : leftHeadline;
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.65) return true;
  const anchors = (value: string) => new Set([
    ...(value.match(/[a-z]+\d*|\d+(?:\.\d+)?%/g) ?? []).filter((token) => token.length >= 2),
  ]);
  const leftAnchors = anchors(leftHeadline);
  const rightAnchors = anchors(rightHeadline);
  const hasSharedAnchor = [...leftAnchors].some((token) => rightAnchors.has(token));
  const leftBigrams = bigrams(leftHeadline);
  const rightBigrams = bigrams(rightHeadline);
  let shared = 0;
  for (const token of leftBigrams) if (rightBigrams.has(token)) shared += 1;
  const similarity = shared * 2 / (leftBigrams.size + rightBigrams.size);
  return similarity >= 0.72 || (shared >= 8 && similarity >= 0.5) || (hasSharedAnchor && similarity >= 0.54);
}

const MARKET_TOPIC_TOKENS = [
  'cpo', 'ipo', 'ai', '半导体', '芯片', '算力', '机器人', '医药', '医疗', '创新药',
  '新能源', '光伏', '储能', '电力', '汽车', '有色', '黄金', '消费', '物价', '房地产',
  '银行', '证券', '保险', '港股', '美股', '人民币', '关税', '外贸',
] as const;

/** A visual-order key, not a fact label: it keeps adjacent cards from repeating one company or topic. */
export function discoveryStoryClusterKey(item: StockNewsRow): string | undefined {
  const symbol = item.symbols[0]?.trim();
  if (symbol) return symbol;
  const title = item.title.trim();
  const prefix = /^([^：:]{2,16})[：:]/.exec(title)?.[1]?.trim();
  if (prefix && !/^(?:业绩快报|快讯|公告|机构观点|券商观点)$/.test(prefix)) return prefix;
  const lower = title.toLocaleLowerCase('zh-CN');
  const topic = MARKET_TOPIC_TOKENS.find((token) => lower.includes(token));
  if (topic) return topic;
  const leading = lower
    .replace(/^[“”'‘’"《【\[]+/, '')
    .replace(/^(?:这家|一则|突发|重磅|最新)/, '')
    .match(/[\u4e00-\u9fff]{2,8}/)?.[0];
  return leading ?? newsFeed(item);
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

export const DISCOVERY_FEEDS = [
  '自选股新闻',
  '重要公告',
  'A股要闻',
  '美股要闻',
  '港股要闻',
] as const;

export type DiscoveryFeed = (typeof DISCOVERY_FEEDS)[number];
export type DiscoveryFeedFilter = DiscoveryFeed | '全部';

export function parseDiscoveryFeed(search: string): DiscoveryFeedFilter {
  const feed = new URLSearchParams(search).get('feed');
  return DISCOVERY_FEEDS.includes(feed as DiscoveryFeed) ? feed as DiscoveryFeed : '全部';
}

export function discoveryFeedSearch(feed: DiscoveryFeedFilter): string {
  if (feed === '全部') return '';
  return `?${new URLSearchParams({ feed }).toString()}`;
}

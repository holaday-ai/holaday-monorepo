import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DiscoveryNewsCard } from '@/components/DiscoveryNewsCard';
import { NewsDetailModal } from '@/components/NewsDetailModal';
import { pageErrorMessage } from '@/lib/page-error-copy';
import {
  diversifyDiscoveryEditorialArt,
  prioritizeAndDiversifyDiscoveryItems,
  shouldPrefetchDiscoveryPage,
} from '@/lib/stock-discovery';
import {
  mergeDiscoveryNews,
  newsFeed,
  type DiscoveryFeed,
  type StockNewsRow,
} from '@/lib/stock-news';
import { parseDiscoveryFeed } from '@/lib/stock-discovery-route';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type DashboardSnapshot = Awaited<ReturnType<typeof trpc.stocks.dashboardSnapshot.query>>;
type MarketDiscoveryFeed = Extract<DiscoveryFeed, 'A股要闻' | '美股要闻' | '港股要闻'>;

const MARKET_DISCOVERY_FEEDS: MarketDiscoveryFeed[] = ['A股要闻', '美股要闻', '港股要闻'];
const FEEDS: Array<DiscoveryFeed | '全部'> = ['全部', '自选股新闻', '重要公告', 'A股要闻', '美股要闻', '港股要闻'];
const INITIAL_VISIBLE_COUNT = 12;

function discoveryReadingPriority(item: StockNewsRow): number {
  let score = 0;
  if (item.symbols.length > 0) score += 3;
  if (newsFeed(item) === '重要公告') score += 2;
  if (item.summary?.trim().length && item.summary.trim().length >= 80) score += 1;
  if (item.imageKind === 'source-cover') score += 1;
  return score;
}

export function StockDiscoveryPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeFeed = parseDiscoveryFeed(searchParams.toString());
  const [activeFeed, setActiveFeed] = React.useState<DiscoveryFeed | '全部'>(routeFeed);
  const [dashboard, setDashboard] = React.useState<DashboardSnapshot | null>(null);
  const [extensions, setExtensions] = React.useState<StockNewsRow[]>([]);
  const [moreAvailable, setMoreAvailable] = React.useState<Record<MarketDiscoveryFeed, boolean>>({
    'A股要闻': true,
    '美股要闻': true,
    '港股要闻': true,
  });
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_VISIBLE_COUNT);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [failedSourceCoverUrls, setFailedSourceCoverUrls] = React.useState<ReadonlySet<string>>(() => new Set());
  const alive = React.useRef(true);
  const nextPage = React.useRef<Record<MarketDiscoveryFeed, number>>({
    'A股要闻': 2,
    '美股要闻': 2,
    '港股要闻': 2,
  });
  const rotatingFeed = React.useRef(0);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  React.useEffect(() => {
    setActiveFeed(routeFeed);
  }, [routeFeed]);

  const loadSnapshot = React.useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const snapshot = await trpc.stocks.dashboardSnapshot.query();
      if (alive.current) setDashboard(snapshot);
    } catch (err) {
      if (alive.current) setError(pageErrorMessage(err));
    } finally {
      if (!alive.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSnapshot('initial');
  }, [loadSnapshot]);

  const news = React.useMemo(
    () => mergeDiscoveryNews((dashboard?.news ?? []) as StockNewsRow[], extensions),
    [dashboard?.news, extensions],
  );
  const indexedNews = React.useMemo(
    () => news.map((item, index) => ({ item, index })),
    [news],
  );
  const readingPrioritizedNews = React.useMemo(
    () => prioritizeAndDiversifyDiscoveryItems(
      indexedNews.filter(({ item }) => activeFeed === '全部' || newsFeed(item) === activeFeed),
      discoveryReadingPriority,
      (item) => item.symbols[0],
    ),
    [activeFeed, indexedNews],
  );
  const prioritizedNews = React.useMemo(
    () => diversifyDiscoveryEditorialArt(
      readingPrioritizedNews,
      failedSourceCoverUrls,
    ),
    [failedSourceCoverUrls, readingPrioritizedNews],
  );
  const filteredRows = React.useMemo(
    () => prioritizedNews.map(({ item }) => item),
    [prioritizedNews],
  );
  const displayedNews = prioritizedNews.slice(0, visibleCount);
  const leadNews = displayedNews[0] ?? null;
  const supportingNews = displayedNews.slice(1, 4);
  const remainingNews = displayedNews.slice(4);
  const feedCounts = React.useMemo(() => new Map(
    FEEDS.map((feed) => [
      feed,
      feed === '全部' ? news.length : news.filter((item) => newsFeed(item) === feed).length,
    ]),
  ), [news]);
  const hasMoreForActiveFeed = activeFeed === '全部'
    ? MARKET_DISCOVERY_FEEDS.some((feed) => moreAvailable[feed])
    : MARKET_DISCOVERY_FEEDS.includes(activeFeed as MarketDiscoveryFeed) && moreAvailable[activeFeed as MarketDiscoveryFeed];
  const canRevealLoadedNews = displayedNews.length < prioritizedNews.length;

  React.useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [activeFeed]);

  const changeFeed = (feed: DiscoveryFeed | '全部'): void => {
    setActiveIndex(null);
    setActiveFeed(feed);
    const next = new URLSearchParams(searchParams);
    if (feed === '全部') next.delete('feed');
    else next.set('feed', feed);
    setSearchParams(next, { replace: true });
  };

  const handleSourceCoverError = React.useCallback((imageUrl: string): void => {
    setFailedSourceCoverUrls((previous) => {
      if (previous.has(imageUrl)) return previous;
      const next = new Set(previous);
      next.add(imageUrl);
      return next;
    });
  }, []);

  const loadMoreSourceRows = React.useCallback(async (): Promise<boolean> => {
    if (loadingMore || !hasMoreForActiveFeed) return false;
    const target = activeFeed === '全部'
      ? MARKET_DISCOVERY_FEEDS.find((_, index) => {
        const feed = MARKET_DISCOVERY_FEEDS[(rotatingFeed.current + index) % MARKET_DISCOVERY_FEEDS.length]!;
        return moreAvailable[feed];
      })
      : MARKET_DISCOVERY_FEEDS.includes(activeFeed as MarketDiscoveryFeed)
        ? activeFeed as MarketDiscoveryFeed
        : null;
    if (!target) return false;

    if (activeFeed === '全部') {
      rotatingFeed.current = (MARKET_DISCOVERY_FEEDS.indexOf(target) + 1) % MARKET_DISCOVERY_FEEDS.length;
    }
    const page = nextPage.current[target];
    setLoadingMore(true);
    try {
      const result = await trpc.stocks.discoveryFeed.query({ feed: target, page });
      if (!alive.current) return false;
      nextPage.current[target] = page + 1;
      setMoreAvailable((previous) => ({ ...previous, [target]: result.hasMore }));
      setExtensions((previous) => mergeDiscoveryNews(previous, result.items as StockNewsRow[]));
      return result.items.length > 0;
    } catch (err) {
      if (alive.current) setError(pageErrorMessage(err));
      return false;
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }, [activeFeed, hasMoreForActiveFeed, loadingMore, moreAvailable]);

  const showMore = (): void => {
    if (canRevealLoadedNews) {
      setVisibleCount((count) => count + INITIAL_VISIBLE_COUNT);
      return;
    }
    void loadMoreSourceRows().then((didLoad) => {
      if (didLoad) setVisibleCount((count) => count + INITIAL_VISIBLE_COUNT);
    });
  };

  React.useEffect(() => {
    if (!shouldPrefetchDiscoveryPage({
      currentPage: Math.max(0, Math.ceil(displayedNews.length / INITIAL_VISIBLE_COUNT) - 1),
      pageCount: Math.max(1, Math.ceil(prioritizedNews.length / INITIAL_VISIBLE_COUNT)),
      hasMore: hasMoreForActiveFeed,
      isLoading: loadingMore,
      hasExhaustedLoadedItems: !loading && prioritizedNews.length > 0 && displayedNews.length >= prioritizedNews.length,
    })) return;
    void loadMoreSourceRows();
  }, [displayedNews.length, hasMoreForActiveFeed, loadMoreSourceRows, loading, loadingMore, prioritizedNews.length]);

  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-[#E9EBEF] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={() => navigate('/stocks')}
            className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[#E1E3E8] bg-white text-[#667085] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59]"
            aria-label="返回股市任务"
            title="返回股市任务"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[#EA1F59]">市场发现</p>
            <h1 className="mt-1 text-[24px] font-semibold text-[#121826] sm:text-[28px]">新闻与公告</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#667085]">
              先看按关联标的、来源可读性与发布时间排序的优先阅读，再浏览完整来源流。详情在站内阅读，只展示来源返回或已验证提取的内容。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadSnapshot('refresh')}
          disabled={refreshing}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-[#E1E3E8] bg-white px-3 text-[13px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />
          刷新来源
        </button>
      </header>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="新闻栏目">
        {FEEDS.map((feed) => {
          const count = feedCounts.get(feed) ?? 0;
          return (
            <button
              key={feed}
              type="button"
              onClick={() => changeFeed(feed)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition',
                activeFeed === feed
                  ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]'
                  : 'border-[#E1E3E8] bg-white text-[#667085] hover:border-[#C9CDD6] hover:text-[#121826]',
              )}
            >
              {feed}
              <span className="tabular-nums text-[12px] opacity-80">{loading ? '—' : count}</span>
            </button>
          );
        })}
      </nav>

      {error ? (
        <div className="mt-5 rounded-[8px] border border-[#F2D4D9] bg-[#FFF7F8] px-4 py-3 text-[13px] leading-6 text-[#A12245]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-[286px] animate-pulse rounded-[8px] border border-[#E7E7EB] bg-[#F8F9FB]" />
          ))}
        </div>
      ) : displayedNews.length > 0 ? (
        <>
          {leadNews ? (
            <section className="mt-6" aria-label="优先阅读">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#EA1F59]" aria-hidden />
                <h2 className="text-[15px] font-semibold text-[#242424]">优先阅读</h2>
                <span className="text-[12px] text-[#8B92A1]">按关联标的、来源可读性与发布时间排序</span>
              </div>
              <div className="space-y-4">
                <DiscoveryNewsCard
                  key={leadNews.item.url ?? `${leadNews.item.time}-${leadNews.item.title}`}
                  item={leadNews.item}
                  variant="lead"
                  onOpen={() => setActiveIndex(0)}
                  onImageError={handleSourceCoverError}
                />
                {supportingNews.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {supportingNews.map(({ item }, offset) => (
                      <DiscoveryNewsCard
                        key={item.url ?? `${item.time}-${item.title}`}
                        item={item}
                        variant="standard"
                        onOpen={() => setActiveIndex(offset + 1)}
                        onImageError={handleSourceCoverError}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
          {remainingNews.length > 0 ? (
            <section className="mt-8" aria-label="更多来源">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#CBD0DA]" aria-hidden />
                  <h2 className="text-[15px] font-semibold text-[#242424]">更多来源</h2>
                </div>
                <span className="text-[12px] text-[#8B92A1]">按发布时间排列</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {remainingNews.map(({ item }, offset) => (
                  <DiscoveryNewsCard
                    key={item.url ?? `${item.time}-${item.title}`}
                    item={item}
                    onOpen={() => setActiveIndex(offset + 4)}
                    onImageError={handleSourceCoverError}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {canRevealLoadedNews || hasMoreForActiveFeed ? (
            <div className="mt-7 flex justify-center">
              <button
                type="button"
                onClick={showMore}
                disabled={loadingMore}
                className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#E1E3E8] bg-white px-4 text-[13px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {loadingMore ? '正在加载来源内容' : '加载更多'}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-6 rounded-[8px] border border-dashed border-[#D7DCE5] bg-[#FCFCFD] px-5 py-16 text-center">
          <p className="text-[15px] font-medium text-[#344054]">当前栏目暂无可展示的真实来源内容</p>
          <p className="mt-2 text-[13px] leading-6 text-[#8B92A1]">切换栏目或稍后刷新，Holaday 不会以模拟新闻填充这里。</p>
        </div>
      )}

      <NewsDetailModal
        news={filteredRows}
        activeIndex={activeIndex}
        onClose={() => setActiveIndex(null)}
        onChangeIndex={setActiveIndex}
      />
    </main>
  );
}

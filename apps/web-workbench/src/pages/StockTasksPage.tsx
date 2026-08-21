import {
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { DiscoveryNewsCard } from '@/components/DiscoveryNewsCard';
import { NewsDetailModal as StockNewsDetailModal } from '@/components/NewsDetailModal';
import { StockAiCommandComposer } from '@/components/stocks/StockAiCommandComposer';
import {
  MarketTemperatureDetails,
  sectorTrendValues,
} from '@/components/stocks/StockMarketContextDetails';
import type { StockScreeningViewState } from '@/components/stocks/StockScreeningWorkbench';
import {
  StockMarketContextLayout,
  StockResearchTable,
  StockTaskWorkspaceLayout,
} from '@/components/stocks/StockWorkbenchLayout';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { pageErrorMessage } from '@/lib/page-error-copy';
import {
  diversifyDiscoveryEditorialArt,
  diversifyDiscoveryItems,
  discoveryPageIndexes,
  isExplicitWatchlistNews,
  preferredStockDiscoveryFeed,
  shouldPrefetchDiscoveryPage,
} from '@/lib/stock-discovery';
import {
  formatStockDateTimeLabel,
  formatStockDateLabel,
  formatStockTradeDateLabel,
  intradayRatioFromLabel,
  stockChartHoverTooltipKind,
  stockLabelDatePart,
  stockChartAxisTicks,
} from '@/lib/stock-chart-state';
import { stockDashboardTrustState } from '@/lib/stock-dashboard-trust';
import { discoveryStoryAliases, discoveryStoryClusterKey, mergeDiscoveryNews } from '@/lib/stock-news';
import {
  stockQuickCommands,
  stockSignalLabel,
  stockTemporalCopy,
  type StockTemporalCopy,
  type StockTemporalMode,
} from '@/lib/stock-temporal-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { type StockTaskContextInput, useTaskStore } from '@/stores/task-store';

const StockRiskRadar = React.lazy(async () => {
  const component = await import('@/components/stocks/StockRiskRadar');
  return { default: component.StockRiskRadar };
});

const StockScreeningWorkbench = React.lazy(async () => {
  const component = await import('@/components/stocks/StockScreeningWorkbench');
  return { default: component.StockScreeningWorkbench };
});

const StockPreferenceProfile = React.lazy(async () => {
  const component = await import('@/components/stocks/StockPreferenceProfile');
  return { default: component.StockPreferenceProfile };
});

function DeferredStockPanel({ label }: { label: string }): JSX.Element {
  return (
    <div
      className="flex min-h-[180px] items-center justify-center gap-2 rounded-[12px] border border-[#E8E1EC] bg-[#FFFCFA] px-5 py-8 text-[12px] text-[#716A7C]"
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {label}
    </div>
  );
}

type WatchlistRow = Awaited<ReturnType<typeof trpc.watchlists.list.query>>[number];
type BriefingStatus = Awaited<ReturnType<typeof trpc.watchlists.briefingStatus.query>>;
type DashboardSnapshot = Awaited<ReturnType<typeof trpc.stocks.dashboardSnapshot.query>>;
type SymbolSuggestion = Awaited<ReturnType<typeof trpc.stocks.searchSymbols.query>>[number];
type Market = 'A' | 'HK' | 'US';
type Signal = '强势' | '偏强' | '中性' | '偏弱' | '风险升高' | '待观察';
type VolumeSignal = '放量' | '缩量' | '接近均量' | '待观察';

interface StockSnapshot {
  symbol: string;
  name: string;
  market: Market;
  price: string;
  changePct: number;
  signal: Signal;
  report: '已生成' | '待生成' | '生成中';
  spark: number[];
  sparkLabels?: string[];
  sparkKind?: 'daily_close' | 'intraday';
  sparkBaseline?: number | null;
  sparkTradeDate?: string | null;
  turnoverAmount?: number | null;
  averageTurnoverAmount?: number | null;
  volume?: number | null;
  averageVolume?: number | null;
  volumeRatio?: number | null;
  volumeSignal?: VolumeSignal;
  newsCount: number;
  note: string;
}

interface IndexRow {
  name: string;
  price: string;
  changePct: number;
  turnover: string;
}

interface SectorRow {
  name: string;
  changePct: number;
  leader: string;
  flow: string;
  spark: number[];
}

interface NewsRow {
  category?: '公告' | '新闻' | '盘面' | '关注';
  feed?: '自选股新闻' | '重要公告' | 'A股要闻' | '美股要闻' | '港股要闻';
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

type GeneratedBriefing = Awaited<ReturnType<typeof trpc.stocks.generateBriefingNow.mutate>>;
type DiscoveryFeed = '自选股新闻' | '重要公告' | 'A股要闻' | '美股要闻' | '港股要闻';
type MarketDiscoveryFeed = Extract<DiscoveryFeed, 'A股要闻' | '美股要闻' | '港股要闻'>;

interface LeaderRow {
  rank: number;
  name: string;
  price: string;
  changePct: number;
  reason: string;
}

interface InsightRow {
  label: string;
  value: string;
  meta?: string;
  changePct?: number;
}

interface InsightSheetState {
  title: string;
  description: string;
  rows: InsightRow[];
}

const EMPTY_LEADERBOARDS: NonNullable<DashboardSnapshot['leaderboards']> = {
  gainers: [],
  losers: [],
  amount: [],
};

const MARKET_DISCOVERY_FEEDS: MarketDiscoveryFeed[] = ['A股要闻', '美股要闻', '港股要闻'];

const MARKET_UP_CLASS = 'text-[#E11D48]';
const MARKET_DOWN_CLASS = 'text-[#0E9F6E]';
const MARKET_UP_STROKE = '#E11D48';
const MARKET_DOWN_STROKE = '#0E9F6E';
const MARKET_CHART_LEFT = 0;
const MARKET_CHART_RIGHT = 100;
type StockChartHover = { ratio: number; y: number };
export function StockTasksPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const createStockTask = useTaskStore((s) => s.createStockTask);
  const [watchlist, setWatchlist] = React.useState<WatchlistRow[] | null>(null);
  const [briefingStatus, setBriefingStatus] = React.useState<BriefingStatus | null>(null);
  const [dashboard, setDashboard] = React.useState<DashboardSnapshot | null>(null);
  const [discoveryExtensions, setDiscoveryExtensions] = React.useState<NewsRow[]>([]);
  const [discoveryMoreAvailable, setDiscoveryMoreAvailable] = React.useState<Record<MarketDiscoveryFeed, boolean>>({
    'A股要闻': true,
    '美股要闻': true,
    '港股要闻': true,
  });
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState('');
  const [loadingDashboard, setLoadingDashboard] = React.useState(true);
  const [refreshingDashboard, setRefreshingDashboard] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [briefingBusy, setBriefingBusy] = React.useState(false);
  const [briefingGenerating, setBriefingGenerating] = React.useState(false);
  const [briefingResult, setBriefingResult] = React.useState<GeneratedBriefing | null>(null);
  const [watchlistSheetOpen, setWatchlistSheetOpen] = React.useState(false);
  const [insightSheet, setInsightSheet] = React.useState<InsightSheetState | null>(null);
  const [activeNewsIndex, setActiveNewsIndex] = React.useState<number | null>(null);
  const [watchlistSaving, setWatchlistSaving] = React.useState(false);
  const [stockForm, setStockForm] = React.useState({
    symbol: '',
    market: 'A' as Market,
    displayName: '',
    note: '',
  });
  const [symbolSuggestions, setSymbolSuggestions] = React.useState<SymbolSuggestion[]>([]);
  const [searchingSymbols, setSearchingSymbols] = React.useState(false);
  const [preferenceRevision, setPreferenceRevision] = React.useState(0);
  const [screeningView, setScreeningView] = React.useState<StockScreeningViewState>('idle');
  const [activeLeaderboard, setActiveLeaderboard] = React.useState<'涨幅榜' | '跌幅榜' | '成交额榜' | '换手率榜'>('涨幅榜');
  const pageAlive = React.useRef(true);
  const dashboardRefreshInFlight = React.useRef(false);
  const dashboardCompletionRetries = React.useRef(0);
  const discoveryNextPage = React.useRef<Record<MarketDiscoveryFeed, number>>({
    'A股要闻': 2,
    '美股要闻': 2,
    '港股要闻': 2,
  });
  const discoveryLoadCursor = React.useRef(0);
  const loadingDiscoveryFeeds = React.useRef(new Set<MarketDiscoveryFeed>());
  const refreshPreferenceProfile = React.useCallback(() => {
    setPreferenceRevision((current) => current + 1);
  }, []);
  React.useEffect(() => {
    pageAlive.current = true;
    return () => {
      pageAlive.current = false;
    };
  }, []);

  const loadPageData = React.useCallback(async (mode: 'initial' | 'manual' | 'background' = 'background') => {
    const isRefresh = mode !== 'initial';
    if (isRefresh && dashboardRefreshInFlight.current) return;
    if (isRefresh) dashboardRefreshInFlight.current = true;

    let dashboardError: string | null = null;
    if (mode === 'initial') setLoadingDashboard(true);
    else if (mode === 'manual') setRefreshingDashboard(true);
    setLoadError(null);
    try {
      const watchlistPromise = trpc.watchlists.list.query().then((rows) => {
        if (pageAlive.current) setWatchlist(rows);
        return rows;
      });
      const statusPromise = trpc.watchlists.briefingStatus.query().then((status) => {
        if (pageAlive.current) setBriefingStatus(status);
        return status;
      });
      const snapshotPromise = trpc.stocks.dashboardSnapshot.query().then((snapshot) => {
        if (pageAlive.current) {
          setDashboard((previous) => preserveDisplayableDashboard(snapshot, previous));
        }
        return snapshot;
      }).catch((err) => {
        if (pageAlive.current) {
          dashboardError = pageErrorMessage(err);
          setLoadError(dashboardError);
        }
        return null;
      });
      const [, , snapshot] = await Promise.all([
        watchlistPromise,
        statusPromise,
        snapshotPromise,
      ]);
      if (!pageAlive.current) return;
      if (snapshot) {
        setDashboard((previous) => preserveDisplayableDashboard(snapshot, previous));
      }
      setLoadError(dashboardError);
    } catch (err) {
      if (pageAlive.current) setLoadError(pageErrorMessage(err));
    } finally {
      if (isRefresh) dashboardRefreshInFlight.current = false;
      if (!pageAlive.current) return;
      if (mode === 'initial') setLoadingDashboard(false);
      if (mode === 'manual') setRefreshingDashboard(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPageData('initial');
  }, [loadPageData]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || loadingDashboard || refreshingDashboard) return;
      void loadPageData('background');
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [loadPageData, loadingDashboard, refreshingDashboard]);

  React.useEffect(() => {
    const status = dashboard?.freshness?.status;
    const hasDisplayableData = dashboardHasDisplayableData(dashboard);
    if (!status || (status === 'fresh' && hasDisplayableData)) {
      dashboardCompletionRetries.current = 0;
      return;
    }
    if (loadingDashboard || refreshingDashboard || dashboardCompletionRetries.current >= 12) return;
    dashboardCompletionRetries.current += 1;
    const retryDelay = dashboardCompletionRetries.current <= 2 ? 4_000 : 8_000;
    const timer = window.setTimeout(() => {
      if (pageAlive.current) void loadPageData('background');
    }, retryDelay);
    return () => window.clearTimeout(timer);
  }, [dashboard, loadPageData, loadingDashboard, refreshingDashboard]);

  const initialDashboardLoading = loadingDashboard && dashboard === null && watchlist === null;
  const stocks = React.useMemo(
    () => {
      const rows = dashboard?.watchlistStocks ?? (initialDashboardLoading ? [] : buildStockRows(watchlist));
      if (!briefingResult) return rows;
      return rows.map((stock) => ({ ...stock, report: '已生成' as const }));
    },
    [briefingResult, dashboard?.watchlistStocks, initialDashboardLoading, watchlist],
  );
  const marketIndices = dashboard?.marketIndices ?? [];
  const sectors = dashboard?.sectors ?? [];
  const dashboardNews = React.useMemo(() => dashboard?.news ?? [], [dashboard?.news]);
  const news = React.useMemo(
    () => mergeDiscoveryNews(dashboardNews, discoveryExtensions),
    [dashboardNews, discoveryExtensions],
  );
  const leaderboards = dashboard?.leaderboards ?? EMPTY_LEADERBOARDS;
  const leaders = pickActiveLeaders(activeLeaderboard, leaderboards);
  const starStocks = dashboard?.starStocks ?? stocks.filter((stock) => stock.price !== '—').slice(0, 6);
  const temperature = dashboard?.temperature ?? null;
  const enabled = briefingStatus?.enabled === true;
  const sampleWatchlist = false;
  const dashboardTrust = React.useMemo(
    () => stockDashboardTrustState({ trust: dashboard?.trust }),
    [dashboard?.trust],
  );
  const temporalCopy = React.useMemo(
    () => stockTemporalCopy(
      dashboardTrust.tone,
      dashboard?.trust?.dataAsOf ?? null,
      dashboard?.trust?.marketSession ?? null,
    ),
    [dashboard?.trust?.dataAsOf, dashboard?.trust?.marketSession, dashboardTrust.tone],
  );
  const stockPromptUnavailable =
    dashboardTrust.tone === 'unavailable' || dashboardTrust.tone === 'unverified';
  const stockTaskContext = React.useMemo<StockTaskContextInput | null>(() => {
    const trust = dashboard?.trust;
    if (!trust || !trust.dataAsOf || trust.mode === 'unavailable') {
      return null;
    }
    return {
      snapshotId: trust.snapshotId,
      dataAsOf: trust.dataAsOf,
      trustMode: trust.mode,
      evidenceIds: trust.evidenceIds.slice(0, 50),
    };
  }, [dashboard?.trust]);
  const briefingUnavailable = sampleWatchlist || !dashboardTrust.canGenerateBriefing;
  const briefingUnavailableTitle = sampleWatchlist
    ? '添加真实关注股票后可生成日报'
    : !dashboardTrust.canGenerateBriefing
      ? '真实行情恢复并核验日期后可生成日报'
      : undefined;
  const realWatchlist = watchlist ?? [];
  const watchlistSymbols = React.useMemo(
    () => (watchlist ?? []).map((row) => row.symbol),
    [watchlist],
  );
  const commands = React.useMemo(() => stockQuickCommands(stocks, temporalCopy), [stocks, temporalCopy]);
  const resetDiscoveryExtensions = React.useCallback(() => {
    setDiscoveryExtensions([]);
    setDiscoveryMoreAvailable({
      'A股要闻': true,
      '美股要闻': true,
      '港股要闻': true,
    });
    discoveryNextPage.current = {
      'A股要闻': 2,
      '美股要闻': 2,
      '港股要闻': 2,
    };
    discoveryLoadCursor.current = 0;
    loadingDiscoveryFeeds.current.clear();
  }, []);
  const canLoadMoreDiscovery = React.useCallback(
    (feed: MarketDiscoveryFeed) => discoveryMoreAvailable[feed],
    [discoveryMoreAvailable],
  );
  const loadMoreDiscovery = React.useCallback(async (requestedFeed: MarketDiscoveryFeed | '全部'): Promise<boolean> => {
    const availableFeeds = MARKET_DISCOVERY_FEEDS.filter(
      (feed) => discoveryMoreAvailable[feed] && !loadingDiscoveryFeeds.current.has(feed),
    );
    const feeds = requestedFeed === '全部'
      ? (() => {
        for (let offset = 0; offset < MARKET_DISCOVERY_FEEDS.length; offset += 1) {
          const index = (discoveryLoadCursor.current + offset) % MARKET_DISCOVERY_FEEDS.length;
          const candidate = MARKET_DISCOVERY_FEEDS[index]!;
          if (!availableFeeds.includes(candidate)) continue;
          discoveryLoadCursor.current = (index + 1) % MARKET_DISCOVERY_FEEDS.length;
          return [candidate];
        }
        return [] as MarketDiscoveryFeed[];
      })()
      : availableFeeds.includes(requestedFeed) ? [requestedFeed] : [];
    if (feeds.length === 0) return false;

    feeds.forEach((feed) => loadingDiscoveryFeeds.current.add(feed));
    try {
      const results = await Promise.all(feeds.map(async (feed) => {
        const page = discoveryNextPage.current[feed];
        const result = await trpc.stocks.discoveryFeed.query({ feed, page });
        return { ...result, requestedPage: page };
      }));
      if (!pageAlive.current) return false;
      results.forEach((result) => {
        discoveryNextPage.current[result.feed] = result.requestedPage + 1;
      });
      setDiscoveryMoreAvailable((previous) => ({
        ...previous,
        ...Object.fromEntries(results.map((result) => [result.feed, result.hasMore])),
      }) as Record<MarketDiscoveryFeed, boolean>);
      setDiscoveryExtensions((previous) => mergeDiscoveryNews(previous, results.flatMap((result) => result.items)));
      return results.some((result) => result.items.length > 0);
    } catch {
      return false;
    } finally {
      feeds.forEach((feed) => loadingDiscoveryFeeds.current.delete(feed));
    }
  }, [discoveryMoreAvailable]);

  const hasMarketSignals = Boolean(
    temperature ||
      marketIndices.length > 0 ||
      sectors.length > 0 ||
      news.length > 0 ||
      leaders.length > 0 ||
      stocks.some((stock) => stock.price !== '—'),
  );

  React.useEffect(() => {
    if (!watchlistSheetOpen) {
      setSymbolSuggestions([]);
      setSearchingSymbols(false);
      return;
    }
    const query = stockForm.symbol.trim();
    const asciiTicker = /^[A-Za-z]+$/.test(query);
    if (query.length < 2 || query.includes('.') || (asciiTicker && inferMarket(query) !== 'A')) {
      setSymbolSuggestions([]);
      setSearchingSymbols(false);
      return;
    }
    let alive = true;
    setSearchingSymbols(true);
    const timer = window.setTimeout(() => {
      trpc.stocks.searchSymbols.query({ query })
        .then((rows) => {
          if (alive) setSymbolSuggestions(rows);
        })
        .catch(() => {
          if (alive) setSymbolSuggestions([]);
        })
        .finally(() => {
          if (alive) setSearchingSymbols(false);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [stockForm.symbol, watchlistSheetOpen]);

  const generateBriefing = React.useCallback(async () => {
    if (briefingGenerating) return;
    if (loadingDashboard) return;
    if (briefingUnavailable) {
      toast.show(briefingUnavailableTitle ?? '当前行情暂不可用于生成日报', 'error');
      return;
    }
    setBriefingGenerating(true);
    setLoadError(null);
    try {
      const result = await trpc.stocks.generateBriefingNow.mutate({ mode: 'auto' });
      setBriefingResult(result);
      toast.show('日报已生成');
    } catch (err) {
      setLoadError(pageErrorMessage(err));
      toast.show('日报生成失败，请稍后重试', 'error');
    } finally {
      setBriefingGenerating(false);
    }
  }, [briefingGenerating, briefingUnavailable, briefingUnavailableTitle, loadingDashboard, toast]);

  const addWatchlistStock = React.useCallback(async () => {
    const symbol = normalizeSymbol(stockForm.symbol);
    if (!symbol || watchlistSaving) return;
    setWatchlistSaving(true);
    setLoadError(null);
    try {
      const result = await trpc.watchlists.add.mutate({
        symbol,
        market: stockForm.market,
        displayName: stockForm.displayName.trim() || undefined,
        note: stockForm.note.trim() || undefined,
      });
      toast.show(result.already ? '这只股票已在关注列表' : `已添加 ${symbol}`);
      if (!result.already) refreshPreferenceProfile();
      setStockForm({ symbol: '', market: 'A', displayName: '', note: '' });
      setBriefingResult(null);
      resetDiscoveryExtensions();
      await loadPageData('background');
    } catch (err) {
      const message = pageErrorMessage(err);
      setLoadError(message);
      toast.show(message, 'error');
    } finally {
      setWatchlistSaving(false);
    }
  }, [loadPageData, refreshPreferenceProfile, resetDiscoveryExtensions, stockForm, toast, watchlistSaving]);

  const addScreeningCandidate = React.useCallback(async (symbol: string, name: string) => {
    if (watchlistSaving) {
      toast.show('关注列表正在更新，请稍后再试', 'error');
      return;
    }
    setWatchlistSaving(true);
    setLoadError(null);
    try {
      const result = await trpc.watchlists.add.mutate({
        symbol,
        market: 'A',
        displayName: name,
      });
      toast.show(result.already ? `${name} 已在关注列表` : `已关注 ${name}`);
      if (!result.already) {
        refreshPreferenceProfile();
        setBriefingResult(null);
        resetDiscoveryExtensions();
        await loadPageData('background');
      }
    } catch (err) {
      const message = pageErrorMessage(err);
      setLoadError(message);
      toast.show(message, 'error');
    } finally {
      setWatchlistSaving(false);
    }
  }, [loadPageData, refreshPreferenceProfile, resetDiscoveryExtensions, toast, watchlistSaving]);

  const removeWatchlistStock = React.useCallback(async (symbol: string) => {
    if (watchlistSaving) return;
    setWatchlistSaving(true);
    setLoadError(null);
    try {
      await trpc.watchlists.remove.mutate({ symbol });
      toast.show(`已移除 ${symbol}`);
      refreshPreferenceProfile();
      setBriefingResult(null);
      resetDiscoveryExtensions();
      await loadPageData('background');
    } catch (err) {
      const message = pageErrorMessage(err);
      setLoadError(message);
      toast.show(message, 'error');
    } finally {
      setWatchlistSaving(false);
    }
  }, [loadPageData, refreshPreferenceProfile, resetDiscoveryExtensions, toast, watchlistSaving]);

  const updateWatchlistStock = React.useCallback(async (symbol: string, displayName: string, note: string) => {
    if (watchlistSaving) return;
    setWatchlistSaving(true);
    setLoadError(null);
    try {
      await trpc.watchlists.update.mutate({
        symbol,
        displayName: displayName.trim() || null,
        note: note.trim() || null,
      });
      toast.show(`已更新 ${symbol}`);
      setBriefingResult(null);
      resetDiscoveryExtensions();
      await loadPageData('background');
    } catch (err) {
      const message = pageErrorMessage(err);
      setLoadError(message);
      toast.show(message, 'error');
    } finally {
      setWatchlistSaving(false);
    }
  }, [loadPageData, resetDiscoveryExtensions, toast, watchlistSaving]);

  const submitPrompt = React.useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || submitting) return;
      if (stockPromptUnavailable) {
        toast.show('可信行情恢复后再创建股票数据任务', 'error');
        return;
      }
      if (!stockTaskContext) {
        toast.show('股票快照尚未就绪，请刷新后再试', 'error');
        return;
      }
      setSubmitting(true);
      const result = await createStockTask(trimmed, stockTaskContext);
      setSubmitting(false);
      if ('taskId' in result) {
        navigate(`/?task=${encodeURIComponent(result.taskId)}`);
      }
    },
    [createStockTask, navigate, stockPromptUnavailable, stockTaskContext, submitting, toast],
  );

  const toggleBriefing = React.useCallback(async () => {
    if (loadingDashboard) return;
    if (briefingBusy || briefingUnavailable) return;
    setBriefingBusy(true);
    try {
      const next = enabled
        ? await trpc.watchlists.disableDailyBriefing.mutate()
        : await trpc.watchlists.enableDailyBriefing.mutate();
      setBriefingStatus({ enabled: next.enabled });
    } catch (err) {
      setLoadError(pageErrorMessage(err));
    } finally {
      setBriefingBusy(false);
    }
  }, [briefingBusy, briefingUnavailable, enabled, loadingDashboard]);

  return (
    <div className="min-h-full bg-[#FFFCFA] text-[#25233A]">
      <div
        data-stock-mobile-chrome=""
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[35] h-12 border-b border-[#EFE7F1] bg-[#FFFCFA]/95 shadow-[0_2px_12px_rgba(103,75,121,0.06)] backdrop-blur-xl min-[769px]:hidden"
      />
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 pb-5 pt-14 sm:gap-4 sm:px-5 min-[769px]:pt-4 lg:px-6">
        <header className="flex flex-col gap-3 border-b border-[#EFE7F1] pb-3 min-[769px]:pr-[12rem] md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-[#3E3154]">
              股市任务
            </h1>
            <span
              className={cn(
                'inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium',
                dashboardTrust.tone === 'current'
                  ? 'border-[#BDE7D6] bg-[#F0FBF6] text-[#087A52]'
                  : dashboardTrust.tone === 'historical'
                    ? 'border-[#F2D4A7] bg-[#FFF8EC] text-[#9A5B00]'
                    : 'border-[#E1E3E8] bg-[#F7F8FA] text-[#667085]',
              )}
            >
              {dashboardTrust.statusLabel}
            </span>
            <span className="text-[12px] text-[#7D8493]">
              {dashboardTrust.dataDateLabel} · {dashboardTrust.refreshLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-[13px] text-[#4F5868]">
            <button
              type="button"
              onClick={() => void loadPageData('manual')}
              disabled={refreshingDashboard || loadingDashboard}
              className="inline-flex h-11 min-[769px]:h-8 items-center gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 transition-colors hover:border-[#EA1F59]/30 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshingDashboard || loadingDashboard ? 'animate-spin' : '')} aria-hidden />
              刷新
            </button>
            <button
              type="button"
              onClick={toggleBriefing}
              disabled={briefingBusy || loadingDashboard || briefingUnavailable}
              title={briefingUnavailableTitle}
              className="inline-flex h-11 min-[769px]:h-8 items-center gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 transition-colors hover:border-[#EA1F59]/30 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {briefingBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : enabled ? (
                <Bell className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              )}
              {enabled ? '已开启日报' : '开启日报'}
            </button>
          </div>
        </header>

        {loadError ? (
          <div className="rounded-[8px] border border-[#EA1F59]/25 bg-white px-4 py-3 text-[13px] text-[#EA1F59]">
            部分股票数据暂时无法加载：{loadError}
          </div>
        ) : null}
        {sampleWatchlist && !loadingDashboard ? (
          <div className="rounded-[8px] border border-[#E1E3E8] bg-white px-4 py-3 text-[13px] text-[#4F5868]">
            当前显示示例关注列表；添加自己的关注股票后，可生成专属日报并接收每日提醒。
          </div>
        ) : null}

        <StockAiCommandComposer
          value={prompt}
          placeholder={temporalCopy.promptPlaceholder}
          assistantStatus={temporalCopy.assistantStatus}
          commands={commands}
          submitting={submitting}
          submitDisabled={submitting || !prompt.trim() || stockPromptUnavailable}
          onValueChange={setPrompt}
          onSubmit={() => void submitPrompt(prompt)}
          onCommand={(command) => {
            setPrompt(command);
            if (command === temporalCopy.briefingCommand && dashboardTrust.tone === 'current') {
              void generateBriefing();
            }
            else void submitPrompt(command);
          }}
          isCommandDisabled={(command) =>
            loadingDashboard ||
            stockPromptUnavailable ||
            (command === temporalCopy.briefingCommand &&
              dashboardTrust.tone === 'current' &&
              briefingUnavailable)}
          commandTitle={(command) =>
            command === temporalCopy.briefingCommand ? briefingUnavailableTitle : undefined}
        />

        {initialDashboardLoading ? (
          <InitialDashboardSkeleton />
        ) : (
          <div className="min-w-0 space-y-5">
            <StockTaskWorkspaceLayout
              briefingLabel={temporalCopy.briefingTabLabel}
              highlights={<MarketHighlights
                stocks={stocks}
                marketIndices={marketIndices}
                updatedAt={dashboard?.updatedAt}
                loading={loadingDashboard && dashboard === null}
                sample={sampleWatchlist}
                onEdit={() => setWatchlistSheetOpen(true)}
                onGenerateBriefing={generateBriefing}
                briefingGenerating={briefingGenerating}
                canGenerateBriefing={!briefingUnavailable}
                temporalCopy={temporalCopy}
                temporalMode={dashboardTrust.tone}
              />}
              riskRadar={(
                <React.Suspense fallback={<DeferredStockPanel label="正在加载风险证据…" />}>
                  <StockRiskRadar
                    snapshotId={dashboard?.trust?.snapshotId ?? null}
                    dataAsOf={dashboard?.trust?.dataAsOf ?? null}
                    trustMode={dashboard?.trust?.mode ?? 'unverified'}
                  />
                </React.Suspense>
              )}
              screening={(
                <React.Suspense fallback={<DeferredStockPanel label="正在加载条件选股…" />}>
                  <StockScreeningWorkbench
                    snapshotId={dashboard?.trust?.snapshotId ?? null}
                    dataAsOf={dashboard?.trust?.dataAsOf ?? null}
                    trustMode={dashboard?.trust?.mode ?? 'unverified'}
                    onAddToWatchlist={addScreeningCandidate}
                    onScreeningRecorded={refreshPreferenceProfile}
                    onViewStateChange={setScreeningView}
                  />
                </React.Suspense>
              )}
              preferenceProfile={(
                <React.Suspense fallback={<DeferredStockPanel label="正在加载选股偏好…" />}>
                  <StockPreferenceProfile
                    presentation="compact"
                    refreshKey={preferenceRevision}
                  />
                </React.Suspense>
              )}
              briefing={<DailyBriefing
                stocks={stocks}
                marketIndices={marketIndices}
                sectors={sectors}
                news={news}
                leaderboards={leaderboards}
                updatedAt={dashboard?.updatedAt}
                observedTradeDate={dashboard?.observedTradeDate}
                briefing={briefingResult}
                generating={briefingGenerating}
                onGenerate={generateBriefing}
                sampleWatchlist={sampleWatchlist}
                hasMarketSignals={hasMarketSignals}
                canGenerateBriefing={!briefingUnavailable}
                temporalCopy={temporalCopy}
                temporalMode={dashboardTrust.tone}
              />}
              screeningView={screeningView}
            />
            <StockMarketContextLayout
              discovery={<DiscoveryPanel
                news={news}
                watchlistSymbols={watchlistSymbols}
                onOpenNews={(index) => setActiveNewsIndex(index)}
                onViewAll={(feed) => {
                  const query = feed === '全部' ? '' : `?feed=${encodeURIComponent(feed)}`;
                  navigate(`/stocks/discovery${query}`);
                }}
                onLoadMore={loadMoreDiscovery}
                canLoadMore={(feed) => feed === '全部'
                  ? MARKET_DISCOVERY_FEEDS.some(canLoadMoreDiscovery)
                  : MARKET_DISCOVERY_FEEDS.includes(feed as MarketDiscoveryFeed) && canLoadMoreDiscovery(feed as MarketDiscoveryFeed)}
              />}
              temperature={<MarketTemperature
                temperature={temperature}
                onInspect={() => setInsightSheet(temperatureInsight(temperature))}
              />}
              sectors={<SectorTrends
                sectors={sectors}
                onInspect={() => setInsightSheet(sectorInsight(sectors, dashboardTrust.tone))}
              />}
              leaderboard={<Leaderboard
                leaders={leaders}
                active={activeLeaderboard}
                onActiveChange={setActiveLeaderboard}
                onInspect={() => setInsightSheet(leaderboardInsight(activeLeaderboard, leaders, dashboardTrust.tone))}
              />}
              marketTable={<MarketTable
                rows={marketIndices}
                onInspect={() => setInsightSheet(marketInsight(marketIndices, dashboardTrust.tone))}
                temporalCopy={temporalCopy}
              />}
              starStocks={<StarStocks
                stocks={starStocks}
                onInspect={() => setInsightSheet(starStockInsight(starStocks, temporalCopy, dashboardTrust.tone))}
                temporalCopy={temporalCopy}
                temporalMode={dashboardTrust.tone}
              />}
            />
          </div>
        )}

        <footer className="flex flex-col gap-2 border-t border-[#E7E7EB] pt-3 text-[11px] text-[#8B92A1] sm:flex-row sm:items-center sm:justify-between">
          <span>仅供信息分析，不构成投资建议</span>
          <span>数据来源：AkShare / Holaday 分析层 · {dashboardTrust.dataDateLabel} · {dashboardTrust.refreshLabel}</span>
        </footer>
      </div>
      <WatchlistManagerSheet
        open={watchlistSheetOpen}
        onOpenChange={setWatchlistSheetOpen}
        stocks={realWatchlist}
        sample={sampleWatchlist}
        saving={watchlistSaving}
        form={stockForm}
        onFormChange={setStockForm}
        suggestions={symbolSuggestions}
        searching={searchingSymbols}
        onPickSuggestion={(suggestion) => {
          setStockForm((prev) => ({
            ...prev,
            symbol: suggestion.symbol,
            market: suggestion.market as Market,
            displayName: suggestion.name,
          }));
          setSymbolSuggestions([]);
        }}
        onAdd={addWatchlistStock}
        onUpdate={updateWatchlistStock}
        onRemove={removeWatchlistStock}
      />
      <InsightSheet
        sheet={insightSheet}
        onOpenChange={(open) => {
          if (!open) setInsightSheet(null);
        }}
      />
      <StockNewsDetailModal
        news={news}
        activeIndex={activeNewsIndex}
        onClose={() => setActiveNewsIndex(null)}
        onChangeIndex={setActiveNewsIndex}
      />
    </div>
  );
}

function DiscoveryPanel({
  news,
  watchlistSymbols,
  onOpenNews,
  onViewAll,
  onLoadMore,
  canLoadMore,
}: {
  news: NewsRow[];
  watchlistSymbols: readonly string[];
  onOpenNews: (index: number) => void;
  onViewAll: (feed: DiscoveryFeed | '全部') => void;
  onLoadMore: (feed: MarketDiscoveryFeed | '全部') => Promise<boolean>;
  canLoadMore: (feed: DiscoveryFeed | '全部') => boolean;
}): JSX.Element {
  const pageSize = 3;
  const [activeFeed, setActiveFeed] = React.useState<DiscoveryFeed | '全部'>('全部');
  const [page, setPage] = React.useState(0);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const userSelectedFeed = React.useRef(false);
  const indexedNews = React.useMemo(
    () => news.map((item, index) => ({ item, index })),
    [news],
  );
  const storyAliases = React.useMemo(() => discoveryStoryAliases(news), [news]);
  const filteredNews = React.useMemo(
    () => diversifyDiscoveryEditorialArt(
      diversifyDiscoveryItems(
        indexedNews.filter(({ item }) => activeFeed === '全部' || newsFeed(item) === activeFeed),
        (item) => discoveryStoryClusterKey(item, storyAliases),
      ),
    ),
    [activeFeed, indexedNews, storyAliases],
  );
  const pageCount = Math.max(1, Math.ceil(filteredNews.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const items = filteredNews.slice(start, start + pageSize);
  const hasMore = canLoadMore(activeFeed);
  const pageIndexes = discoveryPageIndexes(pageCount, safePage);
  const announcementCount = news.filter((item) => newsDisplayType(item) === '公告').length;
  const marketNewsCount = news.length - announcementCount;
  const feedCounts = React.useMemo<Record<DiscoveryFeed, number>>(() => ({
    '自选股新闻': news.filter((item) => newsFeed(item) === '自选股新闻').length,
    '重要公告': news.filter((item) => newsFeed(item) === '重要公告').length,
    'A股要闻': news.filter((item) => newsFeed(item) === 'A股要闻').length,
    '美股要闻': news.filter((item) => newsFeed(item) === '美股要闻').length,
    '港股要闻': news.filter((item) => newsFeed(item) === '港股要闻').length,
  }), [news]);
  const preferredFeed = preferredStockDiscoveryFeed(feedCounts);

  React.useEffect(() => {
    if (!userSelectedFeed.current) setActiveFeed(preferredFeed);
  }, [preferredFeed]);

  React.useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage]);

  React.useEffect(() => {
    setPage(0);
  }, [activeFeed]);

  const requestMore = React.useCallback(async (): Promise<boolean> => {
    if (loadingMore || !hasMore) return false;
    const loadTarget = activeFeed === '全部'
      ? activeFeed
      : MARKET_DISCOVERY_FEEDS.includes(activeFeed as MarketDiscoveryFeed)
        ? activeFeed as MarketDiscoveryFeed
        : null;
    if (!loadTarget) return false;
    setLoadingMore(true);
    try {
      return await onLoadMore(loadTarget);
    } finally {
      setLoadingMore(false);
    }
  }, [activeFeed, hasMore, loadingMore, onLoadMore]);

  React.useEffect(() => {
    if (!shouldPrefetchDiscoveryPage({
      currentPage: safePage,
      pageCount,
      hasMore,
      isLoading: loadingMore,
    })) return;
    void requestMore();
  }, [hasMore, loadingMore, pageCount, requestMore, safePage]);

  const goPrevious = (): void => setPage((current) => Math.max(0, current - 1));
  const goNext = (): void => {
    if (safePage < pageCount - 1) {
      setPage((current) => current + 1);
      return;
    }
    void requestMore().then((didAppend) => {
      if (!didAppend) return;
      window.setTimeout(() => setPage((current) => current + 1), 0);
    });
  };
  const tabItems = [
    { label: '全部' as const, count: news.length },
    { label: '自选股新闻' as const, count: feedCounts.自选股新闻 },
    { label: '重要公告' as const, count: feedCounts.重要公告 },
    { label: 'A股要闻' as const, count: feedCounts.A股要闻 },
    { label: '美股要闻' as const, count: feedCounts.美股要闻 },
    { label: '港股要闻' as const, count: feedCounts.港股要闻 },
  ];

  return (
    <section className="rounded-[8px] border border-[#E1E3E8] bg-white p-4 shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <SectionHeader
        title="市场动态"
        meta={news.length > 0 ? `${marketNewsCount} 条新闻 · ${announcementCount} 条公告` : '等待真实来源'}
        action={news.length > 0 ? '查看更多新闻' : undefined}
        onAction={news.length > 0 ? () => onViewAll(activeFeed) : undefined}
      />
      {news.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-[#F1F2F5] pb-3">
          {tabItems.map((tab) => (
            <button
              key={tab.label}
              type="button"
              disabled={tab.count === 0}
              onClick={() => {
                userSelectedFeed.current = true;
                setActiveFeed(tab.label);
              }}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition',
                activeFeed === tab.label
                  ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]'
                  : 'border-[#E1E3E8] bg-white text-[#667085] hover:border-[#C9CDD6] hover:text-[#121826]',
                tab.count === 0 && 'cursor-not-allowed opacity-45',
              )}
            >
              {tab.label}
              <span className={cn(
                'tabular-nums',
                activeFeed === tab.label ? 'text-[#EA1F59]/80' : 'text-[#8B92A1]',
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {news.length === 0 ? (
        <EmptyState title="暂无真实股市新闻" body="公开新闻和公司公告暂未返回带发布时间与原文链接的内容。" />
      ) : filteredNews.length === 0 ? (
        <EmptyState title={`暂无${activeFeed}`} body="当前栏目没有可展示的真实内容，切换到全部可查看其他来源动态。" />
      ) : null}
      {items.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {items.map(({ item, index }) => (
            <DiscoveryNewsCard
              key={`${index}-${item.time}-${item.title}`}
              item={item}
              relatedToWatchlist={isExplicitWatchlistNews(item.symbols, watchlistSymbols)}
              onOpen={() => onOpenNews(index)}
            />
          ))}
        </div>
      ) : null}
      {filteredNews.length > pageSize || hasMore ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goPrevious}
            disabled={safePage === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E7E7EB] bg-white text-[#667085] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="上一页动态"
            title="上一页"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          {hasMore ? (
            <button
              type="button"
              onClick={() => void requestMore()}
              disabled={loadingMore}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#E7E7EB] bg-white px-3 text-[12px] font-medium text-[#667085] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {loadingMore ? '正在加载' : '加载更多'}
            </button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
            {pageIndexes.map((index, position) => (
              <React.Fragment key={index}>
                {position > 0 && index > pageIndexes[position - 1]! + 1 ? (
                  <span className="px-0.5 text-[11px] leading-none text-[#98A2B3]" aria-hidden>...</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPage(index)}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    index === safePage ? 'w-4 bg-[#121826]' : 'w-1.5 bg-[#D2D6DE] hover:bg-[#AEB5C2]',
                  )}
                  aria-label={`查看第 ${index + 1} 页动态`}
                  title={`第 ${index + 1} 页`}
                />
              </React.Fragment>
            ))}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={(safePage >= pageCount - 1 && !hasMore) || loadingMore}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E7E7EB] bg-white text-[#667085] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="下一页动态"
            title="下一页"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function MarketHighlights({
  stocks,
  marketIndices,
  updatedAt,
  loading,
  sample,
  canGenerateBriefing,
  onEdit,
  onGenerateBriefing,
  briefingGenerating,
  temporalCopy,
  temporalMode,
}: {
  stocks: StockSnapshot[];
  marketIndices: IndexRow[];
  updatedAt?: string;
  loading: boolean;
  sample: boolean;
  canGenerateBriefing: boolean;
  onEdit: () => void;
  onGenerateBriefing: () => void;
  briefingGenerating: boolean;
  temporalCopy: StockTemporalCopy;
  temporalMode: StockTemporalMode;
}): JSX.Element {
  const hasRealQuotes = stocks.some((stock) => stock.price !== '—' || stock.spark.length >= 2);
  const researchStocks = stocks.slice(0, 12);
  const firstResearchStock = researchStocks.find((stock) => stock.price !== '—' || stock.spark.length >= 2)
    ?? researchStocks[0]
    ?? null;
  const [selectedSymbol, setSelectedSymbol] = React.useState<string | null>(null);
  const selectedStock = researchStocks.find((stock) => stock.symbol === selectedSymbol)
    ?? firstResearchStock;
  const primaryIndex = marketIndices.find((row) => row.name.includes('上证')) ?? marketIndices[0] ?? null;
  return (
    <section className="min-w-0">
      {selectedStock ? (
        <StockStoryHero
          stock={selectedStock}
          updatedAt={updatedAt}
          temporalCopy={temporalCopy}
        />
      ) : null}
      {!hasRealQuotes ? (
        <div className="mt-3 rounded-[16px] border border-dashed border-[#DCD4E2] bg-[#FFFDFB] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[#332842]">真实行情同步中</div>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-[#716A7C]">
                Holaday 正在等待 AkShare 返回价格和走势；未拿到真实行情前，不放大空图表，也不使用模拟数据。
              </p>
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-[8px] border border-[#E1E3E8] bg-white px-3 text-[12px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59]"
            >
              管理关注
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {stocks.slice(0, 8).map((stock) => (
              <span key={stock.symbol} className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#E1E3E8] bg-white px-2.5 py-1.5 text-[12px] text-[#4F5868]">
                <span className="font-semibold text-[#121826]">{stock.name}</span>
                <span className="tabular-nums text-[#8B92A1]">{stock.symbol}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {hasRealQuotes && selectedStock ? (
        <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_292px]">
          <StockHighlightCard
            key={selectedStock.symbol}
            stock={selectedStock}
            marketIndex={primaryIndex}
            updatedAt={updatedAt}
            canGenerateBriefing={canGenerateBriefing}
            briefingGenerating={briefingGenerating}
            onGenerateBriefing={onGenerateBriefing}
            temporalCopy={temporalCopy}
            temporalMode={temporalMode}
          />
          <aside className="min-w-0" aria-label="我的关注股票">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold text-[#3E3154]">我的关注</h2>
                <span className="text-[10px] text-[#8A8192]">
                  {loading ? '同步中…' : sample ? `示例 ${stocks.length}` : `${stocks.length} 只`}
                </span>
              </div>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-11 min-[769px]:h-8 items-center rounded-[7px] px-2 text-[10px] font-semibold text-[#7A5A8E] transition hover:bg-[#F8F3FA] hover:text-[#C9184A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 motion-reduce:transition-none"
              >
                管理列表
              </button>
            </div>
            <StockResearchTable
              rows={researchStocks.map((stock) => ({
                symbol: stock.symbol,
                name: stock.name,
                price: formatStockPrice(stock),
                changePct: stock.price === '—' ? null : stock.changePct,
                turnover: stockTurnoverText(stock),
                note: stock.note,
                updatedAt: temporalCopy.researchTimestampLabel ?? formatUpdateTime(updatedAt),
              }))}
              selectedSymbol={selectedStock.symbol}
              onSelect={setSelectedSymbol}
            />
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function StockStoryHero({
  stock,
  updatedAt,
  temporalCopy,
}: {
  stock: StockSnapshot;
  updatedAt?: string;
  temporalCopy: StockTemporalCopy;
}): JSX.Element {
  const changeUnavailable = stock.price === '—';
  return (
    <div className="relative min-h-[172px] overflow-hidden rounded-[20px] border border-[#E9DEEC] bg-[#FFF7F3] shadow-[0_16px_40px_rgba(116,82,133,0.08)]">
      <picture className="contents">
        <source
          media="(max-width: 640px)"
          srcSet="/assets/stocks/stock-story-hero-v1-mobile.webp"
          type="image/webp"
        />
        <source
          srcSet="/assets/stocks/stock-story-hero-v1-desktop.webp"
          type="image/webp"
        />
        <img
          src="/assets/stocks/stock-story-hero-v1.png"
          alt=""
          aria-hidden="true"
          width="1774"
          height="887"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[64%_center]"
        />
      </picture>
      <div className="relative z-10 max-w-[70%] px-5 py-5 sm:max-w-[58%] sm:px-6">
        <p className="text-[10px] font-semibold tracking-[0.08em] text-[#7F648D]">
          关注中的股票 · {stock.symbol}
        </p>
        <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.035em] text-[#542043] sm:text-[28px]">
          {stock.name}{temporalCopy.storyTitleSuffix}
        </h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[22px] font-semibold tabular-nums text-[#25233A]">{formatStockPrice(stock)}</span>
          <span
            className={cn(
              'text-[18px] font-semibold tabular-nums',
              changeUnavailable || stock.changePct === 0
                ? 'text-[#667085]'
                : stock.changePct > 0
                  ? MARKET_UP_CLASS
                  : MARKET_DOWN_CLASS,
            )}
          >
            {changeUnavailable ? '—' : `${stock.changePct > 0 ? '+' : ''}${stock.changePct.toFixed(2)}%`}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-[#776D7D]">
          <span>{temporalCopy.updateLabel} {stockDataUpdatedAt(updatedAt)}</span>
          <span className="h-1 w-1 rounded-full bg-[#A874C4]" aria-hidden />
          <span>{temporalCopy.storyStatusLabel}</span>
        </div>
      </div>
    </div>
  );
}

function StockHighlightCard({
  stock,
  marketIndex,
  updatedAt,
  canGenerateBriefing,
  briefingGenerating,
  onGenerateBriefing,
  temporalCopy,
  temporalMode,
}: {
  stock: StockSnapshot;
  marketIndex: IndexRow | null;
  updatedAt?: string;
  canGenerateBriefing: boolean;
  briefingGenerating: boolean;
  onGenerateBriefing: () => void;
  temporalCopy: StockTemporalCopy;
  temporalMode: StockTemporalMode;
}): JSX.Element {
  const [hover, setHover] = React.useState<StockChartHover | null>(null);
  const chartKind = stock.sparkKind ?? 'daily_close';
  return (
    <article className="group overflow-hidden rounded-[18px] border border-[#E8E1EC] bg-white px-4 pb-4 pt-4 shadow-[0_12px_34px_rgba(95,73,112,0.055)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-[#D9CCDF] hover:shadow-[0_16px_34px_rgba(91,70,118,0.09)]">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#EEF5FF] text-[11px] font-semibold text-[#4269A5]">
                {stock.symbol.slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-[#121826]">{stock.name}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[#667085]">
                  <span className="tabular-nums">{stock.symbol}</span>
                  <span className="h-1 w-1 rounded-full bg-[#CBD0DA]" />
                  <span>{marketLabel(stock.market)}</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="whitespace-nowrap text-[22px] font-semibold leading-none tracking-normal tabular-nums text-[#25233A]">{formatStockPrice(stock)}</div>
              <StockChangeBadge value={stock.price === '—' ? null : stock.changePct} className="mt-1.5 justify-end" />
            </div>
          </div>
          {stock.spark.length >= 2 ? (
            <MarketMiniChart
              values={stock.spark}
              labels={stock.sparkLabels ?? []}
              kind={chartKind}
              baselineValue={stock.sparkBaseline ?? null}
              latestChangePct={stock.changePct}
              className="mt-4 h-[218px] w-full"
              hover={hover}
              onHoverChange={setHover}
              showTimeline
            />
          ) : (
            <div className="mt-4 flex h-[220px] flex-col items-center justify-center rounded-[13px] border border-dashed border-[#DCD4E2] bg-[#FBF9FD] px-4 text-center">
              <div className="text-[13px] font-medium text-[#667085]">最近交易日分时暂不可用</div>
              <div className="mt-1 max-w-[320px] text-[12px] leading-relaxed text-[#98A2B3]">
                已保留真实价格与成交数据；不使用模拟线，也不自动切换成日线。
              </div>
            </div>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-[#667085]">
            {stockNarrative(stock, marketIndex, temporalMode)}
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 self-start border-t border-[#F0ECF2] pt-3 lg:block lg:border-l lg:border-t-0 lg:pl-4 lg:pt-1">
          <StockRailMetric label="支撑 / 压力" value={stockRangeText(stock)} />
          <StockRailMetric label="价格位置" value={stockPositionText(stock)} meta={stockPositionMeta(stock)} tone={stockPositionTone(stock)} />
          <StockRailMetric label="成交额" value={stockTurnoverText(stock)} />
          <StockRailMetric label="成交活跃度" value={stockVolumeSignalText(stock)} meta={stockVolumeMeta(stock)} tone={stockVolumeTone(stock)} />
          <StockRailMetric label="市场" value={marketContextText(marketIndex)} meta={marketContextMeta(marketIndex)} tone={marketContextTone(marketIndex)} />
          <StockRailMetric label={temporalCopy.updateLabel} value={stockDataUpdatedAt(updatedAt)} meta={stockIntradayUpdatedMeta(stock)} />
          <div className="min-w-0 lg:mb-3.5">
            <StockRailMetric label="日报状态" value={stock.report} />
            {stock.report !== '已生成' ? (
              <button
                type="button"
                disabled={!canGenerateBriefing || briefingGenerating}
                onClick={onGenerateBriefing}
                className="mt-2 inline-flex h-11 min-[769px]:h-8 items-center justify-center rounded-[7px] border border-[#EA1F59]/20 bg-[#EA1F59]/10 px-2.5 text-[12px] font-medium text-[#EA1F59] transition hover:border-[#EA1F59]/40 hover:bg-[#EA1F59]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                {briefingGenerating ? '生成中…' : temporalCopy.briefingCommand}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 border-t border-[#F0ECF2] pt-3 sm:grid-cols-3">
        <StockEvidenceCard
          label="信号"
          title={stockVolumeSignalText(stock)}
          detail={stockVolumeMeta(stock) || '等待更多成交数据'}
          icon={TrendingUp}
          tone="mint"
        />
        <StockEvidenceCard
          label="背景"
          title={marketContextText(marketIndex)}
          detail={marketContextMeta(marketIndex) || '市场数据持续更新'}
          icon={FileText}
          tone="sky"
        />
        <StockEvidenceCard
          label="风险观察"
          title={stockPositionText(stock)}
          detail={stockPositionMeta(stock) || '继续观察价格与成交变化'}
          icon={ShieldAlert}
          tone="peach"
        />
      </div>
    </article>
  );
}

function StockEvidenceCard({
  label,
  title,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  title: string;
  detail: string;
  icon: typeof TrendingUp;
  tone: 'mint' | 'sky' | 'peach';
}): JSX.Element {
  const toneClass = tone === 'mint'
    ? 'border-[#D7EEE3] bg-[#F0FBF6] text-[#12835D]'
    : tone === 'sky'
      ? 'border-[#D9E8F6] bg-[#F0F8FF] text-[#3378B8]'
      : 'border-[#F2DFC9] bg-[#FFF6EB] text-[#C46D24]';
  return (
    <div className={cn('min-w-0 rounded-[13px] border px-3 py-2.5', toneClass)}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-white/80">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold">{label}</div>
          <div className="mt-0.5 truncate text-[11px] font-semibold text-[#3E354A]">{title}</div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#766E7F]">{detail}</p>
    </div>
  );
}

function WatchlistManagerSheet({
  open,
  onOpenChange,
  stocks,
  sample,
  saving,
  form,
  onFormChange,
  suggestions,
  searching,
  onPickSuggestion,
  onAdd,
  onUpdate,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stocks: WatchlistRow[];
  sample: boolean;
  saving: boolean;
  form: { symbol: string; market: Market; displayName: string; note: string };
  onFormChange: React.Dispatch<React.SetStateAction<{ symbol: string; market: Market; displayName: string; note: string }>>;
  suggestions: SymbolSuggestion[];
  searching: boolean;
  onPickSuggestion: (suggestion: SymbolSuggestion) => void;
  onAdd: () => void;
  onUpdate: (symbol: string, displayName: string, note: string) => void;
  onRemove: (symbol: string) => void;
}): JSX.Element {
  const normalizedSymbol = normalizeSymbol(form.symbol);
  const duplicateSymbol = Boolean(normalizedSymbol && stocks.some((row) => normalizeSymbol(row.symbol) === normalizedSymbol));
  const canAdd = normalizedSymbol.length > 0 && !saving && !duplicateSymbol;
  const [drafts, setDrafts] = React.useState<Record<string, { displayName: string; note: string }>>({});

  React.useEffect(() => {
    if (!open) return;
    setDrafts(Object.fromEntries(stocks.map((row) => [
      row.symbol,
      {
        displayName: row.displayName ?? '',
        note: row.note ?? '',
      },
    ])));
  }, [open, stocks]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-[420px] flex-col bg-white p-0 sm:max-w-[420px]">
        <SheetHeader className="border-b border-[#ECEEF3] px-5 py-4">
          <SheetTitle className="text-[17px] text-[#121826]">管理关注股票</SheetTitle>
          <SheetDescription className="text-[12px] text-[#667085]">
            添加股票后，Holaday 会用真实关注列表生成日报和每日提醒。
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {sample ? (
            <div className="mb-4 rounded-[8px] border border-[#E1E3E8] bg-[#FCFCFD] px-3 py-2 text-[12px] leading-relaxed text-[#4F5868]">
              当前页面展示的是示例关注。添加第一只股票后，示例会被你的真实列表替换。
            </div>
          ) : null}

          <form
            className="rounded-[8px] border border-[#E1E3E8] bg-white p-3"
            onSubmit={(event) => {
              event.preventDefault();
              onAdd();
            }}
          >
            <div className="grid grid-cols-[1fr_96px] gap-2">
              <label className="space-y-1">
                <span className="text-[12px] font-medium text-[#4F5868]">代码</span>
                <Input
                  value={form.symbol}
                  onChange={(event) => {
                    const nextSymbol = event.target.value;
                    onFormChange((prev) => ({
                      ...prev,
                      symbol: nextSymbol,
                      market: inferMarket(nextSymbol),
                    }));
                  }}
                  placeholder="600519 / NVDA"
                  className="h-9 rounded-[8px] border-[#DCDDDD] text-[13px]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] font-medium text-[#4F5868]">市场</span>
                <select
                  value={form.market}
                  onChange={(event) => onFormChange((prev) => ({ ...prev, market: event.target.value as Market }))}
                  className="h-9 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-2 text-[13px] text-[#121826] outline-none"
                >
                  <option value="A">A股</option>
                  <option value="US">美股</option>
                  <option value="HK">港股</option>
                </select>
              </label>
            </div>
            {form.market !== 'A' ? (
              <div className="mt-2 rounded-[7px] border border-[#E1E3E8] bg-[#FCFCFD] px-2.5 py-2 text-[11px] leading-relaxed text-[#667085]">
                当前实时行情优先支持 A 股。美股/港股可以加入关注列表，行情和走势接入前会明确显示暂不可用。
              </div>
            ) : null}
            {searching || suggestions.length > 0 ? (
              <div className="mt-2 overflow-hidden rounded-[8px] border border-[#E1E3E8] bg-[#FCFCFD]">
                {searching ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#667085]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    搜索股票中
                  </div>
                ) : null}
                {suggestions.slice(0, 5).map((suggestion) => (
                  <button
                    key={`${suggestion.symbol}-${suggestion.name}`}
                    type="button"
                    onClick={() => onPickSuggestion(suggestion)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-t border-[#F1F2F5] px-3 py-2 text-left first:border-t-0 hover:bg-white"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-[#121826]">{suggestion.name}</span>
                      <span className="block text-[11px] tabular-nums text-[#8B92A1]">{suggestion.symbol}</span>
                    </span>
                    <span className="rounded-[5px] border border-[#E1E3E8] px-1.5 py-0.5 text-[10px] text-[#667085]">
                      {marketLabel(suggestion.market as Market)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <label className="mt-3 block space-y-1">
              <span className="text-[12px] font-medium text-[#4F5868]">名称</span>
              <Input
                value={form.displayName}
                onChange={(event) => onFormChange((prev) => ({ ...prev, displayName: event.target.value }))}
                placeholder="可选，例如 贵州茅台"
                className="h-9 rounded-[8px] border-[#DCDDDD] text-[13px]"
              />
            </label>
            <label className="mt-3 block space-y-1">
              <span className="text-[12px] font-medium text-[#4F5868]">备注</span>
              <Input
                value={form.note}
                onChange={(event) => onFormChange((prev) => ({ ...prev, note: event.target.value }))}
                placeholder="可选，例如 长期关注白酒龙头"
                className="h-9 rounded-[8px] border-[#DCDDDD] text-[13px]"
              />
            </label>
            <button
              type="submit"
              disabled={!canAdd}
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] bg-[#EA1F59] px-3 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(234,31,89,0.18)] transition disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
              {duplicateSymbol ? '已在关注列表' : '添加关注'}
            </button>
            {duplicateSymbol ? (
              <div className="mt-2 rounded-[7px] bg-[#FCFCFD] px-2 py-1.5 text-[11px] leading-relaxed text-[#667085]">
                {normalizedSymbol} 已在真实关注列表中，可在下方直接编辑名称和备注。
              </div>
            ) : null}
          </form>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[#121826]">真实关注列表</h3>
              <span className="text-[11px] text-[#8B92A1]">{stocks.length} 只</span>
            </div>
            {stocks.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-[#DCDDDD] px-3 py-6 text-center text-[12px] leading-relaxed text-[#667085]">
                还没有添加关注股票。添加后，首页卡片、重点动态和日报都会优先使用你的列表。
              </div>
            ) : (
              <div className="divide-y divide-[#F1F2F5] overflow-hidden rounded-[8px] border border-[#E1E3E8]">
                {stocks.map((row) => {
                  const draft = drafts[row.symbol] ?? {
                    displayName: row.displayName ?? '',
                    note: row.note ?? '',
                  };
                  const changed =
                    draft.displayName.trim() !== (row.displayName ?? '') ||
                    draft.note.trim() !== (row.note ?? '');
                  return (
                  <div key={row.watchlistId} className="grid grid-cols-[1fr_auto] items-start gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-[#121826]">{row.symbol}</span>
                        <span className="rounded-[5px] border border-[#E1E3E8] px-1.5 py-0.5 text-[10px] text-[#667085]">
                          {marketLabel(row.market as Market)}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2">
                        <Input
                          value={draft.displayName}
                          onChange={(event) => {
                            const displayName = event.target.value;
                            setDrafts((prev) => ({
                              ...prev,
                              [row.symbol]: { ...draft, displayName },
                            }));
                          }}
                          placeholder="名称"
                          className="h-8 rounded-[7px] border-[#DCDDDD] text-[12px]"
                        />
                        <Input
                          value={draft.note}
                          onChange={(event) => {
                            const note = event.target.value;
                            setDrafts((prev) => ({
                              ...prev,
                              [row.symbol]: { ...draft, note },
                            }));
                          }}
                          placeholder="备注"
                          className="h-8 rounded-[7px] border-[#DCDDDD] text-[12px]"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={saving || !changed}
                        onClick={() => onUpdate(row.symbol, draft.displayName, draft.note)}
                        className="inline-flex h-8 items-center justify-center rounded-[8px] border border-[#E1E3E8] px-2 text-[12px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/30 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onRemove(row.symbol)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E1E3E8] text-[#667085] transition hover:border-[#EA1F59]/30 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`移除 ${row.symbol}`}
                        title={`移除 ${row.symbol}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InitialDashboardSkeleton(): JSX.Element {
  const bars = ['w-5/6', 'w-4/6', 'w-3/5'];
  return (
    <div className="min-w-0 space-y-7" aria-busy="true">
      <section aria-label="正在加载核心股市任务" className="min-w-0 space-y-5">
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="h-5 w-24 rounded-[6px] bg-[#ECEEF3]" />
              <div className="mt-2 h-3 w-32 rounded-[5px] bg-[#F1F2F5]" />
            </div>
            <div className="h-4 w-12 rounded-[5px] bg-[#F1F2F5]" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="min-h-[148px] rounded-[8px] border border-[#E7E7EB] bg-[#FEFEFF] p-3">
                <div className="h-4 w-16 rounded-[5px] bg-[#ECEEF3]" />
                <div className="mt-2 h-3 w-20 rounded-[5px] bg-[#F1F2F5]" />
                <div className="mt-6 h-6 w-24 rounded-[6px] bg-[#ECEEF3]" />
                <div className="mt-5 h-10 rounded-[6px] bg-[#F6F7F9]" />
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <div className="h-5 w-28 rounded-[6px] bg-[#ECEEF3]" />
          <div className="mt-4 rounded-[8px] border border-[#ECEEF3] bg-[#FCFCFD] px-4 py-4">
            <div className="h-4 w-3/5 rounded-[5px] bg-[#ECEEF3]" />
            <div className="mt-3 h-3 w-4/5 rounded-[5px] bg-[#F1F2F5]" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {bars.map((bar) => (
              <div key={bar} className="rounded-[8px] border border-[#ECEEF3] p-4">
                <div className="h-5 w-14 rounded-[6px] bg-[#F1F2F5]" />
                <div className={cn('mt-4 h-3 rounded-[5px] bg-[#F1F2F5]', bar)} />
                <div className="mt-3 h-3 w-4/5 rounded-[5px] bg-[#F1F2F5]" />
                <div className="mt-3 h-3 w-2/3 rounded-[5px] bg-[#F1F2F5]" />
              </div>
            ))}
          </div>
        </Panel>
      </section>
      <section aria-label="正在加载市场背景" className="min-w-0 space-y-3">
        <div className="h-5 w-20 rounded-[6px] bg-[#ECEEF3]" />
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12">
          {[0, 1, 2].map((item) => (
            <Panel key={item} className={item === 0 ? 'lg:col-span-8 lg:row-span-2' : 'lg:col-span-4'}>
              <div className="h-5 w-24 rounded-[6px] bg-[#ECEEF3]" />
              <div className="mt-5 space-y-3">
                <div className="h-4 w-5/6 rounded-[5px] bg-[#F1F2F5]" />
                <div className="h-4 w-4/6 rounded-[5px] bg-[#F1F2F5]" />
                <div className="h-4 w-3/5 rounded-[5px] bg-[#F1F2F5]" />
              </div>
            </Panel>
          ))}
        </div>
      </section>
    </div>
  );
}

function InsightSheet({
  sheet,
  onOpenChange,
}: {
  sheet: InsightSheetState | null;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const rows = sheet?.rows ?? [];
  return (
    <Sheet open={Boolean(sheet)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-[460px] flex-col bg-white p-0 sm:max-w-[460px]">
        <SheetHeader className="border-b border-[#ECEEF3] px-5 py-4">
          <SheetTitle className="text-[17px] text-[#121826]">{sheet?.title ?? '详情'}</SheetTitle>
          <SheetDescription className="text-[12px] leading-relaxed text-[#667085]">
            {sheet?.description ?? '当前数据详情'}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {rows.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[#DCDDDD] px-3 py-8 text-center text-[12px] text-[#667085]">
              暂无可展示数据。
            </div>
          ) : (
            <div className="divide-y divide-[#F1F2F5] overflow-hidden rounded-[8px] border border-[#E1E3E8]">
              {rows.map((row, index) => (
                <div key={`${row.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 text-[12px]">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#121826]">{row.label}</div>
                    {row.meta ? <div className="mt-0.5 text-[11px] leading-relaxed text-[#8B92A1]">{row.meta}</div> : null}
                  </div>
                  <div className="max-w-[180px] text-right">
                    <div className="break-words font-medium tabular-nums text-[#344054]">{row.value}</div>
                    {typeof row.changePct === 'number' ? (
                      <ChangeText value={row.changePct} compact className="mt-1 justify-end" />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DailyBriefing({
  stocks,
  marketIndices,
  sectors,
  news,
  leaderboards,
  updatedAt,
  observedTradeDate,
  briefing,
  generating,
  onGenerate,
  sampleWatchlist,
  hasMarketSignals,
  canGenerateBriefing,
  temporalCopy,
  temporalMode,
}: {
  stocks: StockSnapshot[];
  marketIndices: IndexRow[];
  sectors: SectorRow[];
  news: NewsRow[];
  leaderboards: NonNullable<DashboardSnapshot['leaderboards']>;
  updatedAt?: string;
  observedTradeDate?: string | null;
  briefing: GeneratedBriefing | null;
  generating: boolean;
  onGenerate: () => void;
  sampleWatchlist: boolean;
  hasMarketSignals: boolean;
  canGenerateBriefing: boolean;
  temporalCopy: StockTemporalCopy;
  temporalMode: StockTemporalMode;
}): JSX.Element {
  const quoteStocks = stocks.filter((stock) => stock.price !== '—');
  const riskStock = quoteStocks.find((s) => s.signal === '偏弱' || s.signal === '风险升高');
  const previewLines = briefing ? briefingPreviewLines(briefing.markdown) : [];
  const opportunityItems = dailyOpportunityItems(stocks, marketIndices, sectors, leaderboards.gainers);
  const riskItems = dailyRiskItems(stocks, marketIndices, news, leaderboards.losers, temporalMode);
  const trackingItems = dailyTrackingItems(stocks, news, leaderboards.amount, temporalMode);
  return (
    <section className="rounded-[8px] border border-[#E1E3E8] bg-white p-4 shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <SectionHeader
        title={temporalCopy.briefingTitle}
        meta={`更新于 ${formatUpdateTime(briefing?.generatedAt ?? updatedAt)}`}
        action={briefing ? '重新生成' : temporalCopy.briefingCommand}
        onAction={onGenerate}
        actionBusy={generating}
        actionDisabled={sampleWatchlist || !canGenerateBriefing}
      />
      <div className="mt-4 min-h-[90px] rounded-[8px] border border-[#ECEEF3] bg-gradient-to-r from-[#FFFFFF] to-[#FFF9FB] px-4 py-3">
        <div className="text-[15px] font-semibold text-[#121826]">
          {briefing
            ? `${briefing.title} 已生成`
            : !canGenerateBriefing && observedTradeDate
              ? `数据日期 ${formatObservedTradeDate(observedTradeDate)} 的历史行情仅供回看`
              : dailyBriefingHeadline(stocks, riskStock)}
        </div>
        <div className="mt-1 text-[12px] leading-relaxed text-[#667085]">
          {briefing
            ? '已复用当前自选股和 AkShare 数据生成日报，可继续用上方输入框追问。'
            : !canGenerateBriefing && observedTradeDate
              ? `此处展示 ${formatObservedTradeDate(observedTradeDate)} 的已收盘数据；新交易日行情到达后可生成日报。`
              : hasMarketSignals
              ? dailyBriefingSourceLine(
                  quoteStocks,
                  marketIndices,
                  sectors,
                  news,
                  leaderboards,
                  temporalMode,
                )
              : '当前真实市场数据不足。添加关注股票或稍后刷新后，可生成更完整的关注日报。'}
        </div>
      </div>
      {briefing ? (
        <div className="mt-4 rounded-[8px] border border-[#ECEEF3] bg-[#FCFCFD] px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-[#121826]">
            <FileText className="h-3.5 w-3.5 text-[#EA1F59]" aria-hidden />
            {briefing.title} · {formatUpdateTime(briefing.generatedAt)}
          </div>
          <ul className="space-y-1.5">
            {previewLines.map((line) => (
              <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-[#344054]">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#EA1F59]" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 grid grid-cols-1 overflow-hidden rounded-[8px] border border-[#ECEEF3] md:grid-cols-3">
        <BriefingLane
          tone="green"
          title={temporalCopy.opportunityTitle}
          items={opportunityItems}
          tags={stockTags(opportunityItems.length > 0 ? stocks : [])}
          empty={temporalCopy.opportunityEmpty}
        />
        <BriefingLane
          tone="red"
          title="风险"
          items={riskItems}
          tags={stockTags([riskStock, ...stocks].filter(Boolean) as StockSnapshot[])}
          empty="暂无真实风险信号"
        />
        <BriefingLane
          tone="blue"
          title="需要追踪"
          items={trackingItems}
          tags={trackingTags(news, leaderboards.amount)}
          empty="暂无真实追踪项"
        />
      </div>
    </section>
  );
}

function MarketTable({
  rows,
  className,
  onInspect,
  temporalCopy,
}: {
  rows: IndexRow[];
  className?: string;
  onInspect: () => void;
  temporalCopy: StockTemporalCopy;
}): JSX.Element {
  return (
    <Panel className={className}>
      <SectionHeader title="市场行情" meta="全球" action="查看详情" onAction={onInspect} />
      {rows.length === 0 ? (
        <EmptyState title="暂无真实行情数据" body="指数接口暂未返回可展示数据，刷新后会自动补齐。" />
      ) : null}
      <div className="mt-3">
        {rows.length > 0 ? (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_64px_46px] gap-1.5 border-b border-[#ECEEF3] pb-2 text-[12px] text-[#8B92A1]">
              <span>指数</span>
              <span className="text-right">{temporalCopy.priceLabel}</span>
              <span className="text-right">涨跌幅</span>
            </div>
            <div className="divide-y divide-[#F1F2F5]">
              {rows.map((row) => (
                <div
                  key={row.name}
                  className="grid grid-cols-[minmax(0,1fr)_64px_46px] items-center gap-1.5 py-2.5 text-[12px]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[#121826]">{row.name}</div>
                    <div className="whitespace-nowrap text-[10px] tabular-nums text-[#8B92A1]">成交 {row.turnover}</div>
                  </div>
                  <div className="text-right tabular-nums text-[#344054]">{row.price}</div>
                  <div className="text-right">
                    <ChangeText value={row.changePct} compact />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function SectorTrends({
  sectors,
  className,
  onInspect,
}: {
  sectors: SectorRow[];
  className?: string;
  onInspect: () => void;
}): JSX.Element {
  const topSector = sectors[0] ?? null;
  return (
    <Panel className={cn('flex h-full flex-col', className)}>
      <SectionHeader title="行业趋势" meta="涨幅榜" action="查看详情" onAction={onInspect} />
      {sectors.length === 0 ? (
        <EmptyState title="暂无真实行业数据" body="市场脉冲接口暂未返回行业排行，刷新后会自动补齐。" />
      ) : null}
      <div className="mt-3 space-y-1">
        {sectors.map((sector) => {
          const trendValues = sectorTrendValues(sector.spark);
          return (
            <div key={sector.name} className="grid grid-cols-[minmax(0,1fr)_auto_56px] items-center gap-3 border-b border-[#F1F2F5] py-2.5 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[#121826]">{sector.name}</div>
                <div className="truncate text-[11px] text-[#8B92A1]">{sector.leader} · {sector.flow}</div>
              </div>
              <ChangeText value={sector.changePct} compact />
              {trendValues ? (
                <Sparkline values={trendValues} positive={sector.changePct >= 0} className="h-6 w-14" />
              ) : null}
            </div>
          );
        })}
      </div>
      {topSector ? (
        <div className="mt-auto border-t border-[#ECEEF3] pt-4">
          <div className="text-[12px] font-semibold text-[#344054]">结构观察</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#667085]">
            <span>领涨方向 {sectors.length} 个</span>
            <span>
              最高涨幅 <span className={MARKET_UP_CLASS}>{formatSignedPct(topSector.changePct)}</span>
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[#667085]">
            当前热点集中在{topSector.name}，继续结合领涨股与成交变化核验持续性。
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

function StarStocks({
  stocks,
  className,
  onInspect,
  temporalCopy,
  temporalMode,
}: {
  stocks: StockSnapshot[];
  className?: string;
  onInspect: () => void;
  temporalCopy: StockTemporalCopy;
  temporalMode: StockTemporalMode;
}): JSX.Element {
  const ranked = stocks.filter(Boolean).slice(0, 6);
  return (
    <Panel className={className}>
      <SectionHeader
        title={temporalCopy.starTitle}
        meta={temporalCopy.starMeta}
        action="查看详情"
        onAction={onInspect}
      />
      {ranked.length === 0 ? (
        <EmptyState title="暂无真实明星股票" body="只有拿到真实价格的股票才会进入这里，不使用模拟热度填充。" />
      ) : null}
      <div className="mt-3">
        {ranked.length > 0 ? (
          <table className="w-full table-fixed text-[12px]">
            <colgroup>
              <col className="w-[39%]" />
              <col className="w-[25%]" />
              <col className="w-[22%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-[#ECEEF3] text-left text-[#8B92A1]">
                <th className="py-2 pr-2 font-medium">名称</th>
                <th className="px-1 py-2 text-right font-medium">{temporalCopy.priceLabel}</th>
                <th className="px-1 py-2 text-right font-medium">涨跌幅</th>
                <th className="py-2 pl-1 text-right font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((stock) => (
                <tr key={stock.symbol} className="border-b border-[#F1F2F5] last:border-0">
                  <td className="py-2 pr-2">
                    <div className="truncate font-medium text-[#121826]">{stock.name}</div>
                    <div className="truncate text-[11px] text-[#8B92A1]">{stock.symbol}</div>
                  </td>
                  <td className="px-1 py-2 text-right tabular-nums text-[#344054]">{stock.price}</td>
                  <td className="px-1 py-2 text-right">
                    <ChangeText value={stock.changePct} compact />
                  </td>
                  <td className="py-2 pl-1 text-right text-[11px] text-[#4F5868]">
                    {stockSignalLabel(stock.signal, temporalMode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Panel>
  );
}

function MarketTemperature({
  temperature,
  onInspect,
}: {
  temperature: DashboardSnapshot['temperature'] | null;
  onInspect: () => void;
}): JSX.Element {
  if (!temperature) {
    return (
      <Panel>
        <SectionHeader title="市场温度" action="详情" onAction={onInspect} />
        <EmptyState title="市场温度暂不可用" body="市场脉冲接口暂未返回涨跌家数、涨跌停或资金流数据。" />
      </Panel>
    );
  }
  const score = temperature.score;
  const mood = temperature.mood;
  return (
    <Panel className="flex h-full flex-col">
      <SectionHeader title="市场温度" action="详情" onAction={onInspect} />
      <div className="mt-4 flex items-center gap-4">
        <div className="relative h-[118px] w-[118px] shrink-0">
          <div className="absolute inset-0 rounded-full border-[11px] border-[#E8EBF0]" />
          <div className="absolute inset-0 rounded-full border-[11px] border-transparent border-l-[#18A76F] border-t-[#E0B30C] border-r-[#EA1F59] rotate-45" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[34px] font-semibold tabular-nums text-[#121826]">{score}</div>
            <div className="text-[12px] font-medium text-[#4F5868]">{mood}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3 text-[13px]">
          <MetricLine label="较昨日" value={formatDelta(temperature.dayDelta)} positive={deltaPositive(temperature.dayDelta)} />
          <MetricLine label="较上周" value={formatDelta(temperature.weekDelta)} positive={deltaPositive(temperature.weekDelta)} />
          <MetricLine label="历史位置" value={temperature.historicalPosition} />
        </div>
      </div>
      <MarketTemperatureDetails score={score} notes={temperature.notes} />
    </Panel>
  );
}

function Leaderboard({
  leaders,
  active,
  onActiveChange,
  onInspect,
}: {
  leaders: LeaderRow[];
  active: '涨幅榜' | '跌幅榜' | '成交额榜' | '换手率榜';
  onActiveChange: (value: '涨幅榜' | '跌幅榜' | '成交额榜' | '换手率榜') => void;
  onInspect: () => void;
}): JSX.Element {
  const tabs = [
    { label: '涨幅榜', enabled: true },
    { label: '跌幅榜', enabled: true },
    { label: '成交额榜', enabled: true },
    { label: '换手率榜', enabled: false },
  ] as const;
  return (
    <Panel>
      <SectionHeader title="榜单" />
      <div className="mt-3 flex gap-3 border-b border-[#ECEEF3]">
        {tabs.map((tab) => (
          <button
            key={tab.label}
            type="button"
            disabled={!tab.enabled}
            title={tab.enabled ? undefined : '当前 AkShare 可达源暂缺换手率字段'}
            onClick={() => onActiveChange(tab.label)}
            className={cn(
              'border-b-2 px-0.5 pb-2 text-[12px] font-medium transition-colors',
              active === tab.label
                ? 'border-[#EA1F59] text-[#EA1F59]'
                : 'border-transparent text-[#667085] hover:text-[#121826]',
              !tab.enabled && 'cursor-not-allowed opacity-45 hover:text-[#667085]',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-[#8B92A1]">
        当前展示 AkShare 全市场个股排行；换手率字段在可达源中暂缺，接入后会自动开放。
      </div>
      <div className="mt-3 divide-y divide-[#F1F2F5]">
        {leaders.length === 0 ? (
          <EmptyState title="暂无真实榜单数据" body="AkShare 排行接口暂未返回可展示个股，稍后刷新会自动更新。" />
        ) : null}
        {leaders.map((leader) => (
          <div key={leader.rank} className="grid grid-cols-[24px_1fr_auto] items-center gap-2 py-2.5 text-[12px]">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                leader.rank <= 3 ? 'bg-[#EA1F59] text-white' : 'bg-[#F2F3F6] text-[#667085]',
              )}
            >
              {leader.rank}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-[#121826]">{leader.name}</div>
              <div className="truncate text-[11px] text-[#8B92A1]">{leader.reason}</div>
            </div>
            <div className="text-right">
              <div className="tabular-nums text-[#344054]">{leader.price}</div>
              <ChangeText value={leader.changePct} compact />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onInspect}
        disabled={leaders.length === 0}
        className="mt-3 inline-flex w-full items-center justify-center gap-1 border-t border-[#F1F2F5] pt-3 text-[12px] font-medium text-[#4F5868] hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-50"
      >
        查看全部榜单
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Panel>
  );
}

function SectionHeader({
  title,
  meta,
  action,
  onAction,
  actionBusy,
  actionDisabled,
}: {
  title: string;
  meta?: string;
  action?: string;
  onAction?: () => void;
  actionBusy?: boolean;
  actionDisabled?: boolean;
}): JSX.Element {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h2 className="shrink-0 whitespace-nowrap text-[16px] font-semibold tracking-tight text-[#121826]">{title}</h2>
          {meta ? <span className="min-w-0 truncate text-[11px] text-[#8B92A1]">{meta}</span> : null}
        </div>
      </div>
      {action ? (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled || actionBusy || !onAction}
          className="inline-flex h-11 min-[769px]:h-8 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-[#4F5868] transition-colors hover:bg-[#FFF5F7] hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
        >
          {actionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {action}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </header>
  );
}

function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={cn('rounded-[8px] border border-[#E1E3E8] bg-white p-4 shadow-[0_8px_24px_rgba(18,24,38,0.035)]', className)}>
      {children}
    </section>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className="mt-3 rounded-[8px] border border-dashed border-[#DCDDDD] bg-[#FCFCFD] px-3 py-5 text-center">
      <div className="text-[13px] font-medium text-[#4F5868]">{title}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-[#8B92A1]">{body}</div>
    </div>
  );
}

function BriefingLane({
  title,
  items,
  tags,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tags: string[];
  tone: 'green' | 'red' | 'blue';
  empty: string;
}): JSX.Element {
  const toneClass = {
    green: 'text-[#08764A] bg-[#F2FCF8] border-[#D9F2E7]',
    red: 'text-[#B42318] bg-[#FFF5F4] border-[#FDDAD5]',
    blue: 'text-[#175CD3] bg-[#F5F9FF] border-[#D7E7FF]',
  }[tone];
  const bulletClass = {
    green: 'bg-[#0E9F6E]',
    red: 'bg-[#EA1F59]',
    blue: 'bg-[#175CD3]',
  }[tone];
  return (
    <div className="min-w-0 border-b border-[#ECEEF3] p-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={cn('rounded-[7px] border px-2 py-1 text-[13px] font-semibold', toneClass)}>
          {title}
        </span>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2 text-[12px] leading-relaxed text-[#344054]">
              <span className={cn('mt-2 h-1.5 w-1.5 shrink-0 rounded-full', bulletClass)} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-[8px] border border-dashed border-[#DCDDDD] bg-[#FCFCFD] px-3 py-5 text-center text-[12px] text-[#8B92A1]">
          {empty}
        </div>
      )}
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.map((tag, index) => (
            <span key={`${tag}-${index}`} className="rounded-[5px] border border-[#E1E3E8] bg-white px-1.5 py-0.5 text-[10px] text-[#667085]">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChangeText({
  value,
  compact = false,
  className,
}: {
  value: number;
  compact?: boolean;
  className?: string;
}): JSX.Element {
  if (value === 0) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-end whitespace-nowrap font-semibold tabular-nums text-[#667085]',
          compact ? 'text-[11px]' : 'text-[13px]',
          className,
        )}
      >
        0.00%
      </span>
    );
  }
  const positive = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-end gap-1 whitespace-nowrap font-semibold tabular-nums',
        compact ? 'text-[11px]' : 'text-[13px]',
        positive ? MARKET_UP_CLASS : MARKET_DOWN_CLASS,
        className,
      )}
    >
      {compact ? null : positive ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
      {positive ? '+' : ''}
      {value.toFixed(2)}%
    </span>
  );
}

function StockChangeBadge({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}): JSX.Element {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className={cn('inline-flex items-center rounded-[4px] bg-[#F2F4F7] px-1.5 py-1 text-[12px] font-semibold tabular-nums text-[#667085]', className)}>
        —
      </span>
    );
  }
  if (value === 0) {
    return (
      <span className={cn('inline-flex items-center rounded-[4px] bg-[#F2F4F7] px-1.5 py-1 text-[12px] font-semibold tabular-nums text-[#667085]', className)}>
        0.00%
      </span>
    );
  }
  const positive = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-[12px] font-semibold leading-none tabular-nums',
        positive ? 'bg-[#FDECF2] text-[#E11D48]' : 'bg-[#EAF7F0] text-[#0E9F6E]',
        className,
      )}
    >
      {positive ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
      {positive ? '+' : ''}
      {value.toFixed(2)}%
    </span>
  );
}

function StockRailMetric({
  label,
  value,
  meta,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: 'neutral' | 'red' | 'green' | 'muted';
}): JSX.Element {
  const valueClass = tone === 'red'
    ? MARKET_UP_CLASS
    : tone === 'green'
      ? MARKET_DOWN_CLASS
      : tone === 'muted'
        ? 'text-[#667085]'
        : 'text-[#121826]';
  return (
    <div className="min-w-0 lg:mb-3.5">
      <div className="text-[12px] font-medium leading-none text-[#777F8D]">{label}</div>
      <div className={cn('mt-2 text-[12px] font-semibold leading-tight tabular-nums', valueClass)}>{value}</div>
      {meta ? (
        <div className="mt-1 truncate text-[11px] leading-none text-[#98A2B3]">{meta}</div>
      ) : null}
    </div>
  );
}

function MetricLine({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}): JSX.Element {
  const valueClass = positive === true ? MARKET_UP_CLASS : positive === false ? MARKET_DOWN_CLASS : 'text-[#121826]';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[#667085]">{label}</span>
      <span className={cn('font-semibold tabular-nums', valueClass)}>
        {value}
      </span>
    </div>
  );
}

function Sparkline({
  values,
  positive,
  className,
}: {
  values: number[];
  positive: boolean;
  className?: string;
}): JSX.Element {
  const points = valuesToPoints(values);
  return (
    <svg className={className} viewBox="0 0 100 40" role="img" aria-label="走势">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? MARKET_UP_STROKE : MARKET_DOWN_STROKE}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MarketMiniChart({
  values,
  labels,
  kind,
  baselineValue,
  latestChangePct,
  className,
  hover,
  onHoverChange,
  showTimeline = false,
}: {
  values: number[];
  labels: string[];
  kind: 'daily_close' | 'intraday';
  baselineValue?: number | null;
  latestChangePct: number;
  className?: string;
  hover?: StockChartHover | null;
  onHoverChange?: (hover: StockChartHover | null) => void;
  showTimeline?: boolean;
}): JSX.Element {
  const gradientId = React.useId();
  const baseline = typeof baselineValue === 'number' && Number.isFinite(baselineValue) ? baselineValue : values[0] ?? Math.max(...values);
  const xRatios = kind === 'intraday' ? intradayXRatios(labels, values.length) : undefined;
  const chart = chartGeometry(values, [baseline], xRatios);
  const points = chart.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const linePath = smoothPathFromPoints(chart.points);
  const firstPoint = chart.points[0];
  const lastPoint = chart.points[chart.points.length - 1];
  const areaPath = linePath && firstPoint && lastPoint
    ? `${linePath} L ${lastPoint.x.toFixed(2)} 38 L ${firstPoint.x.toFixed(2)} 38 Z`
    : '';
  const activeRatio = hover?.ratio ?? 1;
  const activePoint = sampledChartPoint(values, chart, activeRatio, latestChangePct, baseline);
  const activeValue = activePoint.value;
  const activeChangePct = activePoint.changePct;
  const positive = activeChangePct >= 0;
  const strokeFallback = latestChangePct >= 0 ? MARKET_UP_STROKE : MARKET_DOWN_STROKE;
  const baselineY = chart.yForValue(baseline);
  const baselinePct = Math.max(0, Math.min(100, (baselineY / 48) * 100));
  const showHover = hover !== null;
  const hoverTooltipKind = showHover && hover
    ? stockChartHoverTooltipKind({
      pointerY: hover.y,
      baselineY,
    })
    : 'point';
  const showsBaselineTooltip = showHover && hoverTooltipKind === 'baseline';
  const cursorX = showHover
    ? chart.left + activeRatio * (chart.right - chart.left)
    : activePoint.x;
  const axisTicks = stockChartAxisTicks(labels, kind, MARKET_CHART_LEFT, MARKET_CHART_RIGHT);
  const tooltipValue = showsBaselineTooltip ? baseline : activeValue;
  const tooltipY = showsBaselineTooltip ? baselineY : activePoint.y;
  const tooltipMeta = showsBaselineTooltip
    ? kind === 'intraday' ? '昨日收盘价' : '首日收盘价'
    : kind === 'intraday'
      ? formatStockDateTimeLabel(labels[activePoint.index] ?? '')
      : `${formatStockDateLabel(labels[activePoint.index] ?? '')} 收盘`;
  const updateHoverFromClientPoint = (svg: SVGSVGElement, clientX: number, clientY: number): void => {
    if (!onHoverChange) return;
    const matrix = svg.getScreenCTM();
    let svgX: number;
    let svgY: number;
    if (matrix) {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const svgPoint = point.matrixTransform(matrix.inverse());
      svgX = svgPoint.x;
      svgY = svgPoint.y;
    } else {
      const rect = svg.getBoundingClientRect();
      svgX = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
      svgY = ((clientY - rect.top) / Math.max(1, rect.height)) * 48;
    }
    const ratio = (svgX - chart.left) / Math.max(1, chart.right - chart.left);
    onHoverChange({ ratio: Math.max(0, Math.min(1, ratio)), y: svgY });
  };
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    updateHoverFromClientPoint(event.currentTarget, event.clientX, event.clientY);
  };
  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    updateHoverFromClientPoint(event.currentTarget, event.clientX, event.clientY);
  };
  const handlePointerEnter = (event: React.PointerEvent<SVGSVGElement>): void => {
    updateHoverFromClientPoint(event.currentTarget, event.clientX, event.clientY);
  };
  const handleMouseEnter = (event: React.MouseEvent<SVGSVGElement>): void => {
    updateHoverFromClientPoint(event.currentTarget, event.clientX, event.clientY);
  };
  const handlePointerLeave = (): void => onHoverChange?.(null);
  return (
    <div className={cn('relative select-none', className)}>
      <svg
        className="h-full w-full touch-none overflow-visible"
        viewBox="0 0 100 48"
        preserveAspectRatio="none"
        role="img"
        aria-label="真实走势"
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handlePointerLeave}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="4" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={MARKET_UP_STROKE} />
            <stop offset={`${Math.max(0, baselinePct - 1)}%`} stopColor={MARKET_UP_STROKE} />
            <stop offset={`${Math.min(100, baselinePct + 1)}%`} stopColor={MARKET_DOWN_STROKE} />
            <stop offset="100%" stopColor={MARKET_DOWN_STROKE} />
          </linearGradient>
          <linearGradient id={`${gradientId}-fill`} x1="0" x2="0" y1="4" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={MARKET_UP_STROKE} stopOpacity="0.08" />
            <stop offset={`${Math.max(0, baselinePct - 1)}%`} stopColor={MARKET_UP_STROKE} stopOpacity="0.055" />
            <stop offset={`${Math.min(100, baselinePct + 1)}%`} stopColor={MARKET_DOWN_STROKE} stopOpacity="0.05" />
            <stop offset="100%" stopColor={MARKET_DOWN_STROKE} stopOpacity="0.075" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="48" rx="4" fill="#FEFEFF" />
        {showTimeline ? (
          <>
            {axisTicks.map((tick) => (
              <line key={tick.label} x1={tick.x} x2={tick.x} y1="5" y2="38" stroke="#ECEFF3" strokeWidth="0.34" />
            ))}
          </>
        ) : null}
        {[8, 18, 28, 38].map((y) => (
          <line key={y} x1={chart.left} x2={chart.right} y1={y} y2={y} stroke="#E8EBF0" strokeDasharray="0.35 1.45" strokeWidth="0.4" />
        ))}
        <line
          x1={chart.left}
          x2={chart.right}
          y1={baselineY}
          y2={baselineY}
          stroke="#A6ACB8"
          strokeDasharray="1.25 2.35"
          strokeOpacity="0.58"
          strokeWidth="0.52"
        />
        {areaPath ? <path d={areaPath} fill={`url(#${gradientId}-fill)`} /> : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="1.05"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <polyline
            points={points}
            fill="none"
            stroke={strokeFallback}
            strokeWidth="1.05"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {showHover ? (
          <>
            <line x1={cursorX} x2={cursorX} y1="4" y2="38" stroke="#9FA6B3" strokeWidth="0.48" />
            {!showsBaselineTooltip ? (
              <circle cx={activePoint.x} cy={activePoint.y} r="0.95" fill={positive ? MARKET_UP_STROKE : MARKET_DOWN_STROKE} stroke="white" strokeWidth="0.5" />
            ) : null}
          </>
        ) : null}
      </svg>
      {!showHover ? (
        <div
          className="pointer-events-none absolute rounded-[9px] border border-[#E1E4EA] bg-white px-2.5 py-1.5 text-[12px] font-medium tabular-nums text-[#767E8D] shadow-[0_1px_2px_rgba(18,24,38,0.04)]"
          style={{
            left: '69%',
            top: `${(Math.max(5, Math.min(31, baselineY - 0.2)) / 48) * 100}%`,
            transform: 'translateY(-50%)',
          }}
        >
          虚线={kind === 'intraday' ? '昨日收盘价' : '首日收盘价'}: {baseline.toFixed(2)}
        </div>
      ) : null}
      {showTimeline ? (
        <div className="pointer-events-none absolute inset-0">
          {axisTicks.map((tick, index) => (
            <span
              key={tick.label}
              className="absolute top-[93.75%] text-[12px] font-medium tabular-nums text-[#A5ADBA]"
              style={{
                left: `${tick.x}%`,
                transform: index === axisTicks.length - 1 ? 'translateX(-100%)' : index === 0 ? undefined : 'translateX(-50%)',
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      ) : null}
      {showHover ? (
        <div
          className="pointer-events-none absolute z-10 rounded-[7px] border border-[#DADDE5] bg-white px-2.5 py-1.5 text-left shadow-[0_8px_18px_rgba(18,24,38,0.11)]"
          style={{
            left: `${cursorX}%`,
            top: `${Math.max(9, Math.min(70, (tooltipY / 48) * 100 - 12))}%`,
            transform: cursorX > 76 ? 'translate(-100%, -50%)' : 'translate(10px, -50%)',
          }}
        >
          <div className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-[#344054]">{tooltipValue.toFixed(2)}</div>
          <div className="mt-0.5 whitespace-nowrap text-[11px] font-medium tabular-nums text-[#8B92A1]">
            {tooltipMeta}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function valuesToPoints(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 96 + 2;
      const y = 36 - ((value - min) / range) * 30;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function chartGeometry(values: number[], extraValues: number[] = [], xRatios?: number[]): {
  points: Array<{ x: number; y: number }>;
  yForValue: (value: number) => number;
  left: number;
  right: number;
} {
  const left = MARKET_CHART_LEFT;
  const right = MARKET_CHART_RIGHT;
  const domainValues = [...values, ...extraValues.filter((value) => Number.isFinite(value))];
  const min = Math.min(...domainValues);
  const max = Math.max(...domainValues);
  const range = max - min || 1;
  const yForValue = (value: number): number => 38 - ((value - min) / range) * 30;
  return {
    points: values.map((value, index) => ({
      x: ((xRatios?.[index] ?? (index / Math.max(1, values.length - 1))) * (right - left)) + left,
      y: yForValue(value),
    })),
    yForValue,
    left,
    right,
  };
}

function smoothPathFromPoints(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;
    const tension = 0.18;
    const cp1x = current.x + (next.x - previous.x) * tension;
    const cp1y = current.y + (next.y - previous.y) * tension;
    const cp2x = next.x - (afterNext.x - current.x) * tension;
    const cp2y = next.y - (afterNext.y - current.y) * tension;
    commands.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
    );
  }
  return commands.join(' ');
}

function sampledChartPoint(
  values: number[],
  chart: ReturnType<typeof chartGeometry>,
  ratio: number,
  latestChangePct: number,
  baseline: number,
): { x: number; y: number; value: number; changePct: number; index: number } {
  const latest = values[values.length - 1] ?? 0;
  const index = Math.max(0, Math.min(values.length - 1, Math.round(Math.max(0, Math.min(1, ratio)) * (values.length - 1))));
  const value = values[index] ?? latest;
  return {
    x: chart.points[index]?.x ?? chart.right,
    y: chart.points[index]?.y ?? chart.yForValue(value),
    value,
    changePct: index === values.length - 1 && Number.isFinite(latestChangePct)
      ? latestChangePct
      : baseline
        ? ((value - baseline) / baseline) * 100
        : 0,
    index,
  };
}

function intradayXRatios(labels: string[], count: number): number[] | undefined {
  if (count <= 0) return undefined;
  const ratios = labels
    .slice(0, count)
    .map((label) => intradayRatioFromLabel(label));
  if (ratios.length !== count || ratios.some((ratio) => ratio === null)) return undefined;
  return ratios.map((ratio) => ratio ?? 0);
}

function stockTradeDate(stock: StockSnapshot): string | null {
  return stock.sparkTradeDate ?? stockLabelDatePart(stock.sparkLabels?.[stock.sparkLabels.length - 1]);
}

function stockIntradayScope(stock: StockSnapshot): string {
  const label = formatStockTradeDateLabel(stockTradeDate(stock));
  return label === '-' ? '分时' : `${label} 分时`;
}

function stockMoveScope(stock: StockSnapshot): string {
  if (stock.sparkKind === 'intraday') {
    const label = formatStockTradeDateLabel(stockTradeDate(stock));
    return label === '-' ? '本交易日' : `${label} 交易日`;
  }
  return '最近交易日';
}

function stockRangeText(stock: StockSnapshot): string {
  if (stock.spark.length < 2) return '待补齐';
  const min = Math.min(...stock.spark);
  const max = Math.max(...stock.spark);
  return `${min.toFixed(2)} - ${max.toFixed(2)}`;
}

function stockDataUpdatedAt(updatedAt?: string): string {
  if (!updatedAt) return '待核验';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '待核验';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function stockIntradayUpdatedMeta(stock: StockSnapshot): string {
  const latestLabel = stock.sparkLabels?.[stock.sparkLabels.length - 1];
  if (stock.sparkKind === 'intraday' && latestLabel) {
    return `分时截至 ${formatStockDateTimeLabel(latestLabel)}`;
  }
  return stock.sparkKind === 'daily_close' ? '分钟线待补齐' : '行情时间待核验';
}

function stockTurnoverText(stock: StockSnapshot): string {
  return formatMoneyAuto(stock.turnoverAmount);
}

function stockVolumeSignalText(stock: StockSnapshot): string {
  const signal = stock.volumeSignal ?? '待观察';
  if (typeof stock.averageTurnoverAmount === 'number' && Number.isFinite(stock.averageTurnoverAmount)) {
    return `${signal}：${formatMoneyAuto(stock.averageTurnoverAmount)}`;
  }
  return signal;
}

function stockVolumeMeta(stock: StockSnapshot): string {
  if (typeof stock.turnoverAmount === 'number' && Number.isFinite(stock.turnoverAmount)) {
    return `本交易日成交额 ${formatMoneyAuto(stock.turnoverAmount)}`;
  }
  return '本交易日成交额待补齐';
}

function stockVolumeTone(stock: StockSnapshot): 'neutral' | 'red' | 'green' | 'muted' {
  if (stock.volumeSignal === '放量') return stock.changePct >= 0 ? 'red' : 'green';
  if (stock.volumeSignal === '缩量') return 'muted';
  return 'neutral';
}

function stockPositionText(stock: StockSnapshot): string {
  if (stock.spark.length < 2) return '分时待补齐';
  const min = Math.min(...stock.spark);
  const max = Math.max(...stock.spark);
  const latest = stock.spark[stock.spark.length - 1] ?? min;
  const range = max - min;
  if (range <= 0) return '区间持平';
  const pct = ((latest - min) / range) * 100;
  const scope = stock.sparkKind === 'intraday' ? stockIntradayScope(stock) : '近8日';
  if (pct >= 78) return `靠近${scope}高点`;
  if (pct <= 22) return `靠近${scope}低点`;
  return `${scope}区间中段`;
}

function stockPositionMeta(stock: StockSnapshot): string {
  if (stock.spark.length < 2) return '等待真实分钟线';
  return stock.sparkKind === 'intraday'
    ? `按${stockIntradayScope(stock)}低点到高点计算`
    : '按近8日收盘低高计算';
}

function stockPositionTone(stock: StockSnapshot): 'neutral' | 'red' | 'green' {
  const position = stockPositionText(stock);
  if (position.includes('高点')) return 'red';
  if (position.includes('低点')) return 'green';
  return 'neutral';
}

function stockNarrative(
  stock: StockSnapshot,
  marketIndex: IndexRow | null,
  temporalMode: StockTemporalMode = 'current',
): string {
  if (stock.price === '—') {
    return `${stock.name} 已在关注列表中，但行情源尚未返回可核验价格。Holaday 不会用模拟走势填充，建议稍后刷新或先查看公告来源。`;
  }
  const direction = stock.changePct >= 0 ? '上涨' : '回落';
  const moveScope = stockMoveScope(stock);
  const volume = stockVolumeSummary(stock);
  const market = marketSummary(marketIndex, stock);
  if (temporalMode === 'historical') {
    if (stock.spark.length < 2) {
      return `${stock.name} 在该数据日${direction} ${Math.abs(stock.changePct).toFixed(2)}%，价格与成交数据已核验，但当日分钟线暂缺。${volume}。${market}可结合当时公告继续回看原因。`;
    }
    const position = stockPositionText(stock);
    return `${stock.name} 在该数据日${direction} ${Math.abs(stock.changePct).toFixed(2)}%，收盘位置处于${position}；${volume}。${market}可结合当时公告继续回看原因。`;
  }
  if (stock.spark.length < 2) {
    return `${stock.name} ${moveScope}${direction} ${Math.abs(stock.changePct).toFixed(2)}%，真实价格与成交数据已返回，但最近交易日分钟线暂缺，Holaday 不会用模拟线或日线替代。${volume}。${market}稍后刷新可重试分时，详细原因和公告影响可生成日报。`;
  }
  const position = stockPositionText(stock);
  return `${stock.name} ${moveScope}${direction} ${Math.abs(stock.changePct).toFixed(2)}%，价格仍在${position}；${volume}。${market}详细原因和公告影响可生成日报。`;
}

function stockVolumeSummary(stock: StockSnapshot): string {
  const averageAmount = typeof stock.averageTurnoverAmount === 'number' && Number.isFinite(stock.averageTurnoverAmount)
    ? `（近7日均额 ${formatMoneyAuto(stock.averageTurnoverAmount)}）`
    : '';
  if (stock.volumeSignal === '放量') return `成交活跃度高于近7日均额${averageAmount}，说明本交易日参与度放大`;
  if (stock.volumeSignal === '缩量') return `成交活跃度低于近7日均额${averageAmount}，说明本交易日参与度偏弱`;
  if (stock.volumeSignal === '接近均量') return `成交活跃度接近近7日均额${averageAmount}，暂未出现明显放量`;
  return '近7日均额仍在补齐，暂不判断成交活跃度';
}

function marketSummary(index: IndexRow | null, stock: StockSnapshot): string {
  if (!index) return '大盘环境暂未补齐，先只看个股真实行情。';
  const stockWeakWhileMarketUp = index.changePct > 0.3 && stock.changePct < 0;
  const stockStrongWhileMarketDown = index.changePct < -0.3 && stock.changePct > 0;
  if (stockWeakWhileMarketUp) return '大盘偏强但个股未同步走强，需要结合公告和行业原因继续拆解。';
  if (stockStrongWhileMarketDown) return '大盘偏弱但个股相对抗跌，需要结合公告和资金热度继续拆解。';
  if (index.changePct > 0.3) return '大盘环境偏强，个股表现需继续和行业板块一起看。';
  if (index.changePct < -0.3) return '大盘环境偏弱，个股波动需要放在市场风险里看。';
  return '大盘整体较平稳，个股自身消息和成交变化更值得继续看。';
}

function marketContextText(index: IndexRow | null): string {
  if (!index) return '待补齐';
  return `${index.name} ${formatSignedPct(index.changePct)}`;
}

function marketContextMeta(index: IndexRow | null): string {
  if (!index || !index.turnover || index.turnover === '—') return '指数成交额待补齐';
  return `成交额 ${index.turnover}`;
}

function marketContextTone(index: IndexRow | null): 'neutral' | 'red' | 'green' | 'muted' {
  if (!index) return 'muted';
  if (index.changePct > 0) return 'red';
  if (index.changePct < 0) return 'green';
  return 'neutral';
}

function formatMoneyAuto(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '待补齐';
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿元`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)}万元`;
  return `${value.toFixed(0)}元`;
}

function formatStockPrice(stock: StockSnapshot): string {
  if (stock.price === '—') return '—';
  if (stock.market === 'A') return `RMB¥ ${stock.price}`;
  if (stock.market === 'HK') return `HK$ ${stock.price}`;
  if (stock.market === 'US') return `US$ ${stock.price}`;
  return stock.price;
}

function dashboardHasDisplayableData(snapshot: DashboardSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.trust?.mode === 'unavailable') return false;
  return Boolean(
    snapshot.watchlistStocks.some((stockRow) => stockRow.price !== '—' || stockRow.spark.length >= 2) ||
      snapshot.marketIndices.length > 0 ||
      snapshot.sectors.length > 0 ||
      snapshot.news.length > 0 ||
      snapshot.leaders.length > 0 ||
      snapshot.temperature,
  );
}

function preserveDisplayableDashboard(next: DashboardSnapshot, previous: DashboardSnapshot | null): DashboardSnapshot {
  if (next.trust?.mode === 'unavailable') return next;
  if (!previous || dashboardHasDisplayableData(next) || !dashboardHasDisplayableData(previous)) return next;
  return {
    ...previous,
    trust: next.trust,
    freshness: {
      ...next.freshness,
      status: 'stale',
      message: '行情源本次返回为空，当前继续展示上一次真实数据，后台会继续刷新。',
    },
  };
}

function buildStockRows(watchlist: WatchlistRow[] | null): StockSnapshot[] {
  if (!watchlist || watchlist.length === 0) {
    return [];
  }
  return watchlist.map((row) => unavailableSnapshot(row));
}

function unavailableSnapshot(row: WatchlistRow): StockSnapshot {
  return {
    symbol: row.symbol,
    name: row.displayName ?? row.symbol,
    market: row.market as Market,
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: row.note ?? '暂无真实行情，等待数据源返回',
  };
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function inferMarket(symbol: string): Market {
  const normalized = normalizeSymbol(symbol);
  if (/^\d{5}$/.test(normalized) || normalized.endsWith('.HK')) return 'HK';
  if (/^\d{6}$/.test(normalized)) return 'A';
  return 'US';
}

function marketLabel(market: Market): string {
  if (market === 'A') return 'A股';
  if (market === 'HK') return '港股';
  return '美股';
}

function pickActiveLeaders(
  active: '涨幅榜' | '跌幅榜' | '成交额榜' | '换手率榜',
  leaderboards: NonNullable<DashboardSnapshot['leaderboards']>,
): LeaderRow[] {
  if (active === '跌幅榜') return leaderboards.losers;
  if (active === '成交额榜') return leaderboards.amount;
  return leaderboards.gainers;
}

function realQuoteStocks(stocks: StockSnapshot[]): StockSnapshot[] {
  return stocks.filter((stock) => stock.price !== '—');
}

function dailyBriefingSourceLine(
  quoteStocks: StockSnapshot[],
  marketIndices: IndexRow[],
  sectors: SectorRow[],
  news: NewsRow[],
  leaderboards: NonNullable<DashboardSnapshot['leaderboards']>,
  temporalMode: StockTemporalMode,
): string {
  const announcementCount = news.filter((item) => item.category === '公告').length;
  const marketNewsCount = news.length - announcementCount;
  const parts = [
    quoteStocks.length > 0 ? `${quoteStocks.length} 只真实关注行情` : null,
    marketIndices.length > 0 ? `${marketIndices.length} 个市场指数` : null,
    sectors.length > 0 ? `${sectors.length} 条行业趋势` : null,
    news.length > 0 ? `${marketNewsCount} 条新闻 / ${announcementCount} 条公告` : null,
    leaderboards.gainers.length + leaderboards.losers.length + leaderboards.amount.length > 0 ? '榜单数据' : null,
  ].filter((part): part is string => part !== null);
  const prefix = temporalMode === 'historical' ? '本次回看仅使用已返回的真实数据' : '当前摘要仅使用已返回的真实数据';
  return parts.length > 0
    ? `${prefix}：${parts.join('、')}。`
    : temporalMode === 'historical'
      ? '该数据日没有可用于回看的真实市场数据。'
      : '当前没有可用于摘要的真实市场数据。';
}

function dailyOpportunityItems(
  stocks: StockSnapshot[],
  marketIndices: IndexRow[],
  sectors: SectorRow[],
  gainers: LeaderRow[],
): string[] {
  const items: string[] = [];
  const strongestStock = realQuoteStocks(stocks)
    .filter((stock) => stock.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)[0];
  if (strongestStock) {
    items.push(`${strongestStock.name} ${strongestStock.price}，本交易日 ${formatSignedPct(strongestStock.changePct)}，为关注列表中涨幅最高。`);
  }

  const strongestIndex = marketIndices
    .filter((index) => index.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)[0];
  if (strongestIndex) {
    items.push(`${strongestIndex.name} ${strongestIndex.price}，本交易日 ${formatSignedPct(strongestIndex.changePct)}，成交 ${strongestIndex.turnover}。`);
  }

  const topSector = sectors[0];
  if (topSector) {
    items.push(`${topSector.name} 行业 ${formatSignedPct(topSector.changePct)}，领涨股 ${topSector.leader || '未返回'}。`);
  }

  const topGainer = gainers[0];
  if (topGainer) {
    items.push(`涨幅榜第 ${topGainer.rank}：${topGainer.name} ${topGainer.price}，${formatSignedPct(topGainer.changePct)}。`);
  }
  return items.slice(0, 4);
}

function dailyRiskItems(
  stocks: StockSnapshot[],
  marketIndices: IndexRow[],
  news: NewsRow[],
  losers: LeaderRow[],
  temporalMode: StockTemporalMode,
): string[] {
  const items: string[] = [];
  const weakestStock = realQuoteStocks(stocks)
    .filter((stock) => stock.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)[0];
  if (weakestStock) {
    items.push(`${weakestStock.name} ${weakestStock.price}，本交易日 ${formatSignedPct(weakestStock.changePct)}，为关注列表中跌幅最大。`);
  }

  const weakestIndex = marketIndices
    .filter((index) => index.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)[0];
  if (weakestIndex) {
    items.push(`${weakestIndex.name} ${weakestIndex.price}，本交易日 ${formatSignedPct(weakestIndex.changePct)}，成交 ${weakestIndex.turnover}。`);
  }

  const announcements = news.filter((item) => item.category === '公告');
  if (announcements.length > 0) {
    const announcementLabel = temporalMode === 'historical' ? '其中' : '最新';
    items.push(`近 7 日返回 ${announcements.length} 条公告，${announcementLabel}：${announcements[0]!.title}`);
  }

  const topLoser = losers[0];
  if (topLoser) {
    items.push(`跌幅榜第 ${topLoser.rank}：${topLoser.name} ${topLoser.price}，${formatSignedPct(topLoser.changePct)}。`);
  }
  return items.slice(0, 4);
}

function dailyTrackingItems(
  stocks: StockSnapshot[],
  news: NewsRow[],
  amountLeaders: LeaderRow[],
  temporalMode: StockTemporalMode,
): string[] {
  const items: string[] = [];
  const latestMarketNews = news.find((item) => item.category !== '公告');
  if (latestMarketNews) {
    const newsLabel = temporalMode === 'historical' ? '当时动态：' : '最新动态：';
    items.push(`${newsLabel}${latestMarketNews.title}（${latestMarketNews.source ?? '公开来源'}）`);
  }

  const latestAnnouncement = news.find((item) => item.category === '公告');
  if (latestAnnouncement) {
    const announcementLabel = temporalMode === 'historical' ? '当时公告：' : '最新公告：';
    items.push(`${announcementLabel}${latestAnnouncement.title}`);
  }

  const mostLinkedStock = realQuoteStocks(stocks)
    .filter((stock) => stock.newsCount > 0)
    .sort((a, b) => b.newsCount - a.newsCount)[0];
  if (mostLinkedStock) {
    const linkedLabel = temporalMode === 'historical' ? '当时关联动态' : '当前关联动态';
    items.push(`${mostLinkedStock.name} ${linkedLabel} ${mostLinkedStock.newsCount} 条。`);
  }

  const amountLeader = amountLeaders[0];
  if (amountLeader) {
    items.push(`成交额榜第 ${amountLeader.rank}：${amountLeader.name} ${amountLeader.price}，${formatSignedPct(amountLeader.changePct)}。`);
  }
  return items.slice(0, 4);
}

function trackingTags(news: NewsRow[], amountLeaders: LeaderRow[]): string[] {
  const tags = [
    news.some((item) => item.category === '公告') ? '公告' : null,
    news.some((item) => item.category !== '公告') ? '新闻' : null,
    amountLeaders.length > 0 ? '成交额榜' : null,
  ].filter((tag): tag is string => tag !== null);
  return tags.slice(0, 3);
}

function dailyBriefingHeadline(stocks: StockSnapshot[], riskStock?: StockSnapshot): string {
  if (stocks.length === 0) return '添加关注股票后，Holaday 会生成你的每日关注日报。';
  const quoteStocks = realQuoteStocks(stocks);
  if (quoteStocks.length === 0) return '真实行情暂不可用，Holaday 不会使用模拟数据生成盘面判断。';
  const weakCount = quoteStocks.filter((stock) => stock.changePct < 0).length;
  const strong = [...quoteStocks].sort((a, b) => b.changePct - a.changePct)[0];
  if (weakCount >= Math.ceil(quoteStocks.length / 2)) {
    return `关注列表整体偏弱，${riskStock?.name ?? strong?.name ?? '重点标的'} 本交易日 ${formatSignedPct(riskStock?.changePct ?? strong?.changePct ?? 0)}。`;
  }
  if (strong && strong.changePct > 0) return `${strong.name} 本交易日 ${formatSignedPct(strong.changePct)}，为关注列表中相对活跃标的。`;
  return `关注列表已返回 ${quoteStocks.length} 只真实行情，暂无上涨标的。`;
}

function marketInsight(rows: IndexRow[], temporalMode: StockTemporalMode = 'current'): InsightSheetState {
  return {
    title: '市场行情',
    description: temporalMode === 'historical'
      ? '主要指数在该数据日的收盘点位、涨跌幅和成交额，仅用于历史回看。'
      : '主要指数的最新点位、涨跌幅和成交额，用于判断当前交易日的整体风险偏好。',
    rows: rows.map((row) => ({
      label: row.name,
      value: row.price,
      meta: `成交 ${row.turnover}`,
      changePct: row.changePct,
    })),
  };
}

function sectorInsight(sectors: SectorRow[], temporalMode: StockTemporalMode = 'current'): InsightSheetState {
  return {
    title: '行业趋势',
    description: temporalMode === 'historical'
      ? '按该数据日市场脉冲整理的行业表现和领涨线索，仅用于历史回看。'
      : '按市场脉冲整理的行业强弱和领涨线索，优先用于发现当日主线。',
    rows: sectors.map((sector) => ({
      label: sector.name,
      value: sector.leader,
      meta: sector.flow,
      changePct: sector.changePct,
    })),
  };
}

function starStockInsight(
  stocks: StockSnapshot[],
  temporalCopy: StockTemporalCopy,
  temporalMode: StockTemporalMode,
): InsightSheetState {
  return {
    title: temporalCopy.starTitle,
    description: temporalMode === 'historical'
      ? '仅展示该数据日已核验价格的关注股票，用于回看当日表现。'
      : '仅展示已拿到真实价格的关注股票，用于快速扫描当日异动。',
    rows: stocks.map((stock) => ({
      label: `${stock.name} ${stock.symbol}`,
      value: stock.price,
      meta: `${marketLabel(stock.market)} · ${stockSignalLabel(stock.signal, temporalMode)} · ${stock.note}`,
      changePct: stock.changePct,
    })),
  };
}

function newsDisplayType(item: NewsRow): '新闻' | '公告' {
  return item.category === '公告' ? '公告' : '新闻';
}

function newsFeed(item: NewsRow): NonNullable<NewsRow['feed']> {
  if (item.feed) return item.feed;
  return newsDisplayType(item) === '公告' ? '重要公告' : '自选股新闻';
}

function temperatureInsight(temperature: DashboardSnapshot['temperature'] | null): InsightSheetState {
  return {
    title: '市场温度',
    description: temperature
      ? '由涨跌家数、涨跌停、资金流等盘面指标估算，仅用于判断市场拥挤度和情绪方向。'
      : '市场脉冲接口暂未返回可展示数据，不展示模拟分数。',
    rows: temperature ? [
      {
        label: '温度分',
        value: String(temperature.score),
        meta: temperature.mood,
      },
      {
        label: '历史位置',
        value: temperature.historicalPosition,
        meta: '分数越高代表市场情绪越热',
      },
      ...temperature.notes.map((note, index) => ({
        label: `观察 ${index + 1}`,
        value: note,
      })),
    ] : [],
  };
}

function leaderboardInsight(
  active: string,
  leaders: LeaderRow[],
  temporalMode: StockTemporalMode = 'current',
): InsightSheetState {
  return {
    title: active,
    description: temporalMode === 'historical'
      ? '该数据日榜单来自 AkShare 全市场个股排行，仅用于历史回看。'
      : '当前榜单来自 AkShare 全市场个股排行，接口无数据时不展示模拟榜单。',
    rows: leaders.map((leader) => ({
      label: `${leader.rank}. ${leader.name}`,
      value: leader.price,
      meta: leader.reason,
      changePct: leader.changePct,
    })),
  };
}

function formatSignedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function stockTags(stocks: StockSnapshot[]): string[] {
  const tags = stocks.map((stock) => stock.symbol).filter(Boolean);
  const uniqueTags = Array.from(new Set(tags)).slice(0, 3);
  return uniqueTags;
}

function briefingPreviewLines(markdown: string): string[] {
  const lines = markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^[-*•\d.、\s]+/, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !/^(来源|数据来源|免责声明|仅供)/.test(line))
    .slice(0, 4);
  return lines.length > 0 ? lines : ['日报已生成，当前数据暂时没有更多可展示摘要。'];
}

function formatUpdateTime(value?: string): string {
  if (!value) return '加载中';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatObservedTradeDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}` : value;
}

function formatDelta(value: number | null | undefined): string {
  if (value == null) return '—';
  return value > 0 ? `+${value}` : String(value);
}

function deltaPositive(value: number | null | undefined): boolean | undefined {
  if (value == null || value === 0) return undefined;
  return value > 0;
}

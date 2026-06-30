import {
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronRight,
  ExternalLink,
  FileText,
  Heart,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
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
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';

type WatchlistRow = Awaited<ReturnType<typeof trpc.watchlists.list.query>>[number];
type BriefingStatus = Awaited<ReturnType<typeof trpc.watchlists.briefingStatus.query>>;
type DashboardSnapshot = Awaited<ReturnType<typeof trpc.stocks.dashboardSnapshot.query>>;
type SymbolSuggestion = Awaited<ReturnType<typeof trpc.stocks.searchSymbols.query>>[number];
type Market = 'A' | 'HK' | 'US';
type Signal = '强势' | '偏强' | '中性' | '偏弱' | '风险升高' | '待观察';

interface StockSnapshot {
  symbol: string;
  name: string;
  market: Market;
  price: string;
  changePct: number;
  signal: Signal;
  report: '已生成' | '待生成' | '生成中';
  spark: number[];
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
  category?: '公告' | '盘面' | '关注';
  time: string;
  title: string;
  symbols: string[];
  source?: string;
  url?: string;
}

type GeneratedBriefing = Awaited<ReturnType<typeof trpc.stocks.generateBriefingNow.mutate>>;

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

const STOCK_SNAPSHOTS: Record<string, StockSnapshot> = {
  NVDA: {
    symbol: 'NVDA',
    name: '英伟达',
    market: 'US',
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: '真实行情暂不可用',
  },
  TSLA: {
    symbol: 'TSLA',
    name: '特斯拉',
    market: 'US',
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: '真实行情暂不可用',
  },
  AAPL: {
    symbol: 'AAPL',
    name: '苹果公司',
    market: 'US',
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: '真实行情暂不可用',
  },
  MSFT: {
    symbol: 'MSFT',
    name: '微软',
    market: 'US',
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: '真实行情暂不可用',
  },
  '600519': {
    symbol: '600519',
    name: '贵州茅台',
    market: 'A',
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: '真实行情暂不可用',
  },
  '300750': {
    symbol: '300750',
    name: '宁德时代',
    market: 'A',
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: '真实行情暂不可用',
  },
  '0700.HK': {
    symbol: '0700.HK',
    name: '腾讯控股',
    market: 'HK',
    price: '—',
    changePct: 0,
    signal: '待观察',
    report: '待生成',
    spark: [],
    newsCount: 0,
    note: '真实行情暂不可用',
  },
};

const MARKET_INDICES: IndexRow[] = [];

const SECTORS: SectorRow[] = [];

const NEWS: NewsRow[] = [];

const LEADERS: LeaderRow[] = [];

function quickCommands(stocks: StockSnapshot[]): string[] {
  const first = stocks[0]?.symbol;
  const second = stocks[1]?.symbol;
  return [
    '生成今日关注日报',
    '哪些股票风险升高？',
    '今天 AI 板块怎么看？',
    first && second ? `比较 ${first} 和 ${second}` : first ? `分析 ${first} 的风险点` : '添加我的第一只关注股票',
  ];
}

const MARKET_UP_CLASS = 'text-[#E11D48]';
const MARKET_DOWN_CLASS = 'text-[#0E9F6E]';
const MARKET_UP_STROKE = '#E11D48';
const MARKET_DOWN_STROKE = '#0E9F6E';
const DISCOVERY_IMAGES = [
  'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?auto=format&fit=crop&w=900&q=80',
];
const STOCK_CHART_TIME_TICKS = [
  { x: 8, label: '5时' },
  { x: 31, label: '8时' },
  { x: 54, label: '11时' },
  { x: 77, label: '14时' },
  { x: 98, label: '17时' },
];

export function StockTasksPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const [watchlist, setWatchlist] = React.useState<WatchlistRow[] | null>(null);
  const [briefingStatus, setBriefingStatus] = React.useState<BriefingStatus | null>(null);
  const [dashboard, setDashboard] = React.useState<DashboardSnapshot | null>(null);
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
  const [watchlistSaving, setWatchlistSaving] = React.useState(false);
  const [stockForm, setStockForm] = React.useState({
    symbol: '',
    market: 'A' as Market,
    displayName: '',
    note: '',
  });
  const [symbolSuggestions, setSymbolSuggestions] = React.useState<SymbolSuggestion[]>([]);
  const [searchingSymbols, setSearchingSymbols] = React.useState(false);
  const [activeLeaderboard, setActiveLeaderboard] = React.useState<'涨幅榜' | '跌幅榜' | '成交额榜' | '换手率榜'>('涨幅榜');
  const pageAlive = React.useRef(true);
  const dashboardCompletionRetries = React.useRef(0);

  React.useEffect(() => {
    pageAlive.current = true;
    return () => {
      pageAlive.current = false;
    };
  }, []);

  const loadPageData = React.useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    let dashboardError: string | null = null;
    if (mode === 'initial') setLoadingDashboard(true);
    else setRefreshingDashboard(true);
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
        if (pageAlive.current) setDashboard(snapshot);
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
      if (snapshot) setDashboard(snapshot);
      setLoadError(dashboardError);
    } catch (err) {
      if (pageAlive.current) setLoadError(pageErrorMessage(err));
    } finally {
      if (!pageAlive.current) return;
      setLoadingDashboard(false);
      setRefreshingDashboard(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPageData('initial');
  }, [loadPageData]);

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
      if (pageAlive.current) void loadPageData('refresh');
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
  const marketIndices = dashboard?.marketIndices ?? MARKET_INDICES;
  const sectors = dashboard?.sectors ?? SECTORS;
  const news = dashboard?.news ?? NEWS;
  const leaderboards = dashboard?.leaderboards ?? {
    gainers: dashboard?.leaders ?? LEADERS,
    losers: dashboard?.leaders ?? LEADERS,
    amount: dashboard?.leaders ?? LEADERS,
  };
  const leaders = pickActiveLeaders(activeLeaderboard, leaderboards);
  const starStocks = dashboard?.starStocks ?? stocks.filter((stock) => stock.price !== '—').slice(0, 6);
  const temperature = dashboard?.temperature ?? null;
  const enabled = briefingStatus?.enabled === true;
  const sampleWatchlist = dashboard?.isFallbackWatchlist === true;
  const dashboardFreshness = dashboard?.freshness;
  const freshnessMessage = dashboardFreshness?.message;
  const realWatchlist = watchlist ?? [];
  const commands = React.useMemo(() => quickCommands(stocks), [stocks]);
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
    if (sampleWatchlist) return;
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
  }, [briefingGenerating, loadingDashboard, sampleWatchlist, toast]);

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
      setStockForm({ symbol: '', market: 'A', displayName: '', note: '' });
      setBriefingResult(null);
      await loadPageData('refresh');
    } catch (err) {
      const message = pageErrorMessage(err);
      setLoadError(message);
      toast.show(message, 'error');
    } finally {
      setWatchlistSaving(false);
    }
  }, [loadPageData, stockForm, toast, watchlistSaving]);

  const removeWatchlistStock = React.useCallback(async (symbol: string) => {
    if (watchlistSaving) return;
    setWatchlistSaving(true);
    setLoadError(null);
    try {
      await trpc.watchlists.remove.mutate({ symbol });
      toast.show(`已移除 ${symbol}`);
      setBriefingResult(null);
      await loadPageData('refresh');
    } catch (err) {
      const message = pageErrorMessage(err);
      setLoadError(message);
      toast.show(message, 'error');
    } finally {
      setWatchlistSaving(false);
    }
  }, [loadPageData, toast, watchlistSaving]);

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
      await loadPageData('refresh');
    } catch (err) {
      const message = pageErrorMessage(err);
      setLoadError(message);
      toast.show(message, 'error');
    } finally {
      setWatchlistSaving(false);
    }
  }, [loadPageData, toast, watchlistSaving]);

  const submitPrompt = React.useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || submitting) return;
      setSubmitting(true);
      const result = await createTask(toStockIntent(trimmed, stocks));
      setSubmitting(false);
      if ('taskId' in result) {
        navigate(`/?task=${encodeURIComponent(result.taskId)}`);
      }
    },
    [createTask, navigate, stocks, submitting],
  );

  const toggleBriefing = React.useCallback(async () => {
    if (loadingDashboard) return;
    if (briefingBusy || sampleWatchlist) return;
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
  }, [briefingBusy, enabled, loadingDashboard, sampleWatchlist]);

  return (
    <div className="min-h-full bg-[#FAFAFB] text-[#121826]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-5 sm:px-5 lg:px-6">
        <header className="flex flex-col gap-3 border-b border-[#E7E7EB] pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#121826]">
              股市任务
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D9F2E7] bg-[#F2FCF8] px-2.5 py-1 text-[12px] font-medium text-[#08764A]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10A66E]" />
              {dashboardStatusLabel({ loading: loadingDashboard, dashboard })}
            </span>
            <span className="text-[12px] text-[#7D8493]">{formatUpdateTime(dashboard?.updatedAt)} 更新</span>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-[#4F5868]">
            <button
              type="button"
              onClick={() => void loadPageData('refresh')}
              disabled={refreshingDashboard || loadingDashboard}
              className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 transition-colors hover:border-[#EA1F59]/30 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshingDashboard || loadingDashboard ? 'animate-spin' : '')} aria-hidden />
              刷新
            </button>
            <button
              type="button"
              onClick={() => void generateBriefing()}
              disabled={briefingGenerating || loadingDashboard || sampleWatchlist}
              title={sampleWatchlist ? '添加真实关注股票后可生成日报' : undefined}
              className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 transition-colors hover:border-[#EA1F59]/30 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {briefingGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
              生成日报
            </button>
            <button
              type="button"
              onClick={toggleBriefing}
              disabled={briefingBusy || loadingDashboard || sampleWatchlist}
              title={sampleWatchlist ? '添加关注股票后可开启日报' : undefined}
              className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 transition-colors hover:border-[#EA1F59]/30 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-60"
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
        {freshnessMessage ? (
          <div className="rounded-[8px] border border-[#E1E3E8] bg-white px-4 py-3 text-[13px] text-[#4F5868]">
            {refreshingDashboard ? '刷新中：' : null}{freshnessMessage}
          </div>
        ) : refreshingDashboard && dashboard ? (
          <div className="rounded-[8px] border border-[#E1E3E8] bg-white px-4 py-3 text-[13px] text-[#4F5868]">
            正在后台刷新行情，当前看板保持最近一次真实数据。
          </div>
        ) : null}
        {sampleWatchlist && !loadingDashboard ? (
          <div className="rounded-[8px] border border-[#E1E3E8] bg-white px-4 py-3 text-[13px] text-[#4F5868]">
            当前显示示例关注列表；添加自己的关注股票后，可生成专属日报并接收每日提醒。
          </div>
        ) : null}

        <section className="rounded-[8px] border border-[#E1E3E8] bg-white p-2 shadow-[0_10px_30px_rgba(18,24,38,0.04)]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitPrompt(prompt);
            }}
            className="flex min-h-[68px] items-center gap-3 rounded-[6px] border border-transparent bg-[#FCFCFD] px-3 transition-colors focus-within:border-[#EA1F59]/30"
          >
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="问股票、市场、行业，或生成我的关注日报"
              className="min-w-0 flex-1 bg-transparent text-[17px] font-medium text-[#121826] outline-none placeholder:text-[#9AA1AE]"
            />
            <button
              type="submit"
              disabled={submitting || !prompt.trim()}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[#EA1F59] text-white shadow-[0_10px_24px_rgba(234,31,89,0.22)] transition disabled:cursor-not-allowed disabled:opacity-55"
              aria-label="提交股市任务"
              title="提交股市任务"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
          <div className="flex flex-wrap gap-2 border-t border-[#EFEFF2] px-2 py-2">
            {commands.map((command) => (
              <button
                key={command}
                type="button"
                disabled={loadingDashboard || (command === '生成今日关注日报' && sampleWatchlist)}
                title={command === '生成今日关注日报' && sampleWatchlist ? '添加真实关注股票后可生成日报' : undefined}
                onClick={() => {
                  setPrompt(command);
                  if (command === '生成今日关注日报') void generateBriefing();
                  else void submitPrompt(command);
                }}
                className="inline-flex h-9 items-center rounded-[8px] border border-[#E1E3E8] bg-white px-3 text-[13px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/25 hover:bg-[#FFF7FA] hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {command}
              </button>
            ))}
          </div>
        </section>

        {initialDashboardLoading ? (
          <InitialDashboardSkeleton />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <main className="min-w-0 space-y-5">
              <DiscoveryPanel
                news={news}
                onInspect={() => setInsightSheet(newsInsight(news))}
              />
              <MarketHighlights
                stocks={stocks}
                loading={(loadingDashboard && dashboard === null) || refreshingDashboard || dashboardFreshness?.status === 'partial'}
                sample={sampleWatchlist}
                onEdit={() => setWatchlistSheetOpen(true)}
              />
              <DailyBriefing
                stocks={stocks}
                updatedAt={dashboard?.updatedAt}
                briefing={briefingResult}
                generating={briefingGenerating}
                onGenerate={generateBriefing}
                sampleWatchlist={sampleWatchlist}
                hasMarketSignals={hasMarketSignals}
              />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <MarketTable
                  rows={marketIndices}
                  onInspect={() => setInsightSheet(marketInsight(marketIndices))}
                />
                <StarStocks
                  stocks={starStocks}
                  onInspect={() => setInsightSheet(starStockInsight(starStocks))}
                />
              </div>
            </main>

            <aside className="space-y-5">
              <MarketTemperature
                temperature={temperature}
                onInspect={() => setInsightSheet(temperatureInsight(temperature))}
              />
              <SectorTrends
                sectors={sectors}
                onInspect={() => setInsightSheet(sectorInsight(sectors))}
              />
              <Leaderboard
                leaders={leaders}
                active={activeLeaderboard}
                onActiveChange={setActiveLeaderboard}
                onInspect={() => setInsightSheet(leaderboardInsight(activeLeaderboard, leaders))}
              />
            </aside>
          </div>
        )}

        <footer className="flex flex-col gap-2 border-t border-[#E7E7EB] pt-3 text-[11px] text-[#8B92A1] sm:flex-row sm:items-center sm:justify-between">
          <span>仅供信息分析，不构成投资建议</span>
          <span>数据来源：AkShare / Holaday 分析层 · 更新时间：{formatUpdateTime(dashboard?.updatedAt)}</span>
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
    </div>
  );
}

function DiscoveryPanel({
  news,
  onInspect,
}: {
  news: NewsRow[];
  onInspect: () => void;
}): JSX.Element {
  const items = news.slice(0, 3);
  return (
    <section className="rounded-[8px] border border-[#E1E3E8] bg-white p-4 shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <SectionHeader title="发现" meta={items.length > 0 ? `${items.length} 条来源动态` : '等待真实来源'} action="查看详情" onAction={onInspect} />
      {items.length === 0 ? (
        <EmptyState title="暂无真实股市新闻" body="公告、市场脉冲和自选股行情暂未返回可展示内容。" />
      ) : null}
      {items.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {items.map((item, index) => (
            <article
              key={`${item.time}-${item.title}`}
              className="min-w-0 overflow-hidden rounded-[8px] border border-[#E7E7EB] bg-white shadow-[0_10px_24px_rgba(18,24,38,0.04)] transition hover:-translate-y-0.5 hover:border-[#EA1F59]/25 hover:shadow-[0_16px_32px_rgba(18,24,38,0.08)] motion-reduce:hover:translate-y-0"
            >
              <div
                className="relative h-[150px] bg-[#EEF1F6] bg-cover bg-center"
                style={{ backgroundImage: `linear-gradient(180deg, rgba(18,24,38,0.04), rgba(18,24,38,0.22)), url(${DISCOVERY_IMAGES[index % DISCOVERY_IMAGES.length]})` }}
              >
                <div className="absolute left-3 top-3 flex items-center gap-2">
                  <span className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium text-[#344054] shadow-sm">
                    {item.category ?? '动态'}
                  </span>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] tabular-nums text-[#667085] shadow-sm">
                    {item.time}
                  </span>
                </div>
              </div>
              <div className="p-3">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group line-clamp-2 min-h-[48px] text-[15px] font-semibold leading-relaxed text-[#344054] hover:text-[#EA1F59]"
                  >
                    {item.title}
                    <ExternalLink className="ml-1 inline h-3 w-3 opacity-60 transition group-hover:opacity-100" aria-hidden />
                  </a>
                ) : (
                  <p className="line-clamp-2 min-h-[48px] text-[15px] font-semibold leading-relaxed text-[#344054]">{item.title}</p>
                )}
                <div className="mt-4 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <NewsSourceDots count={item.symbols.length || 1} />
                    <span className="truncate text-[12px] text-[#667085]">
                      {item.source ?? '公开来源'} · {Math.max(1, item.symbols.length)} 个关联
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-[#8B92A1] transition hover:bg-[#F7F8FA] hover:text-[#EA1F59]"
                      aria-label="收藏动态"
                      title="收藏动态"
                    >
                      <Heart className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full p-1.5 text-[#8B92A1] transition hover:bg-[#F7F8FA] hover:text-[#344054]"
                      aria-label="更多动态操作"
                      title="更多动态操作"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MarketHighlights({
  stocks,
  loading,
  sample,
  onEdit,
}: {
  stocks: StockSnapshot[];
  loading: boolean;
  sample: boolean;
  onEdit: () => void;
}): JSX.Element {
  const hasRealQuotes = stocks.some((stock) => stock.price !== '—' || stock.spark.length >= 2);
  const highlightStocks = stocks.filter((stock) => stock.price !== '—' || stock.spark.length >= 2).slice(0, 4);
  return (
    <section className="rounded-[8px] border border-[#E1E3E8] bg-white p-4 shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <SectionHeader
        title="亮点"
        meta={loading ? '同步自选股中…' : sample ? `示例关注 · ${stocks.length} 只` : `${stocks.length} 只关注股票`}
        action="编辑"
        onAction={onEdit}
      />
      {!hasRealQuotes ? (
        <div className="mt-4 rounded-[8px] border border-dashed border-[#D7DAE2] bg-[#FCFCFD] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[14px] font-semibold text-[#121826]">真实行情同步中</div>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-[#667085]">
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
      {hasRealQuotes ? (
        <div className="mt-4 space-y-3">
          {highlightStocks.map((stock) => (
            <StockHighlightCard
              key={stock.symbol}
              stock={stock}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function StockHighlightCard({ stock }: { stock: StockSnapshot }): JSX.Element {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const display = stockDisplayPoint(stock, hoverIndex);
  return (
    <article className="group overflow-hidden rounded-[10px] border border-[#E7E7EB] bg-[#FEFEFF] px-4 pb-4 pt-4 transition-[border-color,box-shadow] hover:border-[#DADDE5] hover:shadow-[0_14px_28px_rgba(18,24,38,0.06)]">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_156px]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-[#0B4AA2] text-[11px] font-semibold text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.18)]">
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
              <div className="text-[22px] font-medium leading-none tracking-normal tabular-nums text-[#121826]">{display.price}</div>
              <StockChangeBadge value={display.changePct} className="mt-1.5 justify-end" />
            </div>
          </div>
          {stock.spark.length >= 2 ? (
            <MarketMiniChart
              values={stock.spark}
              latestChangePct={stock.changePct}
              className="mt-4 h-[218px] w-full"
              hoverIndex={hoverIndex}
              onHoverIndexChange={setHoverIndex}
              showTimeline
            />
          ) : (
            <div className="mt-4 flex h-[220px] items-center justify-center rounded-[7px] border border-dashed border-[#D7DAE2] bg-[#F7F8FA] text-[12px] text-[#8B92A1]">
              暂无真实走势
            </div>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-[#667085]">
            {stockNarrative(stock)}
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 self-start border-t border-[#F0F1F4] pt-3 lg:block lg:border-l lg:border-t-0 lg:pl-4 lg:pt-1">
          <StockRailMetric label="8日区间" value={stockRangeText(stock)} />
          <StockRailMetric label="区间位置" value={stockPositionText(stock)} tone={stock.changePct >= 0 ? 'red' : 'green'} />
          <StockRailMetric label="关注源" value={`${stock.newsCount} 条`} />
          <StockRailMetric label="日报状态" value={stock.report} />
        </div>
      </div>
    </article>
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
    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true">
      <main className="min-w-0 space-y-5">
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
      </main>
      <aside className="space-y-5">
        {[0, 1, 2].map((item) => (
          <Panel key={item}>
            <div className="h-5 w-24 rounded-[6px] bg-[#ECEEF3]" />
            <div className="mt-5 space-y-3">
              <div className="h-4 w-5/6 rounded-[5px] bg-[#F1F2F5]" />
              <div className="h-4 w-4/6 rounded-[5px] bg-[#F1F2F5]" />
              <div className="h-4 w-3/5 rounded-[5px] bg-[#F1F2F5]" />
            </div>
          </Panel>
        ))}
      </aside>
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
  updatedAt,
  briefing,
  generating,
  onGenerate,
  sampleWatchlist,
  hasMarketSignals,
}: {
  stocks: StockSnapshot[];
  updatedAt?: string;
  briefing: GeneratedBriefing | null;
  generating: boolean;
  onGenerate: () => void;
  sampleWatchlist: boolean;
  hasMarketSignals: boolean;
}): JSX.Element {
  const quoteStocks = stocks.filter((stock) => stock.price !== '—');
  const riskStock = quoteStocks.find((s) => s.signal === '偏弱' || s.signal === '风险升高');
  const leadStock = [...quoteStocks].sort((a, b) => b.changePct - a.changePct)[0];
  const hasPositiveLeader = Boolean(leadStock && leadStock.changePct > 0);
  const previewLines = briefing ? briefingPreviewLines(briefing.markdown) : [];
  return (
    <section className="rounded-[8px] border border-[#E1E3E8] bg-white p-4 shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <SectionHeader
        title="今日关注日报"
        meta={`更新于 ${formatUpdateTime(briefing?.generatedAt ?? updatedAt)}`}
        action={briefing ? '重新生成' : '立即生成'}
        onAction={onGenerate}
        actionBusy={generating}
        actionDisabled={sampleWatchlist}
      />
      <div className="mt-4 rounded-[8px] border border-[#ECEEF3] bg-gradient-to-r from-[#FFFFFF] to-[#FFF9FB] px-4 py-3">
        <div className="text-[15px] font-semibold text-[#121826]">
          {briefing ? `${briefing.title} 已生成` : dailyBriefingHeadline(stocks, riskStock)}
        </div>
        <div className="mt-1 text-[12px] leading-relaxed text-[#667085]">
          {briefing
            ? '已复用当前自选股和 AkShare 数据生成日报，可继续用上方输入框追问。'
            : hasMarketSignals
              ? 'Holaday 会优先使用已接入的真实行情、公告、市场动态和榜单数据生成摘要。'
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
          title="机会"
          items={[
            hasPositiveLeader
              ? `${leadStock?.name ?? leadStock?.symbol} 相对活跃，今日涨跌幅 ${formatSignedPct(leadStock?.changePct ?? 0)}`
              : '关注列表暂无明确强势个股，先等待价格企稳和成交确认',
            '优先跟踪公告、资金流和行业主线是否形成同向信号',
            '若指数企稳，可关注先于市场修复的自选标的',
            '短线事件催化需要结合来源和时间戳复核',
          ]}
          tags={stockTags(stocks, ['机会'])}
        />
        <BriefingLane
          tone="red"
          title="风险"
          items={[
            riskStock
              ? `${riskStock.name} 走势偏弱，今日涨跌幅 ${formatSignedPct(riskStock.changePct)}`
              : '关注列表暂未出现明显风险升高信号',
            '市场温度偏低时，弱势标的更容易放大波动',
            '公告和盘面异动需要区分事实、观点与社区情绪',
            '日报仅聚合公开信息，不提供买卖建议',
          ]}
          tags={stockTags([riskStock, ...stocks].filter(Boolean) as StockSnapshot[], ['风险'])}
        />
        <BriefingLane
          tone="blue"
          title="需要追踪"
          items={[
            '自选股是否有新公告、解禁或龙虎榜信息',
            '行业趋势是否连续两次刷新保持一致',
            '指数成交额与市场温度是否同步改善',
            '重点动态的来源链接和发布时间',
          ]}
          tags={['公告', '资金', '行业']}
        />
      </div>
    </section>
  );
}

function MarketTable({
  rows,
  className,
  onInspect,
}: {
  rows: IndexRow[];
  className?: string;
  onInspect: () => void;
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
              <span className="text-right">最新价</span>
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
  return (
    <Panel className={className}>
      <SectionHeader title="行业趋势" meta="涨幅榜" action="查看详情" onAction={onInspect} />
      {sectors.length === 0 ? (
        <EmptyState title="暂无真实行业数据" body="市场脉冲接口暂未返回行业排行，刷新后会自动补齐。" />
      ) : null}
      <div className="mt-3 space-y-1">
        {sectors.map((sector) => (
          <div key={sector.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-[#F1F2F5] py-2 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-[#121826]">{sector.name}</div>
              <div className="truncate text-[11px] text-[#8B92A1]">{sector.leader} · {sector.flow}</div>
            </div>
            <ChangeText value={sector.changePct} compact />
            {sector.spark.length >= 2 ? (
              <Sparkline values={sector.spark} positive={sector.changePct >= 0} className="h-6 w-14" />
            ) : (
              <span className="w-14 text-right text-[10px] text-[#A0A7B3]">无走势</span>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StarStocks({
  stocks,
  className,
  onInspect,
}: {
  stocks: StockSnapshot[];
  className?: string;
  onInspect: () => void;
}): JSX.Element {
  const ranked = stocks.filter(Boolean).slice(0, 6);
  return (
    <Panel className={className}>
      <SectionHeader title="明星股票" meta="今日关注" action="查看详情" onAction={onInspect} />
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
                <th className="px-1 py-2 text-right font-medium">最新价</th>
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
                  <td className="py-2 pl-1 text-right text-[11px] text-[#4F5868]">{stock.signal}</td>
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
  const notes = temperature.notes;
  return (
    <Panel>
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
      <div className="mt-4 space-y-2 border-t border-[#F1F2F5] pt-3 text-[12px] leading-relaxed text-[#4F5868]">
        {notes.slice(0, 2).map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
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
          className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#4F5868] transition-colors hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-60"
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
}: {
  title: string;
  items: string[];
  tags: string[];
  tone: 'green' | 'red' | 'blue';
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
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2 text-[12px] leading-relaxed text-[#344054]">
            <span className={cn('mt-2 h-1.5 w-1.5 shrink-0 rounded-full', bulletClass)} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1">
        {tags.map((tag, index) => (
          <span key={`${tag}-${index}`} className="rounded-[5px] border border-[#E1E3E8] bg-white px-1.5 py-0.5 text-[10px] text-[#667085]">
            {tag}
          </span>
        ))}
      </div>
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
  value: number;
  className?: string;
}): JSX.Element {
  if (!Number.isFinite(value) || value === 0) {
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
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'red' | 'green';
}): JSX.Element {
  const valueClass = tone === 'red' ? MARKET_UP_CLASS : tone === 'green' ? MARKET_DOWN_CLASS : 'text-[#121826]';
  return (
    <div className="min-w-0 lg:mb-4">
      <div className="text-[12px] font-medium leading-none text-[#777F8D]">{label}</div>
      <div className={cn('mt-2 truncate text-[12px] font-semibold leading-none tabular-nums', valueClass)}>{value}</div>
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
  latestChangePct,
  className,
  hoverIndex,
  onHoverIndexChange,
  showTimeline = false,
}: {
  values: number[];
  latestChangePct: number;
  className?: string;
  hoverIndex?: number | null;
  onHoverIndexChange?: (index: number | null) => void;
  showTimeline?: boolean;
}): JSX.Element {
  const gradientId = React.useId();
  const chart = chartGeometry(values);
  const points = chart.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const linePath = smoothPathFromPoints(chart.points);
  const areaPath = linePath ? `${linePath} L ${chart.right} 38 L ${chart.left} 38 Z` : '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = min + (max - min) / 2;
  const activeIndex = hoverIndex ?? values.length - 1;
  const activePoint = chart.points[activeIndex] ?? chart.points[chart.points.length - 1];
  const activeValue = values[activeIndex] ?? values[values.length - 1] ?? max;
  const activeChangePct =
    activeIndex === values.length - 1
      ? latestChangePct
      : pointChangePct(values, activeIndex);
  const positive = activeChangePct >= 0;
  const strokeFallback = latestChangePct >= 0 ? MARKET_UP_STROKE : MARKET_DOWN_STROKE;
  const baseline = values[0] ?? activeValue;
  const baselineY = chart.yForValue(baseline);
  const baselinePct = Math.max(0, Math.min(100, (baselineY / 48) * 100));
  const showHover = hoverIndex !== null && activePoint;
  const tooltipTime = stockPointTimeLabel(values.length, activeIndex);
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!onHoverIndexChange) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 100;
    const ratio = (svgX - chart.left) / Math.max(1, chart.right - chart.left);
    const index = Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1))));
    onHoverIndexChange(index);
  };
  const handlePointerLeave = (): void => onHoverIndexChange?.(null);
  return (
    <div className={cn('relative select-none', className)}>
      <svg
        className="h-full w-full touch-none overflow-visible"
        viewBox="0 0 100 48"
        role="img"
        aria-label="真实走势"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
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
            {STOCK_CHART_TIME_TICKS.map((tick) => (
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
            <line x1={activePoint.x} x2={activePoint.x} y1="4" y2="38" stroke="#9FA6B3" strokeWidth="0.48" />
            <circle cx={activePoint.x} cy={activePoint.y} r="0.95" fill={positive ? MARKET_UP_STROKE : MARKET_DOWN_STROKE} stroke="white" strokeWidth="0.5" />
          </>
        ) : null}
        {[
          { value: max, y: chart.yForValue(max) + 1.3 },
          { value: mid, y: chart.yForValue(mid) + 1.3 },
          { value: min, y: chart.yForValue(min) + 1.3 },
        ].map((label) => (
          <text
            key={label.value}
            x="2.8"
            y={Math.max(7.2, Math.min(39, label.y))}
            fill="#9CA4B2"
            fontSize="2.45"
            fontFamily="ui-sans-serif, system-ui"
            className="tabular-nums"
          >
            {label.value.toFixed(2)}
          </text>
        ))}
        {!showHover ? (
          <>
            <rect x="69" y={Math.max(5, Math.min(31, baselineY - 3.7))} width="27.5" height="7.4" rx="3.2" fill="white" stroke="#E1E4EA" />
            <text x="71" y={Math.max(10, Math.min(36, baselineY + 1.1))} fill="#767E8D" fontSize="2.35" fontFamily="ui-sans-serif, system-ui">
              前次收盘: {baseline.toFixed(2)}
            </text>
          </>
        ) : null}
        {showTimeline ? (
          <>
            {STOCK_CHART_TIME_TICKS.map((tick, index) => (
              <text
                key={tick.label}
                x={tick.x}
                y="45"
                textAnchor={index === STOCK_CHART_TIME_TICKS.length - 1 ? 'end' : 'middle'}
                fill="#A5ADBA"
                fontSize="2.45"
                fontFamily="ui-sans-serif, system-ui"
              >
                {tick.label}
              </text>
            ))}
          </>
        ) : null}
      </svg>
      {showHover ? (
        <div
          className="pointer-events-none absolute z-10 rounded-[7px] border border-[#DADDE5] bg-white px-2.5 py-1.5 text-left shadow-[0_8px_18px_rgba(18,24,38,0.11)]"
          style={{
            left: `${activePoint.x}%`,
            top: `${Math.max(9, Math.min(70, (activePoint.y / 48) * 100 - 12))}%`,
            transform: activePoint.x > 76 ? 'translate(-100%, -50%)' : 'translate(10px, -50%)',
          }}
        >
          <div className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-[#344054]">{activeValue.toFixed(2)}</div>
          <div className="mt-0.5 whitespace-nowrap text-[11px] font-medium tabular-nums text-[#8B92A1]">
            今日 {tooltipTime}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NewsSourceDots({ count }: { count: number }): JSX.Element {
  const palette = ['bg-[#EA1F59]', 'bg-[#111827]', 'bg-[#F59E0B]'];
  return (
    <span className="flex -space-x-1" aria-hidden>
      {Array.from({ length: Math.min(3, Math.max(1, count)) }).map((_, index) => (
        <span key={index} className={cn('h-4 w-4 rounded-full border-2 border-white', palette[index % palette.length])} />
      ))}
    </span>
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

function chartGeometry(values: number[]): {
  points: Array<{ x: number; y: number }>;
  yForValue: (value: number) => number;
  left: number;
  right: number;
} {
  const left = 8;
  const right = 98;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const yForValue = (value: number): number => 38 - ((value - min) / range) * 30;
  return {
    points: values.map((value, index) => ({
      x: (index / Math.max(1, values.length - 1)) * (right - left) + left,
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

function pointChangePct(values: number[], index: number): number {
  const current = values[index];
  if (typeof current !== 'number') return 0;
  const baseline = values[0];
  if (!baseline) return 0;
  return ((current - baseline) / baseline) * 100;
}

function stockPointTimeLabel(total: number, index: number): string {
  const clamped = Math.max(0, Math.min(Math.max(0, total - 1), index));
  const ratio = total <= 1 ? 0 : clamped / (total - 1);
  const startMinutes = 5 * 60;
  const endMinutes = 17 * 60;
  const minutes = Math.round((startMinutes + (endMinutes - startMinutes) * ratio) / 5) * 5;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function stockDisplayPoint(stock: StockSnapshot, hoverIndex: number | null): { price: string; changePct: number } {
  if (hoverIndex === null || stock.spark.length === 0) {
    return { price: stock.price, changePct: stock.changePct };
  }
  const clamped = Math.max(0, Math.min(stock.spark.length - 1, hoverIndex));
  const value = stock.spark[clamped];
  if (typeof value !== 'number') return { price: stock.price, changePct: stock.changePct };
  return {
    price: value.toFixed(2),
    changePct: clamped === stock.spark.length - 1 ? stock.changePct : pointChangePct(stock.spark, clamped),
  };
}

function stockRangeText(stock: StockSnapshot): string {
  if (stock.spark.length < 2) return '待补齐';
  const min = Math.min(...stock.spark);
  const max = Math.max(...stock.spark);
  return `${min.toFixed(2)} - ${max.toFixed(2)}`;
}

function stockPositionText(stock: StockSnapshot): string {
  if (stock.spark.length < 2) return '等待走势';
  const min = Math.min(...stock.spark);
  const max = Math.max(...stock.spark);
  const latest = stock.spark[stock.spark.length - 1] ?? min;
  const range = max - min;
  if (range <= 0) return '区间持平';
  const pct = ((latest - min) / range) * 100;
  if (pct >= 78) return '接近高位';
  if (pct <= 22) return '接近低位';
  return '区间中部';
}

function stockFollowupText(stock: StockSnapshot): string {
  if (stock.price === '—') return '等行情源';
  if (stock.signal === '强势' || stock.signal === '偏强') return '看公告/量能';
  if (stock.signal === '偏弱' || stock.signal === '风险升高') return '看支撑/公告';
  return '看行业联动';
}

function stockNarrative(stock: StockSnapshot): string {
  if (stock.price === '—') {
    return `${stock.name} 已在关注列表中，但当前行情源尚未返回真实价格。Holaday 不会用模拟走势填充，建议稍后刷新或先查看公告来源。`;
  }
  const direction = stock.changePct >= 0 ? '上涨' : '下跌';
  const range = stockRangeText(stock);
  const position = stockPositionText(stock);
  const followup = stockFollowupText(stock);
  return `${stock.name} 最新价 ${stock.price}，今日${direction} ${Math.abs(stock.changePct).toFixed(2)}%。近 8 个交易日区间为 ${range}，当前${position}；下一步优先${followup}，再决定是否生成专属日报继续追问。`;
}

function dashboardHasDisplayableData(snapshot: DashboardSnapshot | null): boolean {
  if (!snapshot) return false;
  return Boolean(
    snapshot.watchlistStocks.some((stockRow) => stockRow.price !== '—' || stockRow.spark.length >= 2) ||
      snapshot.marketIndices.length > 0 ||
      snapshot.sectors.length > 0 ||
      snapshot.news.length > 0 ||
      snapshot.leaders.length > 0 ||
      snapshot.temperature,
  );
}

function buildStockRows(watchlist: WatchlistRow[] | null): StockSnapshot[] {
  if (!watchlist || watchlist.length === 0) {
    return [];
  }
  return watchlist.map((row, index) => {
    const normalized = normalizeSymbol(row.symbol);
    const known = STOCK_SNAPSHOTS[normalized] ?? STOCK_SNAPSHOTS[row.symbol];
    if (known) {
      return {
        ...known,
        name: row.displayName ?? known.name,
        market: row.market as Market,
        price: '—',
        changePct: 0,
        signal: '待观察',
        spark: [],
        note: row.note ?? '真实行情暂不可用',
      };
    }
    return fallbackSnapshot(row, index);
  });
}

function fallbackSnapshot(row: WatchlistRow, _index: number): StockSnapshot {
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
    note: row.note ?? '真实行情暂不可用',
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

function dailyBriefingHeadline(stocks: StockSnapshot[], riskStock?: StockSnapshot): string {
  if (stocks.length === 0) return '添加关注股票后，Holaday 会生成你的每日关注日报。';
  const quoteStocks = stocks.filter((stock) => stock.price !== '—');
  if (quoteStocks.length === 0) return '真实行情暂不可用，Holaday 不会使用模拟数据生成盘面判断。';
  const weakCount = quoteStocks.filter((stock) => stock.changePct < 0).length;
  const strong = [...quoteStocks].sort((a, b) => b.changePct - a.changePct)[0];
  if (weakCount >= Math.ceil(quoteStocks.length / 2)) {
    return `关注列表整体偏弱，${riskStock?.symbol ?? strong?.symbol ?? '重点标的'} 需要优先跟踪。`;
  }
  return `${strong?.symbol ?? '关注列表'} 相对活跃，继续跟踪公告、资金和行业主线。`;
}

function marketInsight(rows: IndexRow[]): InsightSheetState {
  return {
    title: '市场行情',
    description: '主要指数的最新点位、涨跌幅和成交额，用于判断今天的整体风险偏好。',
    rows: rows.map((row) => ({
      label: row.name,
      value: row.price,
      meta: `成交 ${row.turnover}`,
      changePct: row.changePct,
    })),
  };
}

function sectorInsight(sectors: SectorRow[]): InsightSheetState {
  return {
    title: '行业趋势',
    description: '按市场脉冲整理的行业强弱和领涨线索，优先用于发现当日主线。',
    rows: sectors.map((sector) => ({
      label: sector.name,
      value: sector.leader,
      meta: sector.flow,
      changePct: sector.changePct,
    })),
  };
}

function starStockInsight(stocks: StockSnapshot[]): InsightSheetState {
  return {
    title: '明星股票',
    description: '仅展示已拿到真实价格的关注股票，用于快速扫描当日异动。',
    rows: stocks.map((stock) => ({
      label: `${stock.name} ${stock.symbol}`,
      value: stock.price,
      meta: `${marketLabel(stock.market)} · ${stock.signal} · ${stock.note}`,
      changePct: stock.changePct,
    })),
  };
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

function newsInsight(news: NewsRow[]): InsightSheetState {
  return {
    title: '重点动态',
    description: '优先展示自选股公告、市场脉冲和关注股票异动。带外链的公告来自巨潮。',
    rows: news.map((item) => ({
      label: `${item.time} ${item.category ?? '动态'}`,
      value: item.title,
      meta: [item.source, item.symbols.join(' / ')].filter(Boolean).join(' · '),
    })),
  };
}

function leaderboardInsight(active: string, leaders: LeaderRow[]): InsightSheetState {
  return {
    title: active,
    description: '当前榜单来自 AkShare 全市场个股排行，接口无数据时不展示模拟榜单。',
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

function stockTags(stocks: StockSnapshot[], fallback: string[]): string[] {
  const tags = stocks.map((stock) => stock.symbol).filter(Boolean);
  const uniqueTags = Array.from(new Set(tags)).slice(0, 3);
  return uniqueTags.length > 0 ? uniqueTags : fallback;
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

function formatDelta(value: number | null | undefined): string {
  if (value == null) return '—';
  return value > 0 ? `+${value}` : String(value);
}

function dashboardStatusLabel({
  loading,
  dashboard,
}: {
  loading: boolean;
  dashboard: DashboardSnapshot | null;
}): string {
  if (loading && !dashboard) return '同步中';
  if (!dashboard) return '待连接';
  if (dashboard.freshness?.status === 'stale') return '缓存';
  if (dashboard.freshness?.status === 'partial') return '部分数据';
  return loading ? '刷新中' : 'AkShare';
}

function deltaPositive(value: number | null | undefined): boolean | undefined {
  if (value == null || value === 0) return undefined;
  return value > 0;
}

function toStockIntent(prompt: string, stocks: StockSnapshot[]): string {
  const symbols = stocks.slice(0, 8).map((stock) => stock.symbol).join('、');
  return `【股市任务】${prompt}\n\n请优先结合我的关注列表（${symbols || '暂无'}）进行分析；需要行情或新闻时请走现有股票分析/搜索链路，引用来源并保留“不构成投资建议”的口径。`;
}

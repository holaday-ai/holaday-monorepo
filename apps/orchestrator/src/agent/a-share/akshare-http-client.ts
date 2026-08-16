/**
 * Phase 1 指令 #2 ③ §6c — HttpAkshareClient：AkshareClient 的真实传输（薄 HTTP）.
 *
 * 同机直取 akshare-mcp 的 FastAPI（http_server.py），确定性简报不走 LLM
 * （orchestrator 无 @modelcontextprotocol/sdk，BOSS 定薄 HTTP）。任何 HTTP /
 * 网络 / 超时错误优雅降级为 error envelope —— 渲染器据此显示「数据暂不可用」，
 * 定时任务不崩。fetch 可注入便于单测。
 */

import type {
  AkshareClient,
  SymbolRow,
  TradingCalendarRow,
  TradingDayRow,
} from './akshare-client.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  DragonTigerRow,
  ForecastRow,
  FundamentalsRow,
  GoodwillRow,
  IndexRow,
  InsiderChangeRow,
  IntradayRow,
  KlineRow,
  MarketPulseRow,
  NorthboundRow,
  PledgeRow,
  StockNewsRow,
  StockQuoteRow,
  StockRankingRow,
  UnlockRow,
  ValuationRow,
  ZtReviewRow,
} from './briefing-types.js';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

/** 最小 logger 形状（pino 兼容）。只记录结构化状态，不记录原始上游错误。 */
interface MinimalLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const DISCLAIMER = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

function errEnvelope<T>(source: string, error: string, errorCode: string): AkEnvelope<T> {
  return {
    data: [],
    count: 0,
    source,
    fetched_at: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    error,
    error_code: errorCode,
  };
}

type CircuitGroup = 'quote' | 'intraday' | 'kline' | 'news' | 'calendar' | 'risk' | 'market';
const sharedCircuits = new Map<string, CircuitBreaker>();

/** Test isolation helper; production callers must never reset live circuits. */
export function resetAkshareCircuitBreakersForTests(): void {
  sharedCircuits.clear();
}

function circuitFor(baseUrl: string, group: CircuitGroup): CircuitBreaker {
  const key = `${baseUrl}\u0000${group}`;
  const existing = sharedCircuits.get(key);
  if (existing) return existing;
  const circuit = new CircuitBreaker();
  sharedCircuits.set(key, circuit);
  return circuit;
}

class AkshareUpstreamError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AkshareUpstreamError';
  }
}

function circuitGroupForPath(path: string): CircuitGroup {
  if (path.startsWith('/quote/')) return 'quote';
  if (path.startsWith('/intraday/')) return 'intraday';
  if (path.startsWith('/kline/')) return 'kline';
  if (
    path.startsWith('/stock-news/') ||
    path.startsWith('/market-news/') ||
    path.startsWith('/announcements/')
  ) {
    return 'news';
  }
  if (path.startsWith('/trading-day/') || path.startsWith('/trading-calendar/')) {
    return 'calendar';
  }
  if (path.startsWith('/risk-')) return 'risk';
  return 'market';
}

function isAkEnvelope<T>(value: unknown): value is AkEnvelope<T> {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<AkEnvelope<T>>;
  return (
    Array.isArray(envelope.data) &&
    typeof envelope.count === 'number' &&
    typeof envelope.source === 'string' &&
    typeof envelope.fetched_at === 'string' &&
    typeof envelope.disclaimer === 'string'
  );
}

export interface HttpAkshareClientOptions {
  /** akshare-mcp FastAPI 基址，如 http://127.0.0.1:8848。 */
  baseUrl: string;
  /** 注入便于测试；默认 globalThis.fetch。 */
  fetchImpl?: FetchLike;
  /** 单次请求超时，默认 10000ms（BOSS 要求；超时/挂服→error envelope→对应段降级）。 */
  timeoutMs?: number;
  /**
   * ④ 风险源单独超时，默认 25000ms。风险按 date 取全市场表，冷缓存单张 >1min（预热为主，
   * 见 akshare-mcp /risk-warm + 启动钩子）；此放宽是预热没命中的边缘日期/个股的冷取兜底，
   * 宁可慢几秒真查出来、不假装「未检测到」。**仅作用于 4 个风险端点，不影响其他查询。**
   */
  riskTimeoutMs?: number;
  /** 注入后只写路径、路由组、错误码等结构化状态，**不写原始上游错误**。 */
  logger?: MinimalLogger;
}

export class HttpAkshareClient implements AkshareClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly riskTimeoutMs: number;
  private readonly logger?: MinimalLogger;

  constructor(opts: HttpAkshareClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.riskTimeoutMs = opts.riskTimeoutMs ?? 25_000;
    this.logger = opts.logger;
  }

  private async get<T>(path: string, timeoutMs: number = this.timeoutMs): Promise<AkEnvelope<T>> {
    const group = circuitGroupForPath(path);
    const breaker = circuitFor(this.baseUrl, group);
    try {
      return await breaker.execute(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          let res: FetchResponseLike;
          try {
            res = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: controller.signal });
          } catch (error) {
            if (controller.signal.aborted) {
              throw new AkshareUpstreamError('UPSTREAM_TIMEOUT', 'AkShare request timed out');
            }
            throw error;
          }
          if (!res.ok) {
            throw new AkshareUpstreamError('UPSTREAM_HTTP', `HTTP ${res.status}`, {
              status: res.status,
            });
          }
          const value = await res.json();
          if (!isAkEnvelope<T>(value)) {
            throw new AkshareUpstreamError('UPSTREAM_INVALID', 'invalid AkShare envelope');
          }
          if (value.error) {
            throw new AkshareUpstreamError(value.error_code ?? 'UPSTREAM_ERROR', value.error);
          }
          return value;
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (e) {
      if (e instanceof CircuitOpenError) {
        this.logger?.warn({ path, group, errorCode: e.code }, 'akshare-http: circuit open');
        return errEnvelope<T>(`http:${path}`, 'AkShare 服务暂时繁忙，请稍后重试。', e.code);
      }
      const errorCode = e instanceof AkshareUpstreamError ? e.errorCode : 'UPSTREAM_UNAVAILABLE';
      const context = e instanceof AkshareUpstreamError ? e.context : {};
      this.logger?.warn({ path, group, errorCode, ...context }, 'akshare-http: 取数失败/超时');
      const safeMessage =
        errorCode === 'UPSTREAM_TIMEOUT'
          ? 'AkShare 数据源响应超时，请稍后重试。'
          : 'AkShare 数据源暂不可用，请稍后重试。';
      return errEnvelope<T>(`http:${path}`, safeMessage, errorCode);
    }
  }

  getIndexQuote(market: 'hk' | 'us' | 'cn') {
    return this.get<IndexRow>(`/index/${market}`);
  }
  getStockAnnouncements(symbol: string, startDate?: string, endDate?: string) {
    const qs = new URLSearchParams();
    if (startDate) qs.set('start_date', startDate);
    if (endDate) qs.set('end_date', endDate);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.get<AnnouncementRow>(`/announcements/${encodeURIComponent(symbol)}${suffix}`);
  }
  getStockNews(symbol: string) {
    return this.get<StockNewsRow>(`/stock-news/${encodeURIComponent(symbol)}`);
  }
  getMarketNews(market: 'cn' | 'us' | 'hk', page = 1, pageSize = 20) {
    const qs = new URLSearchParams();
    qs.set('page', String(Math.max(1, page)));
    qs.set('page_size', String(Math.max(1, pageSize)));
    return this.get<StockNewsRow>(`/market-news/${encodeURIComponent(market)}?${qs.toString()}`);
  }
  getShareUnlock(symbol: string) {
    return this.get<UnlockRow>(`/unlock/${encodeURIComponent(symbol)}`);
  }
  getStockKline(symbol: string, days?: number) {
    const qs = days && days > 0 ? `?days=${days}` : '';
    return this.get<KlineRow>(`/kline/${encodeURIComponent(symbol)}${qs}`);
  }
  getStockQuote(symbol: string) {
    return this.get<StockQuoteRow>(`/quote/${encodeURIComponent(symbol)}`);
  }
  getStockIntraday(symbol: string) {
    return this.get<IntradayRow>(`/intraday/${encodeURIComponent(symbol)}`);
  }
  getDragonTiger(startDate: string) {
    return this.get<DragonTigerRow>(`/dragon-tiger/${encodeURIComponent(startDate)}`);
  }
  getNorthboundFlow() {
    return this.get<NorthboundRow>('/northbound');
  }
  getTradingDay(date: string) {
    return this.get<TradingDayRow>(`/trading-day/${encodeURIComponent(date)}`);
  }
  getLatestTradingDay(onOrBefore: string) {
    const qs = new URLSearchParams();
    qs.set('on_or_before', onOrBefore);
    return this.get<TradingCalendarRow>(`/trading-calendar/latest?${qs.toString()}`);
  }
  searchSymbol(query: string) {
    return this.get<SymbolRow>(`/symbol-search/${encodeURIComponent(query)}`);
  }
  getStockRankings(metric: 'gainers' | 'losers' | 'amount', limit = 20) {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    return this.get<StockRankingRow>(
      `/stock-rankings/${encodeURIComponent(metric)}?${qs.toString()}`,
    );
  }
  getMarketPulse(date: string, prevDate?: string) {
    const qs = prevDate ? `?prev_date=${encodeURIComponent(prevDate)}` : '';
    return this.get<MarketPulseRow>(`/market-pulse/${encodeURIComponent(date)}${qs}`);
  }
  getZtPoolSummary(date: string) {
    return this.get<ZtReviewRow>(`/zt-pool-summary/${encodeURIComponent(date)}`);
  }
  getFundamentals(symbol: string) {
    return this.get<FundamentalsRow>(`/fundamentals/${encodeURIComponent(symbol)}`);
  }
  getValuation(symbol: string) {
    return this.get<ValuationRow>(`/valuation/${encodeURIComponent(symbol)}`);
  }
  getRiskPledge(date: string, symbol: string) {
    return this.get<PledgeRow>(
      `/risk-pledge/${encodeURIComponent(date)}?symbol=${encodeURIComponent(symbol)}`,
      this.riskTimeoutMs,
    );
  }
  getRiskGoodwill(date: string, symbol: string) {
    return this.get<GoodwillRow>(
      `/risk-goodwill/${encodeURIComponent(date)}?symbol=${encodeURIComponent(symbol)}`,
      this.riskTimeoutMs,
    );
  }
  getRiskForecast(date: string, symbol: string) {
    return this.get<ForecastRow>(
      `/risk-forecast/${encodeURIComponent(date)}?symbol=${encodeURIComponent(symbol)}`,
      this.riskTimeoutMs,
    );
  }
  getRiskInsider(symbol: string) {
    return this.get<InsiderChangeRow>(
      `/risk-insider/${encodeURIComponent(symbol)}`,
      this.riskTimeoutMs,
    );
  }
}

/**
 * Phase 1 指令 #2 ③ §6c — HttpAkshareClient：AkshareClient 的真实传输（薄 HTTP）.
 *
 * 同机直取 akshare-mcp 的 FastAPI（http_server.py），确定性简报不走 LLM
 * （orchestrator 无 @modelcontextprotocol/sdk，BOSS 定薄 HTTP）。任何 HTTP /
 * 网络 / 超时错误优雅降级为 error envelope —— 渲染器据此显示「数据暂不可用」，
 * 定时任务不崩。fetch 可注入便于单测。
 */

import type { AkshareClient, SymbolRow, TradingDayRow } from './akshare-client.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  DragonTigerRow,
  ForecastRow,
  FundamentalsRow,
  GoodwillRow,
  IndexRow,
  IntradayRow,
  InsiderChangeRow,
  KlineRow,
  MarketPulseRow,
  NorthboundRow,
  PledgeRow,
  StockQuoteRow,
  StockRankingRow,
  UnlockRow,
  ValuationRow,
  ZtReviewRow,
} from './briefing-types.js';

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

/** 最小 logger 形状（pino 兼容）。注入后原始异常进日志、不泄漏给用户。 */
interface MinimalLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const DISCLAIMER = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

function errEnvelope<T>(source: string, error: string): AkEnvelope<T> {
  return {
    data: [],
    count: 0,
    source,
    fetched_at: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    error,
  };
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
  /** 注入后：原始异常 / 后端 error envelope 进 logger.warn，**不泄漏给用户文案**。 */
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: controller.signal });
      if (!res.ok) {
        // 用户文案只见「数据暂不可用」（渲染器据 error 字段降级，不展原文）；
        // 真实 HTTP 状态进日志。
        this.logger?.warn({ path, status: res.status }, 'akshare-http: 非 2xx');
        return errEnvelope<T>(`http:${path}`, `HTTP ${res.status}`);
      }
      const env = (await res.json()) as AkEnvelope<T>;
      // 后端把 akshare 异常包成 envelope.error（如龙虎榜 NoneType）。原始串进
      // 日志，不带给用户——渲染器据 error 存在与否降级为「数据暂不可用」。
      if (env.error)
        this.logger?.warn({ path, error: env.error }, 'akshare-http: 后端 error envelope');
      return env;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.logger?.warn({ path, error: detail }, 'akshare-http: 取数失败/超时');
      return errEnvelope<T>(`http:${path}`, detail);
    } finally {
      clearTimeout(timer);
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
  searchSymbol(query: string) {
    return this.get<SymbolRow>(`/symbol-search/${encodeURIComponent(query)}`);
  }
  getStockRankings(metric: 'gainers' | 'losers' | 'amount', limit = 20) {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    return this.get<StockRankingRow>(`/stock-rankings/${encodeURIComponent(metric)}?${qs.toString()}`);
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

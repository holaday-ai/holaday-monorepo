/**
 * Phase 1 指令 #2 ③ §6 — AkshareClient：取数传输层「契约」.
 *
 * briefing-service 只依赖这个接口（transport-agnostic），不关心底层是
 * MCP-stdio 子进程还是薄 HTTP 包装。这样：
 *   - 组装/渲染逻辑可用 fake client 完整单测（无需 Vultr / 实时行情）。
 *   - 真实传输实现是 Vultr 落地决策（见 docs/PHASE1_ASHARE_HANDOFF.md §6）：
 *     orchestrator 当前**无** @modelcontextprotocol/sdk，且确定性简报不应让
 *     LLM 代调工具 —— 候选：(a) 引入 MCP SDK + 子进程 stdio；(b) akshare-mcp
 *     之上加薄 FastAPI，orchestrator HTTP 直取。两者均须 Vultr 实跑核对
 *     （push2.eastmoney 仅 Vultr 可达）。
 *
 * 方法名 / 参数与 `apps/akshare-mcp/akshare_mcp/server.py` 的 6+1 工具一一对应。
 */

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

/** 交易日历单行（is_trading_day）。 */
export interface TradingDayRow {
  date?: string;
  is_trading_day?: boolean;
  [k: string]: unknown;
}

/** 代码名称搜索单行（④ 短名解析）。 */
export interface SymbolRow {
  code?: string;
  name?: string;
  [k: string]: unknown;
}

export interface AkshareClient {
  /** get_index_quote(market) — 'hk' 恒指 / 'us' 标普道指纳指 / 'cn' 上证深证创业板。 */
  getIndexQuote(market: 'hk' | 'us' | 'cn'): Promise<AkEnvelope<IndexRow>>;
  /**
   * get_stock_announcements(symbol, startDate?, endDate?) — 个股公告（巨潮）。
   * 日期 'YYYYMMDD'；不传时 cninfo 返历史默认页（多为旧公告）。简报按窗口取
   * （盘前近 24h / 盘后当日）→ service 传范围，渲染器据此显示「无新公告」。
   */
  getStockAnnouncements(
    symbol: string,
    startDate?: string,
    endDate?: string,
  ): Promise<AkEnvelope<AnnouncementRow>>;
  /** get_share_unlock(symbol) — 个股限售解禁（G2）。 */
  getShareUnlock(symbol: string): Promise<AkEnvelope<UnlockRow>>;
  /**
   * get_stock_kline(symbol, days?) — 历史 K 线。默认（无 days）末行=当日表现（①盘面）；
   * **days>0** → 近 days 交易日 raw 序列（P3 F走势 本地算，同源不新增数据）。
  */
  getStockKline(symbol: string, days?: number): Promise<AkEnvelope<KlineRow>>;
  /** get_stock_quote(symbol) — 实时行情快照；用于当前价/涨跌幅。 */
  getStockQuote(symbol: string): Promise<AkEnvelope<StockQuoteRow>>;
  /** get_stock_intraday(symbol) — 真实分钟线；只返回实际分钟点，不补齐、不外推。 */
  getStockIntraday(symbol: string): Promise<AkEnvelope<IntradayRow>>;
  /** get_dragon_tiger(startDate) — 龙虎榜明细（startDate 'YYYYMMDD'）。 */
  getDragonTiger(startDate: string): Promise<AkEnvelope<DragonTigerRow>>;
  /** get_northbound_flow() — 北向资金汇总。 */
  getNorthboundFlow(): Promise<AkEnvelope<NorthboundRow>>;
  /** is_trading_day(date) — date('YYYY-MM-DD') 是否 A股交易日（P1 非交易日不投递）。 */
  getTradingDay(date: string): Promise<AkEnvelope<TradingDayRow>>;
  /** search_symbol(query) — 问句→个股（④ 短名解析；表 day-cache，冷启返空）。 */
  searchSymbol(query: string): Promise<AkEnvelope<SymbolRow>>;
  /** get_stock_rankings(metric, limit) — A股全市场涨幅/跌幅/成交额榜。 */
  getStockRankings(
    metric: 'gainers' | 'losers' | 'amount',
    limit?: number,
  ): Promise<AkEnvelope<StockRankingRow>>;
  /** get_market_pulse(date, prevDate?) — v2 盘后温度计+板块主线+大盘净流入（prevDate→涨停昨对比）。 */
  getMarketPulse(date: string, prevDate?: string): Promise<AkEnvelope<MarketPulseRow>>;
  /** get_zt_pool_summary(date) — v2 盘前回顾某交易日涨停梯队（date 'YYYYMMDD'）。 */
  getZtPoolSummary(date: string): Promise<AkEnvelope<ZtReviewRow>>;
  /** get_fundamentals(symbol) — Phase2 ④ 基本面（最新报告期 + 近3年趋势）。 */
  getFundamentals(symbol: string): Promise<AkEnvelope<FundamentalsRow>>;
  /** get_valuation(symbol) — Phase2 ⑤ 估值（PE/PB + 历史分位 + 行业PE中位）。 */
  getValuation(symbol: string): Promise<AkEnvelope<ValuationRow>>;
  /** ④ R1 股权质押（date 'YYYYMMDD' 内部取最近周五；按 symbol 过滤个股）。 */
  getRiskPledge(date: string, symbol: string): Promise<AkEnvelope<PledgeRow>>;
  /** ④ R2 商誉（date 'YYYYMMDD' 内部取最近报告期；按 symbol 过滤）。 */
  getRiskGoodwill(date: string, symbol: string): Promise<AkEnvelope<GoodwillRow>>;
  /** ④ R3 业绩预告（date 'YYYYMMDD' 内部取最近报告期；按 symbol 过滤）。 */
  getRiskForecast(date: string, symbol: string): Promise<AkEnvelope<ForecastRow>>;
  /** ④ R4 董监高持股变动（按 symbol；变动数<0=减持；沪 sse / 深 szse）。 */
  getRiskInsider(symbol: string): Promise<AkEnvelope<InsiderChangeRow>>;
}

const STUB_DISCLAIMER = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

/**
 * 传输未接入时的占位实现：每个工具返回 error envelope。简报渲染器对
 * error envelope 优雅降级（显示「数据暂不可用」），所以即便 MCP/HTTP
 * 还没接好，定时任务也不会崩，只会产出空壳简报 —— 用于 §6 接好前的
 * 端到端走查 + 单测基线。
 */
export class StubAkshareClient implements AkshareClient {
  private err<T>(tool: string, nowIso: string): AkEnvelope<T> {
    return {
      data: [],
      count: 0,
      source: tool,
      fetched_at: nowIso,
      disclaimer: STUB_DISCLAIMER,
      error: 'akshare-mcp 传输未接入（stub）',
    };
  }

  // new Date() 在普通 orchestrator 代码可用（非 Workflow 脚本）。
  private now(): string {
    return new Date().toISOString();
  }

  getIndexQuote(market: 'hk' | 'us' | 'cn') {
    return Promise.resolve(this.err<IndexRow>(`akshare:index(${market})`, this.now()));
  }
  getStockAnnouncements(symbol: string, _startDate?: string, _endDate?: string) {
    return Promise.resolve(
      this.err<AnnouncementRow>(`akshare:announcements(${symbol})`, this.now()),
    );
  }
  getShareUnlock(symbol: string) {
    return Promise.resolve(this.err<UnlockRow>(`akshare:share_unlock(${symbol})`, this.now()));
  }
  getStockKline(symbol: string, _days?: number) {
    return Promise.resolve(this.err<KlineRow>(`akshare:kline(${symbol})`, this.now()));
  }
  getStockQuote(symbol: string) {
    return Promise.resolve(this.err<StockQuoteRow>(`akshare:quote(${symbol})`, this.now()));
  }
  getStockIntraday(symbol: string) {
    return Promise.resolve(this.err<IntradayRow>(`akshare:intraday(${symbol})`, this.now()));
  }
  getDragonTiger(startDate: string) {
    return Promise.resolve(
      this.err<DragonTigerRow>(`akshare:dragon_tiger(${startDate})`, this.now()),
    );
  }
  getNorthboundFlow() {
    return Promise.resolve(this.err<NorthboundRow>('akshare:northbound', this.now()));
  }
  getTradingDay(date: string) {
    return Promise.resolve(this.err<TradingDayRow>(`akshare:trading_day(${date})`, this.now()));
  }
  searchSymbol(query: string) {
    return Promise.resolve(this.err<SymbolRow>(`akshare:symbol_search(${query})`, this.now()));
  }
  getStockRankings(metric: 'gainers' | 'losers' | 'amount', _limit?: number) {
    return Promise.resolve(this.err<StockRankingRow>(`akshare:stock_rankings(${metric})`, this.now()));
  }
  getMarketPulse(date: string, _prevDate?: string) {
    return Promise.resolve(this.err<MarketPulseRow>(`akshare:market_pulse(${date})`, this.now()));
  }
  getZtPoolSummary(date: string) {
    return Promise.resolve(this.err<ZtReviewRow>(`akshare:zt_pool_summary(${date})`, this.now()));
  }
  getFundamentals(symbol: string) {
    return Promise.resolve(
      this.err<FundamentalsRow>(`akshare:fundamentals(${symbol})`, this.now()),
    );
  }
  getValuation(symbol: string) {
    return Promise.resolve(this.err<ValuationRow>(`akshare:valuation(${symbol})`, this.now()));
  }
  getRiskPledge(date: string, symbol: string) {
    return Promise.resolve(
      this.err<PledgeRow>(`akshare:risk_pledge(${date},${symbol})`, this.now()),
    );
  }
  getRiskGoodwill(date: string, symbol: string) {
    return Promise.resolve(
      this.err<GoodwillRow>(`akshare:risk_goodwill(${date},${symbol})`, this.now()),
    );
  }
  getRiskForecast(date: string, symbol: string) {
    return Promise.resolve(
      this.err<ForecastRow>(`akshare:risk_forecast(${date},${symbol})`, this.now()),
    );
  }
  getRiskInsider(symbol: string) {
    return Promise.resolve(
      this.err<InsiderChangeRow>(`akshare:risk_insider(${symbol})`, this.now()),
    );
  }
}

import type {
  AkshareClient,
  SymbolRow,
  TradingCalendarRow,
  TradingDayRow,
} from '../agent/a-share/akshare-client.js';
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
} from '../agent/a-share/briefing-types.js';
import type { StockTaskSnapshotPayload } from './stock-task-context.js';

const DISCLAIMER = '分析仅基于任务绑定的历史快照，仅供信息参考，不构成投资建议。';
const ERROR_CODE = 'SNAPSHOT_EVIDENCE_UNAVAILABLE';

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export class SnapshotAkshareClient implements AkshareClient {
  constructor(private readonly payload: StockTaskSnapshotPayload) {}

  private envelope<T>(source: string, data: T[]): AkEnvelope<T> {
    return {
      data,
      count: data.length,
      source: `stock-snapshot:${source}`,
      fetched_at: this.payload.generatedAt,
      disclaimer: DISCLAIMER,
    };
  }

  private unavailable<T>(source: string): AkEnvelope<T> {
    return {
      ...this.envelope<T>(source, []),
      error: '当前绑定快照没有该项证据，请刷新或把股票加入自选后重试。',
      error_code: ERROR_CODE,
    };
  }

  private stock(symbol: string): (Record<string, unknown> & { symbol: string }) | undefined {
    return this.payload.watchlistStocks.find((row) => row.symbol === symbol);
  }

  getIndexQuote(market: 'hk' | 'us' | 'cn'): Promise<AkEnvelope<IndexRow>> {
    if (market !== 'cn' || this.payload.marketIndices.length === 0) {
      return Promise.resolve(this.unavailable(`index:${market}`));
    }
    const data = this.payload.marketIndices.map((row) => ({
      名称: stringValue(row.name) ?? undefined,
      最新价: numberValue(row.price) ?? undefined,
      涨跌幅: numberValue(row.changePct) ?? undefined,
      成交额: numberValue(row.turnover) ?? undefined,
      date: this.payload.dataAsOf,
    }));
    return Promise.resolve(this.envelope(`index:${market}`, data));
  }

  getStockAnnouncements(
    symbol: string,
    _startDate?: string,
    _endDate?: string,
  ): Promise<AkEnvelope<AnnouncementRow>> {
    const data = this.payload.news
      .filter(
        (row) =>
          row.category === '公告' && (!Array.isArray(row.symbols) || row.symbols.includes(symbol)),
      )
      .map((row) => ({
        代码: symbol,
        公告标题: stringValue(row.title) ?? undefined,
        公告时间: stringValue(row.publishedAt) ?? stringValue(row.time) ?? undefined,
        公告链接: stringValue(row.url) ?? undefined,
      }));
    return Promise.resolve(
      data.length > 0
        ? this.envelope(`announcements:${symbol}`, data)
        : this.unavailable(`announcements:${symbol}`),
    );
  }

  getStockNews(symbol: string): Promise<AkEnvelope<StockNewsRow>> {
    const data = this.payload.news
      .filter(
        (row) =>
          row.category !== '公告' && (!Array.isArray(row.symbols) || row.symbols.includes(symbol)),
      )
      .map((row) => ({
        关键词: symbol,
        新闻标题: stringValue(row.title) ?? undefined,
        新闻内容: stringValue(row.summary) ?? undefined,
        发布时间: stringValue(row.publishedAt) ?? stringValue(row.time) ?? undefined,
        文章来源: stringValue(row.source) ?? undefined,
        新闻链接: stringValue(row.url) ?? undefined,
      }));
    return Promise.resolve(
      data.length > 0
        ? this.envelope(`stock-news:${symbol}`, data)
        : this.unavailable(`stock-news:${symbol}`),
    );
  }

  getMarketNews(_market: 'cn' | 'us' | 'hk'): Promise<AkEnvelope<StockNewsRow>> {
    const data = this.payload.news
      .filter((row) => row.category !== '公告')
      .map((row) => ({
        新闻标题: stringValue(row.title) ?? undefined,
        新闻内容: stringValue(row.summary) ?? undefined,
        发布时间: stringValue(row.publishedAt) ?? stringValue(row.time) ?? undefined,
        文章来源: stringValue(row.source) ?? undefined,
        新闻链接: stringValue(row.url) ?? undefined,
      }));
    return Promise.resolve(
      data.length > 0 ? this.envelope('market-news', data) : this.unavailable('market-news'),
    );
  }

  getStockKline(symbol: string, _days?: number): Promise<AkEnvelope<KlineRow>> {
    const stock = this.stock(symbol);
    const close = stock ? numberValue(stock.price) : null;
    if (!stock || close === null) return Promise.resolve(this.unavailable(`kline:${symbol}`));
    return Promise.resolve(
      this.envelope(`kline:${symbol}`, [
        {
          日期: this.payload.dataAsOf,
          收盘: close,
          涨跌幅: numberValue(stock.changePct) ?? undefined,
          成交量: numberValue(stock.volume) ?? undefined,
          成交额: numberValue(stock.turnoverAmount) ?? undefined,
        },
      ]),
    );
  }

  getStockQuote(symbol: string): Promise<AkEnvelope<StockQuoteRow>> {
    const stock = this.stock(symbol);
    const price = stock ? numberValue(stock.price) : null;
    if (!stock || price === null) return Promise.resolve(this.unavailable(`quote:${symbol}`));
    return Promise.resolve(
      this.envelope(`quote:${symbol}`, [
        {
          代码: symbol,
          名称: stringValue(stock.name) ?? symbol,
          最新价: price,
          涨跌幅: numberValue(stock.changePct) ?? undefined,
          成交量: numberValue(stock.volume) ?? undefined,
          成交额: numberValue(stock.turnoverAmount) ?? undefined,
        },
      ]),
    );
  }

  getStockIntraday(symbol: string): Promise<AkEnvelope<IntradayRow>> {
    const stock = this.stock(symbol);
    if (!stock || !Array.isArray(stock.spark) || !Array.isArray(stock.sparkLabels)) {
      return Promise.resolve(this.unavailable(`intraday:${symbol}`));
    }
    const spark = stock.spark as unknown[];
    const sparkLabels = stock.sparkLabels as unknown[];
    const data = sparkLabels.flatMap((label, index) => {
      const price = numberValue(spark[index]);
      return typeof label === 'string' && price !== null ? [{ 时间: label, 最新价: price }] : [];
    });
    return Promise.resolve(
      data.length > 0
        ? this.envelope(`intraday:${symbol}`, data)
        : this.unavailable(`intraday:${symbol}`),
    );
  }

  getTradingDay(date: string): Promise<AkEnvelope<TradingDayRow>> {
    return Promise.resolve(
      this.envelope(`trading-day:${date}`, [
        {
          date,
          is_trading_day: date === this.payload.dataAsOf,
        },
      ]),
    );
  }

  getLatestTradingDay(onOrBefore: string): Promise<AkEnvelope<TradingCalendarRow>> {
    if (onOrBefore < this.payload.dataAsOf) {
      return Promise.resolve(this.unavailable(`latest-trading-day:${onOrBefore}`));
    }
    return Promise.resolve(
      this.envelope(`latest-trading-day:${onOrBefore}`, [
        {
          requested_date: onOrBefore,
          latest_trading_date: this.payload.dataAsOf,
        },
      ]),
    );
  }

  searchSymbol(query: string): Promise<AkEnvelope<SymbolRow>> {
    const normalized = query.trim().toLowerCase();
    const data = this.payload.watchlistStocks
      .filter(
        (row) =>
          row.symbol.toLowerCase().includes(normalized) ||
          stringValue(row.name)?.toLowerCase().includes(normalized),
      )
      .map((row) => ({ code: row.symbol, name: stringValue(row.name) ?? row.symbol }));
    return Promise.resolve(
      data.length > 0 ? this.envelope('symbol-search', data) : this.unavailable('symbol-search'),
    );
  }

  getMarketPulse(_date: string, _prevDate?: string): Promise<AkEnvelope<MarketPulseRow>> {
    if (this.payload.sectors.length === 0) return Promise.resolve(this.unavailable('market-pulse'));
    const sectors = this.payload.sectors.map((row) => ({
      板块: stringValue(row.name) ?? '',
      涨跌幅: numberValue(row.changePct),
      领涨股: stringValue(row.leader) ?? '',
      领涨股涨跌幅: null,
    }));
    return Promise.resolve(
      this.envelope('market-pulse', [
        {
          sectors_up: sectors.filter((row) => (row.涨跌幅 ?? 0) >= 0),
          sectors_down: sectors.filter((row) => (row.涨跌幅 ?? 0) < 0),
        },
      ]),
    );
  }

  getShareUnlock(symbol: string): Promise<AkEnvelope<UnlockRow>> {
    return Promise.resolve(this.unavailable(`share-unlock:${symbol}`));
  }
  getDragonTiger(date: string): Promise<AkEnvelope<DragonTigerRow>> {
    return Promise.resolve(this.unavailable(`dragon-tiger:${date}`));
  }
  getNorthboundFlow(): Promise<AkEnvelope<NorthboundRow>> {
    return Promise.resolve(this.unavailable('northbound'));
  }
  getStockRankings(
    metric: 'gainers' | 'losers' | 'amount',
    _limit?: number,
  ): Promise<AkEnvelope<StockRankingRow>> {
    return Promise.resolve(this.unavailable(`rankings:${metric}`));
  }
  getZtPoolSummary(date: string): Promise<AkEnvelope<ZtReviewRow>> {
    return Promise.resolve(this.unavailable(`zt-pool:${date}`));
  }
  getFundamentals(symbol: string): Promise<AkEnvelope<FundamentalsRow>> {
    return Promise.resolve(this.unavailable(`fundamentals:${symbol}`));
  }
  getValuation(symbol: string): Promise<AkEnvelope<ValuationRow>> {
    return Promise.resolve(this.unavailable(`valuation:${symbol}`));
  }
  getRiskPledge(date: string, symbol: string): Promise<AkEnvelope<PledgeRow>> {
    return Promise.resolve(this.unavailable(`risk-pledge:${date}:${symbol}`));
  }
  getRiskGoodwill(date: string, symbol: string): Promise<AkEnvelope<GoodwillRow>> {
    return Promise.resolve(this.unavailable(`risk-goodwill:${date}:${symbol}`));
  }
  getRiskForecast(date: string, symbol: string): Promise<AkEnvelope<ForecastRow>> {
    return Promise.resolve(this.unavailable(`risk-forecast:${date}:${symbol}`));
  }
  getRiskInsider(symbol: string): Promise<AkEnvelope<InsiderChangeRow>> {
    return Promise.resolve(this.unavailable(`risk-insider:${symbol}`));
  }
}

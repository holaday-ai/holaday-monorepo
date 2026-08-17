import { createHash } from 'node:crypto';
import type { AkshareClient } from '../agent/a-share/akshare-client.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  ForecastRow,
  GoodwillRow,
  InsiderChangeRow,
  PledgeRow,
} from '../agent/a-share/briefing-types.js';
import {
  type RiskKey,
  type RiskSignal,
  detectAllRisks,
} from '../agent/a-share/risk-radar-engine.js';

export type StockRiskSeverity = '关注' | '警示' | '高风险';
export type StockRiskCheckKey = 'pledge' | 'goodwill' | 'forecast' | 'insider' | 'announcements';

export interface StockRiskRadarStock {
  symbol: string;
  name: string;
  market?: string;
}

export interface StockRiskSignalRecord {
  signalId: string;
  evidenceId: string;
  symbol: string;
  name: string;
  key: RiskKey;
  label: string;
  severity: StockRiskSeverity;
  fact: string;
  trigger: string;
  whyRelevant: string;
  observedAt: string | null;
  sourceDataAsOf: string | null;
  source: string;
  fetchedAt: string;
  evidenceUrl: string | null;
}

export interface StockRiskSourceCheck {
  symbol: string;
  name: string;
  key: StockRiskCheckKey;
  status: 'checked' | 'unavailable';
  source: string;
  fetchedAt: string;
  sourceDataAsOf: string | null;
  errorCode: string | null;
}

export interface StockRiskRadarResult {
  snapshotId: string;
  dataAsOf: string;
  generatedAt: string;
  requestedStockCount: number;
  checkedStockCount: number;
  truncated: boolean;
  signals: StockRiskSignalRecord[];
  checks: StockRiskSourceCheck[];
}

export type StockRiskRadarClient = Pick<
  AkshareClient,
  | 'getRiskPledge'
  | 'getRiskGoodwill'
  | 'getRiskForecast'
  | 'getRiskInsider'
  | 'getStockAnnouncements'
>;

const MAX_STOCKS = 8;
const STOCK_CONCURRENCY = 2;
const LOOKBACK_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1_000;

const CHECK_ORDER: StockRiskCheckKey[] = [
  'pledge',
  'goodwill',
  'forecast',
  'insider',
  'announcements',
];

const RISK_ORDER: RiskKey[] = [
  'pledge',
  'goodwill',
  'forecast',
  'insider',
  'reduction_plan',
  'inquiry',
];

const SEVERITY_RANK: Record<StockRiskSeverity, number> = {
  高风险: 0,
  警示: 1,
  关注: 2,
};

const TRIGGER_COPY: Record<RiskKey, string> = {
  pledge: '质押比例达到 30%；超过 50% 进入高风险档',
  goodwill: '商誉占净资产达到 10%；超过 30% 进入高风险档',
  forecast: '业绩预告类型属于预减或亏损',
  insider: `最近 ${LOOKBACK_DAYS} 日存在董监高减持记录`,
  reduction_plan: `最近 ${LOOKBACK_DAYS} 日公告标题包含减持`,
  inquiry: `最近 ${LOOKBACK_DAYS} 日公告标题包含问询函、关注函或监管函`,
};

const RELEVANCE_COPY: Record<RiskKey, string> = {
  pledge: '质押比例较高时，需要同时关注担保品价值变化和后续补充质押披露。',
  goodwill: '商誉占净资产较高时，后续减值可能明显影响利润和净资产。',
  forecast: '业绩预告走弱会改变对经营表现的事实判断，仍需等待正式财报确认。',
  insider: '内部人持股变化会影响市场预期，需要结合规模、原因和后续披露复核。',
  reduction_plan: '减持计划可能改变阶段性流通供给，需要继续跟踪实施进度。',
  inquiry: '监管问询表示相关事项需要进一步说明，应跟踪公司回复和后续处置。',
};

function severityFor(signal: RiskSignal): StockRiskSeverity {
  if ((signal.key === 'pledge' || signal.key === 'goodwill') && signal.star) {
    return '高风险';
  }
  if (signal.key === 'forecast' || signal.key === 'inquiry') return '警示';
  return '关注';
}

function canonicalHash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const raw = value instanceof Date ? value.toISOString() : value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(raw);
  return dashed ? `${dashed[1]}-${dashed[2]}-${dashed[3]}` : null;
}

function latestDate(values: unknown[]): string | null {
  const dates = values.map(normalizedDate).filter((value): value is string => value !== null);
  return dates.sort().at(-1) ?? null;
}

function lookbackStart(dataAsOf: string): string {
  const end = new Date(`${dataAsOf}T00:00:00.000Z`);
  return new Date(end.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
}

function withinWindow(value: unknown, start: string, end: string): boolean {
  const date = normalizedDate(value);
  return date !== null && date >= start && date <= end;
}

function failedEnvelope(envelope: AkEnvelope<unknown>): boolean {
  return Boolean(envelope.error || envelope.error_code);
}

function checkFromEnvelope(args: {
  stock: StockRiskRadarStock;
  key: StockRiskCheckKey;
  envelope: AkEnvelope<unknown>;
  sourceDataAsOf: string | null;
}): StockRiskSourceCheck {
  return {
    symbol: args.stock.symbol,
    name: args.stock.name,
    key: args.key,
    status: failedEnvelope(args.envelope) ? 'unavailable' : 'checked',
    source: args.envelope.source,
    fetchedAt: args.envelope.fetched_at,
    sourceDataAsOf: args.sourceDataAsOf,
    errorCode: args.envelope.error_code ?? null,
  };
}

function sourceForSignal(args: {
  signal: RiskSignal;
  pledge: AkEnvelope<PledgeRow>;
  goodwill: AkEnvelope<GoodwillRow>;
  forecast: AkEnvelope<ForecastRow>;
  insider: AkEnvelope<InsiderChangeRow>;
  announcements: AkEnvelope<AnnouncementRow>;
}): AkEnvelope<unknown> {
  switch (args.signal.key) {
    case 'pledge':
      return args.pledge;
    case 'goodwill':
      return args.goodwill;
    case 'forecast':
      return args.forecast;
    case 'insider':
      return args.insider;
    case 'reduction_plan':
    case 'inquiry':
      return args.announcements;
  }
}

function evidenceAnnouncement(key: RiskKey, rows: AnnouncementRow[]): AnnouncementRow | null {
  if (key === 'reduction_plan') {
    return rows.find((row) => String(row.公告标题 ?? '').includes('减持')) ?? null;
  }
  if (key === 'inquiry') {
    return rows.find((row) => /问询函|关注函|监管函/.test(String(row.公告标题 ?? ''))) ?? null;
  }
  return null;
}

function sourceDateForSignal(args: {
  signal: RiskSignal;
  pledgeRows: PledgeRow[];
  goodwillRows: GoodwillRow[];
  forecastRows: ForecastRow[];
  insiderRows: InsiderChangeRow[];
  announcementRows: AnnouncementRow[];
}): string | null {
  switch (args.signal.key) {
    case 'pledge':
      return latestDate(args.pledgeRows.map((row) => row.交易日期));
    case 'goodwill':
      return latestDate(args.goodwillRows.map((row) => row.公告日期));
    case 'forecast':
      return latestDate(args.forecastRows.map((row) => row.公告日期));
    case 'insider':
      return latestDate(args.insiderRows.map((row) => row.变动日期));
    case 'reduction_plan':
    case 'inquiry': {
      const row = evidenceAnnouncement(args.signal.key, args.announcementRows);
      return normalizedDate(row?.公告时间);
    }
  }
}

function rawEvidenceForSignal(args: {
  signal: RiskSignal;
  pledgeRows: PledgeRow[];
  goodwillRows: GoodwillRow[];
  forecastRows: ForecastRow[];
  insiderRows: InsiderChangeRow[];
  announcementRows: AnnouncementRow[];
}): unknown {
  switch (args.signal.key) {
    case 'pledge': {
      const row = args.pledgeRows[0];
      return [
        row?.交易日期 ?? null,
        row?.质押比例 ?? null,
        row?.质押股数 ?? null,
        row?.质押市值 ?? null,
      ];
    }
    case 'goodwill': {
      const row = args.goodwillRows[0];
      return [
        row?.公告日期 ?? null,
        row?.商誉 ?? null,
        row?.商誉占净资产比例 ?? null,
        row?.上年商誉 ?? null,
      ];
    }
    case 'forecast': {
      const row = args.forecastRows[0];
      return [row?.公告日期 ?? null, row?.预告类型 ?? null, row?.业绩变动幅度 ?? null];
    }
    case 'insider':
      return args.insiderRows
        .map((row) => [
          row.变动日期 ?? null,
          row.变动数 ?? null,
          row.变动原因 ?? null,
          row.姓名 ?? null,
          row.职务 ?? null,
        ])
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    case 'reduction_plan':
    case 'inquiry': {
      const row = evidenceAnnouncement(args.signal.key, args.announcementRows);
      return [row?.公告时间 ?? null, row?.公告标题 ?? null, row?.公告链接 ?? null];
    }
  }
}

function signalRecord(args: {
  snapshotId: string;
  stock: StockRiskRadarStock;
  signal: RiskSignal;
  pledge: AkEnvelope<PledgeRow>;
  goodwill: AkEnvelope<GoodwillRow>;
  forecast: AkEnvelope<ForecastRow>;
  insider: AkEnvelope<InsiderChangeRow>;
  announcements: AkEnvelope<AnnouncementRow>;
  insiderRows: InsiderChangeRow[];
  announcementRows: AnnouncementRow[];
}): StockRiskSignalRecord {
  const sourceEnvelope = sourceForSignal(args);
  const sourceDataAsOf = sourceDateForSignal({
    signal: args.signal,
    pledgeRows: args.pledge.data,
    goodwillRows: args.goodwill.data,
    forecastRows: args.forecast.data,
    insiderRows: args.insiderRows,
    announcementRows: args.announcementRows,
  });
  const announcement = evidenceAnnouncement(args.signal.key, args.announcementRows);
  const evidenceUrl = typeof announcement?.公告链接 === 'string' ? announcement.公告链接 : null;
  const rawEvidence = rawEvidenceForSignal({
    signal: args.signal,
    pledgeRows: args.pledge.data,
    goodwillRows: args.goodwill.data,
    forecastRows: args.forecast.data,
    insiderRows: args.insiderRows,
    announcementRows: args.announcementRows,
  });
  const identity = [
    args.stock.symbol,
    args.signal.key,
    args.signal.finding,
    sourceDataAsOf,
    sourceEnvelope.source,
    evidenceUrl,
    rawEvidence,
  ];
  return {
    signalId: `risk_signal_${canonicalHash([args.snapshotId, ...identity])}`,
    evidenceId: `risk:${canonicalHash(identity)}`,
    symbol: args.stock.symbol,
    name: args.stock.name,
    key: args.signal.key,
    label: args.signal.label,
    severity: severityFor(args.signal),
    fact: args.signal.finding,
    trigger:
      args.signal.key === 'pledge' && args.signal.star
        ? '质押比例超过 50%'
        : args.signal.key === 'goodwill' && args.signal.star
          ? '商誉占净资产比例超过 30%'
          : TRIGGER_COPY[args.signal.key],
    whyRelevant: RELEVANCE_COPY[args.signal.key],
    observedAt: sourceDataAsOf,
    sourceDataAsOf,
    source: sourceEnvelope.source,
    fetchedAt: sourceEnvelope.fetched_at,
    evidenceUrl,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index] as T);
      }
    }),
  );
  return results;
}

async function inspectStock(args: {
  client: StockRiskRadarClient;
  snapshotId: string;
  dataAsOf: string;
  stock: StockRiskRadarStock;
}): Promise<{ signals: StockRiskSignalRecord[]; checks: StockRiskSourceCheck[] }> {
  const compactDate = args.dataAsOf.replaceAll('-', '');
  const startDate = lookbackStart(args.dataAsOf);
  const compactStartDate = startDate.replaceAll('-', '');
  const [pledge, goodwill, forecast, insider, announcements] = await Promise.all([
    args.client.getRiskPledge(compactDate, args.stock.symbol),
    args.client.getRiskGoodwill(compactDate, args.stock.symbol),
    args.client.getRiskForecast(compactDate, args.stock.symbol),
    args.client.getRiskInsider(args.stock.symbol),
    args.client.getStockAnnouncements(args.stock.symbol, compactStartDate, compactDate),
  ]);
  const insiderRows = failedEnvelope(insider)
    ? []
    : insider.data.filter((row) => withinWindow(row.变动日期, startDate, args.dataAsOf));
  const announcementRows = failedEnvelope(announcements)
    ? []
    : announcements.data.filter((row) => withinWindow(row.公告时间, startDate, args.dataAsOf));
  const detected = detectAllRisks({
    pledge: failedEnvelope(pledge) ? undefined : pledge.data[0],
    goodwill: failedEnvelope(goodwill) ? undefined : goodwill.data[0],
    forecast: failedEnvelope(forecast) ? undefined : forecast.data[0],
    insider: insiderRows,
    announcements: announcementRows,
  }).filter((signal) => signal.key !== 'forecast' || signal.star);

  const sourceDates: Record<StockRiskCheckKey, string | null> = {
    pledge: latestDate(pledge.data.map((row) => row.交易日期)),
    goodwill: latestDate(goodwill.data.map((row) => row.公告日期)),
    forecast: latestDate(forecast.data.map((row) => row.公告日期)),
    insider: latestDate(insiderRows.map((row) => row.变动日期)),
    announcements: latestDate(announcementRows.map((row) => row.公告时间)),
  };
  const envelopes: Record<StockRiskCheckKey, AkEnvelope<unknown>> = {
    pledge,
    goodwill,
    forecast,
    insider,
    announcements,
  };
  return {
    signals: detected.map((signal) =>
      signalRecord({
        snapshotId: args.snapshotId,
        stock: args.stock,
        signal,
        pledge,
        goodwill,
        forecast,
        insider,
        announcements,
        insiderRows,
        announcementRows,
      }),
    ),
    checks: CHECK_ORDER.map((key) =>
      checkFromEnvelope({
        stock: args.stock,
        key,
        envelope: envelopes[key],
        sourceDataAsOf: sourceDates[key],
      }),
    ),
  };
}

export async function runStockRiskRadar(args: {
  client: StockRiskRadarClient;
  snapshotId: string;
  dataAsOf: string;
  stocks: StockRiskRadarStock[];
  now?: Date;
}): Promise<StockRiskRadarResult> {
  const uniqueStocks = [
    ...new Map(
      args.stocks
        .filter((stock) => (stock.market ?? 'A') === 'A' && /^\d{6}$/.test(stock.symbol))
        .map((stock) => [stock.symbol, stock]),
    ).values(),
  ];
  const selectedStocks = uniqueStocks.slice(0, MAX_STOCKS);
  const inspected = await mapWithConcurrency(selectedStocks, STOCK_CONCURRENCY, async (stock) =>
    inspectStock({
      client: args.client,
      snapshotId: args.snapshotId,
      dataAsOf: args.dataAsOf,
      stock,
    }),
  );
  const signals = inspected
    .flatMap((result) => result.signals)
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        left.symbol.localeCompare(right.symbol) ||
        RISK_ORDER.indexOf(left.key) - RISK_ORDER.indexOf(right.key),
    );
  return {
    snapshotId: args.snapshotId,
    dataAsOf: args.dataAsOf,
    generatedAt: (args.now ?? new Date()).toISOString(),
    requestedStockCount: uniqueStocks.length,
    checkedStockCount: selectedStocks.length,
    truncated: uniqueStocks.length > selectedStocks.length,
    signals,
    checks: inspected.flatMap((result) => result.checks),
  };
}

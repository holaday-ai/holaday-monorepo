import { createHash } from 'node:crypto';
import type { AkshareClient } from '../agent/a-share/akshare-client.js';

export type StockTrustMode = 'current' | 'delayed' | 'historical' | 'unavailable';
export type StockMarketSession = 'preopen' | 'open' | 'lunch' | 'closed' | 'non-trading';
export type StockCalendarStatus = 'verified' | 'unavailable';

export interface StockSourceHealth {
  key: 'quotes' | 'indices' | 'news' | 'announcements';
  status: 'healthy' | 'delayed' | 'failed' | 'disabled';
  dataAsOf: string | null;
  fetchedAt: string | null;
  errorCode?: string;
}

export interface StockSnapshotTrust {
  snapshotId: string;
  generatedAt: string;
  marketTimezone: 'Asia/Shanghai';
  marketSession: StockMarketSession;
  latestExpectedTradingDate: string | null;
  dataAsOf: string | null;
  mode: StockTrustMode;
  calendarStatus: StockCalendarStatus;
  sources: StockSourceHealth[];
  evidenceIds: string[];
}

type LegacyFreshnessStatus = 'fresh' | 'refreshing' | 'stale' | 'partial';

export interface StockSnapshotTrustInput {
  snapshotKey: string;
  now: Date;
  generatedAt: string;
  latestExpectedTradingDate: string | null;
  dataAsOf: string | null;
  calendarStatus: StockCalendarStatus;
  freshnessStatus: LegacyFreshnessStatus;
  sources: StockSourceHealth[];
  evidenceIds: string[];
  marketIsTradingDay?: boolean;
}

export interface LatestExpectedTradingDate {
  date: string | null;
  status: StockCalendarStatus;
  fetchedAt: string | null;
  isTradingDay: boolean | null;
}

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const MAX_SNAPSHOT_AGE_MS = 7 * 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ShanghaiParts {
  date: string;
  minuteOfDay: number;
}

function shanghaiParts(now: Date): ShanghaiParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function latestDateFromEnvelope(
  env: Awaited<ReturnType<AkshareClient['getLatestTradingDay']>>,
): string | null {
  if (env.error) return null;
  const date = env.data[0]?.latest_trading_date;
  return typeof date === 'string' && ISO_DATE.test(date) ? date : null;
}

export async function latestExpectedTradingDate(
  client: Pick<AkshareClient, 'getLatestTradingDay'>,
  now: Date,
): Promise<LatestExpectedTradingDate> {
  const current = shanghaiParts(now);
  const todayEnv = await client.getLatestTradingDay(current.date);
  const todayLatest = latestDateFromEnvelope(todayEnv);
  if (!todayLatest) {
    return {
      date: null,
      status: 'unavailable',
      fetchedAt: todayEnv.fetched_at ?? null,
      isTradingDay: null,
    };
  }

  const isTradingDay = todayLatest === current.date;
  if (isTradingDay && current.minuteOfDay < 9 * 60 + 45) {
    const previousEnv = await client.getLatestTradingDay(shiftIsoDate(current.date, -1));
    const previous = latestDateFromEnvelope(previousEnv);
    if (!previous) {
      return {
        date: null,
        status: 'unavailable',
        fetchedAt: previousEnv.fetched_at ?? null,
        isTradingDay,
      };
    }
    return {
      date: previous,
      status: 'verified',
      fetchedAt: previousEnv.fetched_at ?? null,
      isTradingDay,
    };
  }

  return {
    date: todayLatest,
    status: 'verified',
    fetchedAt: todayEnv.fetched_at ?? null,
    isTradingDay,
  };
}

export function marketSessionAt(now: Date, isTradingDay: boolean): StockMarketSession {
  if (!isTradingDay) return 'non-trading';
  const { minuteOfDay } = shanghaiParts(now);
  if (minuteOfDay < 9 * 60 + 30) return 'preopen';
  if (minuteOfDay < 11 * 60 + 30) return 'open';
  if (minuteOfDay < 13 * 60) return 'lunch';
  if (minuteOfDay < 15 * 60) return 'open';
  return 'closed';
}

function snapshotMode(input: StockSnapshotTrustInput): StockTrustMode {
  if (!input.dataAsOf || !ISO_DATE.test(input.dataAsOf)) return 'unavailable';
  const generatedAt = new Date(input.generatedAt);
  const currentShanghaiDate = shanghaiParts(input.now).date;
  const dataAgeMs =
    Date.parse(`${currentShanghaiDate}T00:00:00.000Z`) -
    Date.parse(`${input.dataAsOf}T00:00:00.000Z`);
  if (
    Number.isNaN(generatedAt.getTime()) ||
    input.now.getTime() - generatedAt.getTime() > MAX_SNAPSHOT_AGE_MS ||
    dataAgeMs > MAX_SNAPSHOT_AGE_MS
  ) {
    return 'unavailable';
  }
  if (input.calendarStatus !== 'verified' || !input.latestExpectedTradingDate) return 'delayed';
  if (input.dataAsOf < input.latestExpectedTradingDate) return 'historical';
  if (input.dataAsOf > input.latestExpectedTradingDate) return 'unavailable';

  const quoteStatus = input.sources.find((source) => source.key === 'quotes')?.status;
  if (
    quoteStatus === 'healthy' &&
    (input.freshnessStatus === 'fresh' || input.freshnessStatus === 'partial')
  ) {
    return 'current';
  }
  return 'delayed';
}

export function stockSnapshotTrust(input: StockSnapshotTrustInput): StockSnapshotTrust {
  const sources = [...input.sources].sort((left, right) => left.key.localeCompare(right.key));
  const evidenceIds = [...new Set(input.evidenceIds)].sort();
  const mode = snapshotMode(input);
  const currentShanghaiDate = shanghaiParts(input.now).date;
  const marketIsTradingDay =
    input.marketIsTradingDay ?? input.latestExpectedTradingDate === currentShanghaiDate;
  const hashPayload = JSON.stringify([
    input.snapshotKey,
    input.generatedAt,
    input.latestExpectedTradingDate,
    input.dataAsOf,
    input.calendarStatus,
    sources.map((source) => [
      source.key,
      source.status,
      source.dataAsOf,
      source.fetchedAt,
      source.errorCode ?? null,
    ]),
    evidenceIds,
  ]);

  return {
    snapshotId: `stkshot_${createHash('sha256').update(hashPayload).digest('hex').slice(0, 24)}`,
    generatedAt: input.generatedAt,
    marketTimezone: SHANGHAI_TIME_ZONE,
    marketSession: marketSessionAt(input.now, marketIsTradingDay),
    latestExpectedTradingDate: input.latestExpectedTradingDate,
    dataAsOf: input.dataAsOf,
    mode,
    calendarStatus: input.calendarStatus,
    sources,
    evidenceIds,
  };
}

export type StockDashboardFreshnessStatus = 'fresh' | 'partial' | 'refreshing' | 'stale';

export interface StockDashboardTrustInput {
  freshnessStatus?: StockDashboardFreshnessStatus;
  freshnessMessage?: string | null;
  observedTradeDate?: string | null;
  refreshedAt?: string | null;
  now?: Date;
}

export interface StockDashboardTrustState {
  tone: 'fresh' | 'refreshing' | 'stale' | 'unverified';
  statusLabel: string;
  canGenerateBriefing: boolean;
  dataDateLabel: string;
  refreshLabel: string;
  message: string | null;
}

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

function formatObservedDate(value?: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? `${match[2]}/${match[3]}` : null;
}

function formatRefreshTime(value?: string | null): string {
  if (!value) return '刷新时间待核验';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刷新时间待核验';
  return `刷新于 ${new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)}`;
}

function shanghaiCalendarDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function calendarDayGap(observedTradeDate: string, now: Date): number {
  const observed = new Date(`${observedTradeDate}T00:00:00+08:00`);
  if (Number.isNaN(observed.getTime())) return Number.POSITIVE_INFINITY;
  const current = new Date(`${shanghaiCalendarDate(now)}T00:00:00+08:00`);
  return Math.floor((current.getTime() - observed.getTime()) / 86_400_000);
}

function requiresCurrentTradeDate(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekday = value('weekday');
  const minuteOfDay = Number(value('hour')) * 60 + Number(value('minute'));
  return weekday !== 'Sat' && weekday !== 'Sun' && minuteOfDay >= 9 * 60 + 32;
}

function isBackgroundRefresh(message?: string | null): boolean {
  return /(?:正在后台刷新行情|行情接口正在刷新|行情接口暂未返回)/.test(message ?? '');
}

export function stockDashboardTrustState(input: StockDashboardTrustInput): StockDashboardTrustState {
  const observedLabel = formatObservedDate(input.observedTradeDate);
  const refreshLabel = formatRefreshTime(input.refreshedAt);
  if (!observedLabel || !input.observedTradeDate) {
    return {
      tone: 'unverified',
      statusLabel: '日期未核验',
      canGenerateBriefing: false,
      dataDateLabel: '数据日期待核验',
      refreshLabel,
      message: '真实行情日期尚未核验，不用于生成日报或当前盘面判断。',
    };
  }

  const now = input.now ?? new Date();
  const dayGap = calendarDayGap(input.observedTradeDate, now);
  const dateIsCurrentEnough =
    dayGap >= 0 &&
    dayGap <= 3 &&
    (!requiresCurrentTradeDate(now) || input.observedTradeDate === shanghaiCalendarDate(now));
  if ((input.freshnessStatus === 'fresh' || input.freshnessStatus === 'partial') && dateIsCurrentEnough) {
    return {
      tone: 'fresh',
      statusLabel: 'AkShare',
      canGenerateBriefing: true,
      dataDateLabel: `数据日期 ${observedLabel}`,
      refreshLabel,
      message: null,
    };
  }

  if (
    dateIsCurrentEnough &&
    (input.freshnessStatus === 'refreshing' || (
      input.freshnessStatus === 'stale' && isBackgroundRefresh(input.freshnessMessage)
    ))
  ) {
    return {
      tone: 'refreshing',
      statusLabel: '行情刷新中',
      canGenerateBriefing: false,
      dataDateLabel: `数据日期 ${observedLabel}`,
      refreshLabel,
      message: input.freshnessMessage ?? '正在后台刷新行情，当前展示最近一次真实数据。',
    };
  }

  return {
    tone: 'stale',
    statusLabel: '数据过期',
    canGenerateBriefing: false,
    dataDateLabel: `数据日期 ${observedLabel}`,
    refreshLabel,
    message: `当前展示 ${observedLabel} 的真实历史数据，不代表当前行情。真实行情恢复后可生成日报。`,
  };
}

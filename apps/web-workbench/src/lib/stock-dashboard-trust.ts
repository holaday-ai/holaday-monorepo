export type StockDashboardFreshnessStatus = 'fresh' | 'partial' | 'stale';

export interface StockDashboardTrustInput {
  freshnessStatus?: StockDashboardFreshnessStatus;
  observedTradeDate?: string | null;
  refreshedAt?: string | null;
  now?: Date;
}

export interface StockDashboardTrustState {
  tone: 'fresh' | 'stale' | 'unverified';
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

function calendarDayGap(observedTradeDate: string, now: Date): number {
  const observed = new Date(`${observedTradeDate}T00:00:00+08:00`);
  if (Number.isNaN(observed.getTime())) return Number.POSITIVE_INFINITY;
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const current = new Date(`${currentDate}T00:00:00+08:00`);
  return Math.floor((current.getTime() - observed.getTime()) / 86_400_000);
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

  const dateIsCurrentEnough = calendarDayGap(input.observedTradeDate, input.now ?? new Date()) <= 3;
  if (input.freshnessStatus === 'fresh' && dateIsCurrentEnough) {
    return {
      tone: 'fresh',
      statusLabel: 'AkShare',
      canGenerateBriefing: true,
      dataDateLabel: `数据日期 ${observedLabel}`,
      refreshLabel,
      message: null,
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

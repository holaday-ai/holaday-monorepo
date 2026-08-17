export type StockDashboardTrustMode = 'current' | 'delayed' | 'historical' | 'unavailable';

export interface StockDashboardTrustEnvelope {
  generatedAt: string;
  dataAsOf: string | null;
  mode: StockDashboardTrustMode;
}

export interface StockDashboardTrustInput {
  trust?: StockDashboardTrustEnvelope | null;
}

export interface StockDashboardTrustState {
  tone: StockDashboardTrustMode | 'unverified';
  statusLabel: string;
  canGenerateBriefing: boolean;
  canCreateCurrentTask: boolean;
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

export function stockDashboardTrustState(
  input: StockDashboardTrustInput,
): StockDashboardTrustState {
  const trust = input.trust;
  if (!trust) {
    return {
      tone: 'unverified',
      statusLabel: '日期未核验',
      canGenerateBriefing: false,
      canCreateCurrentTask: false,
      dataDateLabel: '数据日期待核验',
      refreshLabel: '刷新时间待核验',
      message: '可信行情状态尚未返回，不用于生成日报或当前盘面判断。',
    };
  }

  const dataDate = formatObservedDate(trust.dataAsOf);
  const dataDateLabel = dataDate ? `数据日期 ${dataDate}` : '数据日期待核验';
  const refreshLabel = formatRefreshTime(trust.generatedAt);
  if (trust.mode === 'current') {
    return {
      tone: 'current',
      statusLabel: 'AkShare',
      canGenerateBriefing: true,
      canCreateCurrentTask: true,
      dataDateLabel,
      refreshLabel,
      message: null,
    };
  }
  if (trust.mode === 'delayed') {
    return {
      tone: 'delayed',
      statusLabel: '行情刷新中',
      canGenerateBriefing: false,
      canCreateCurrentTask: false,
      dataDateLabel,
      refreshLabel,
      message: dataDate
        ? `正在核验 ${dataDate} 的行情快照，完成前不生成当前盘面结论。`
        : '行情快照正在核验，完成前不生成当前盘面结论。',
    };
  }
  if (trust.mode === 'historical') {
    return {
      tone: 'historical',
      statusLabel: '历史回看',
      canGenerateBriefing: false,
      canCreateCurrentTask: false,
      dataDateLabel,
      refreshLabel,
      message: dataDate
        ? `此处展示 ${dataDate} 的真实历史数据，不代表当前行情。`
        : '此处仅供历史回看。',
    };
  }
  return {
    tone: 'unavailable',
    statusLabel: '行情不可用',
    canGenerateBriefing: false,
    canCreateCurrentTask: false,
    dataDateLabel,
    refreshLabel,
    message: '可信行情暂不可用，旧数值已隐藏；请刷新后再创建股票数据任务。',
  };
}

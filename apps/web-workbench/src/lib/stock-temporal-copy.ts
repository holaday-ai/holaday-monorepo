import type { StockDashboardTrustState } from './stock-dashboard-trust';

export type StockTemporalMode = StockDashboardTrustState['tone'];
export type StockMarketSession = 'preopen' | 'open' | 'lunch' | 'closed' | 'non-trading';
export type StockSignal = '强势' | '偏强' | '中性' | '偏弱' | '风险升高' | '待观察';

export interface StockTemporalCopy {
  assistantStatus: string;
  briefingTabLabel: string;
  briefingTitle: string;
  briefingCommand: string;
  performanceLabel: string;
  priceLabel: string;
  opportunityTitle: string;
  opportunityEmpty: string;
  starTitle: string;
  starMeta: string;
  storyTitleSuffix: string;
  storyStatusLabel: string;
  updateLabel: string;
  researchTimestampLabel: string | null;
  promptPlaceholder: string;
}

function compactDate(dataAsOf: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataAsOf ?? '');
  return match ? `${match[2]}/${match[3]}` : null;
}

export function stockTemporalCopy(
  mode: StockTemporalMode,
  dataAsOf: string | null,
  marketSession?: StockMarketSession | null,
): StockTemporalCopy {
  const date = compactDate(dataAsOf);
  if (
    mode === 'current' &&
    date &&
    (marketSession === 'non-trading' || marketSession === 'preopen')
  ) {
    const sessionLabel = marketSession === 'non-trading' ? '休市中' : '开盘前';
    return {
      assistantStatus: `${sessionLabel} · 基于 ${date} 最新交易日快照`,
      briefingTabLabel: '交易日简报',
      briefingTitle: `${date} 最新交易日简报`,
      briefingCommand: `基于 ${date} 生成交易日复盘`,
      performanceLabel: `${date} 表现`,
      priceLabel: `${date} 收盘价`,
      opportunityTitle: '最新交易日关注点',
      opportunityEmpty: '暂无已核验的交易日关注点',
      starTitle: '关注股票',
      starMeta: `${date} 收盘`,
      storyTitleSuffix: ` ${date} 交易日发生了什么`,
      storyStatusLabel: `${marketSession === 'non-trading' ? '休市' : '开盘前'} · 最新交易日已核验`,
      updateLabel: '快照刷新',
      researchTimestampLabel: `${date} 行情`,
      promptPlaceholder: `基于 ${date} 最新交易日数据研究股票、市场或行业`,
    };
  }
  if (mode === 'current') {
    return {
      assistantStatus: '正在理解你的关注股票',
      briefingTabLabel: '今日简报',
      briefingTitle: '今日关注日报',
      briefingCommand: '生成今日关注日报',
      performanceLabel: '当前表现',
      priceLabel: '最新价',
      opportunityTitle: '机会',
      opportunityEmpty: '暂无真实机会信号',
      starTitle: '明星股票',
      starMeta: '今日关注',
      storyTitleSuffix: '今日发生了什么',
      storyStatusLabel: '行情已核验',
      updateLabel: '数据更新',
      researchTimestampLabel: null,
      promptPlaceholder: '今天想让 AI 帮你看什么？',
    };
  }
  if (mode === 'historical' && date) {
    return {
      assistantStatus: `基于 ${date} 可信快照继续研究`,
      briefingTabLabel: '历史复盘',
      briefingTitle: `${date} 回看重点`,
      briefingCommand: `基于 ${date} 生成历史复盘`,
      performanceLabel: '当日表现',
      priceLabel: '当日价格',
      opportunityTitle: '当时的关注点',
      opportunityEmpty: '暂无历史关注点',
      starTitle: '关注股票',
      starMeta: `${date} 回看`,
      storyTitleSuffix: ` ${date} 当日发生了什么`,
      storyStatusLabel: '历史数据',
      updateLabel: '快照生成',
      researchTimestampLabel: `${date} 行情`,
      promptPlaceholder: `基于 ${date} 数据回看股票、市场或行业`,
    };
  }
  if (mode === 'delayed') {
    return {
      assistantStatus: '正在核验行情快照',
      briefingTabLabel: '快照核验',
      briefingTitle: date ? `${date} 快照核验中` : '行情快照核验中',
      briefingCommand: '等待行情核验',
      performanceLabel: '快照表现',
      priceLabel: '快照价格',
      opportunityTitle: '快照关注点',
      opportunityEmpty: '关注点仍在核验',
      starTitle: '关注股票',
      starMeta: date ? `${date} 快照` : '行情核验中',
      storyTitleSuffix: date ? ` ${date} 快照核验中` : '行情快照核验中',
      storyStatusLabel: '行情校验中',
      updateLabel: '快照刷新',
      researchTimestampLabel: date ? `${date} 快照` : null,
      promptPlaceholder: '行情正在核验，可先询问非时效性的股票知识',
    };
  }
  return {
    assistantStatus: '等待可信行情恢复',
    briefingTabLabel: '行情待恢复',
    briefingTitle: '行情待恢复',
    briefingCommand: '等待可信行情',
    performanceLabel: '表现待核验',
    priceLabel: '价格待核验',
    opportunityTitle: '关注点待核验',
    opportunityEmpty: '暂无可核验的行情关注点',
    starTitle: '关注股票',
    starMeta: '行情待恢复',
    storyTitleSuffix: '行情待核验',
    storyStatusLabel: '行情待核验',
    updateLabel: '刷新状态',
    researchTimestampLabel: null,
    promptPlaceholder: '可信行情恢复后可创建股票数据任务',
  };
}

export function stockSignalLabel(signal: StockSignal, mode: StockTemporalMode): string {
  if (mode !== 'historical') return signal;
  const historicalLabels: Record<StockSignal, string> = {
    强势: '涨幅较高',
    偏强: '当日上涨',
    中性: '当日平稳',
    偏弱: '当日下跌',
    风险升高: '当日风险信号',
    待观察: '数据待观察',
  };
  return historicalLabels[signal];
}

export function stockQuickCommands(
  stocks: Array<{ symbol: string }>,
  copy: StockTemporalCopy,
): string[] {
  const first = stocks[0]?.symbol;
  const second = stocks[1]?.symbol;
  const historicalDate = /^基于 (\d{2}\/\d{2}) 生成历史复盘$/.exec(copy.briefingCommand)?.[1];
  if (historicalDate) {
    return [
      copy.briefingCommand,
      `截至 ${historicalDate}，哪些股票风险较高？`,
      `回看 ${historicalDate} 的 AI 板块表现`,
      first && second
        ? `比较 ${first} 和 ${second} 在 ${historicalDate} 的表现`
        : first
          ? `分析 ${first} 在 ${historicalDate} 的风险点`
          : '添加我的第一只关注股票',
    ];
  }
  if (copy.briefingCommand !== '生成今日关注日报') {
    return [
      copy.briefingCommand,
      '哪些股票存在已核验的风险信号？',
      '查看 AI 板块已核验信息',
      first && second
        ? `比较 ${first} 和 ${second}`
        : first
          ? `分析 ${first} 的风险点`
          : '添加我的第一只关注股票',
    ];
  }
  return [
    copy.briefingCommand,
    '哪些股票风险升高？',
    '今天 AI 板块怎么看？',
    first && second
      ? `比较 ${first} 和 ${second}`
      : first
        ? `分析 ${first} 的风险点`
        : '添加我的第一只关注股票',
  ];
}

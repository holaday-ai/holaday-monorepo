import {
  ArrowRight,
  BellPlus,
  ChevronDown,
  Circle,
  CircleDot,
  ClipboardList,
  FileText,
  ListChecks,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import * as React from 'react';
import type { StockScreeningViewState } from './StockScreeningWorkbench';

type StockWorkspaceTask = 'watchlist' | 'screening' | 'risk' | 'briefing';

const STOCK_WORKSPACE_TASKS: ReadonlyArray<{
  id: StockWorkspaceTask;
  label: string;
  description: string;
  icon: typeof ListChecks;
}> = [
  { id: 'watchlist', label: '关注股票', description: '查看事实与走势', icon: ListChecks },
  { id: 'screening', label: '条件选股', description: '按要求筛选', icon: Search },
  { id: 'risk', label: '风险证据', description: '核对触发与来源', icon: ShieldAlert },
  { id: 'briefing', label: '今日简报', description: '汇总关注变化', icon: FileText },
];

export function StockTaskWorkspaceLayout({
  highlights,
  riskRadar,
  screening,
  preferenceProfile,
  briefing,
  screeningView,
  onCreateTrackingTask = () => undefined,
}: {
  highlights: React.ReactNode;
  riskRadar: React.ReactNode;
  screening: React.ReactNode;
  preferenceProfile: React.ReactNode;
  briefing: React.ReactNode;
  screeningView: StockScreeningViewState;
  onCreateTrackingTask?: () => void;
}): JSX.Element {
  const [activeTask, setActiveTask] = React.useState<StockWorkspaceTask>('watchlist');
  const showsResults = screeningView === 'results';

  return (
    <section
      aria-label="核心股市任务"
      className="grid min-w-0 gap-4 rounded-[10px] border border-[#E7E1EC] bg-[#FBFAFD] p-2 shadow-[0_12px_32px_rgba(91,70,118,0.055)] lg:grid-cols-[152px_minmax(0,1fr)]"
    >
      <nav
        aria-label="股市任务视图"
        className="flex min-w-0 gap-1 overflow-x-auto rounded-[8px] border border-[#E7E1EC] bg-[#FFFDFB] p-1.5 lg:flex-col lg:overflow-visible lg:p-2"
      >
        <div className="hidden px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#98A2B3] lg:block">
          任务
        </div>
        {STOCK_WORKSPACE_TASKS.map((task) => {
          const Icon = task.icon;
          const selected = activeTask === task.id;
          return (
            <button
              key={task.id}
              type="button"
              aria-label={task.label}
              title={task.description}
              aria-current={selected ? 'page' : undefined}
              onClick={() => setActiveTask(task.id)}
              className={cn(
                'group relative flex min-w-[116px] shrink-0 items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 lg:min-w-0 lg:items-start lg:px-2 lg:py-2.5',
                selected
                  ? 'bg-[#FFF1F5] text-[#C9184A] shadow-[inset_2px_0_0_#EA1F59]'
                  : 'text-[#4F5868] hover:bg-[#F7F8FA] hover:text-[#121826]',
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-[#EA1F59]' : 'text-[#667085]')} aria-hidden />
              <span className="min-w-0">
                <span className="block whitespace-nowrap text-[13px] font-semibold">{task.label}</span>
                <span className="mt-0.5 hidden text-[10px] leading-snug text-[#98A2B3] lg:block">
                  {task.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {activeTask === 'watchlist' ? (
          <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_212px]">
            <div className="min-w-0">{highlights}</div>
            <NextStepRail
              onNavigate={setActiveTask}
              onCreateTrackingTask={onCreateTrackingTask}
            />
          </div>
        ) : null}
        {activeTask === 'risk' ? <div className="min-w-0">{riskRadar}</div> : null}
        {activeTask === 'screening' ? (
          <div className={cn('grid min-w-0 grid-cols-1 gap-4', showsResults ? '' : 'xl:grid-cols-[minmax(0,1fr)_340px]')}>
            <div className="min-w-0">{screening}</div>
            <div className="min-w-0">{preferenceProfile}</div>
          </div>
        ) : null}
        {activeTask === 'briefing' ? <div className="min-w-0">{briefing}</div> : null}
      </div>
    </section>
  );
}

function NextStepRail({
  onNavigate,
  onCreateTrackingTask,
}: {
  onNavigate: (task: StockWorkspaceTask) => void;
  onCreateTrackingTask: () => void;
}): JSX.Element {
  const actions: ReadonlyArray<{
    label: string;
    description: string;
    task: StockWorkspaceTask | null;
    icon: typeof ClipboardList;
  }> = [
    { label: '查看风险证据', description: '核对触发条件与来源', task: 'risk', icon: ShieldAlert },
    { label: '打开选股与偏好', description: '按条件筛选并看偏好盲点', task: 'screening', icon: ClipboardList },
    { label: '生成关注简报', description: '汇总本次关注变化', task: 'briefing', icon: FileText },
    { label: '设置跟踪任务', description: '在上方描述提醒条件', task: null, icon: BellPlus },
  ];
  return (
    <aside
      aria-label="下一步"
      className="min-w-0 rounded-[8px] border border-[#E7E1EC] bg-[#FFFDFB] p-3 shadow-[0_8px_20px_rgba(91,70,118,0.05)] 2xl:self-start"
    >
      <div className="text-[12px] font-semibold text-[#344054]">下一步</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              aria-label={action.label}
              title={action.description}
              onClick={() => {
                if (action.task) onNavigate(action.task);
                else onCreateTrackingTask();
              }}
              className="group grid min-w-0 grid-cols-[26px_minmax(0,1fr)_14px] items-center gap-2 rounded-[7px] border border-[#E8E2EE] bg-[#FAF8FD] px-2.5 py-2.5 text-left transition duration-200 hover:-translate-y-px hover:border-[#EA1F59]/25 hover:bg-[#FFF5F8] hover:shadow-[0_7px_16px_rgba(91,70,118,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] bg-white text-[#667085] shadow-[0_1px_3px_rgba(18,24,38,0.08)] group-hover:text-[#EA1F59]">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-[#344054]">{action.label}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-[#8B92A1]">{action.description}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-[#A4AAB5] transition group-hover:translate-x-0.5 group-hover:text-[#EA1F59]" aria-hidden />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export interface StockResearchRow {
  symbol: string;
  name: string;
  price: string;
  changePct: number | null;
  turnover: string;
  note: string;
  updatedAt: string;
}

export function StockResearchTable({
  rows,
  selectedSymbol,
  onSelect,
}: {
  rows: readonly StockResearchRow[];
  selectedSymbol: string | null;
  onSelect: (symbol: string) => void;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-[#E7E1EC] bg-white">
      <table aria-label="关注股票列表" className="w-full min-w-[720px] table-fixed border-collapse text-left">
        <thead className="bg-[#F9F6FB] text-[10px] font-medium text-[#776B85]">
          <tr className="border-b border-[#E7E7EB]">
            <th className="w-[112px] px-3 py-2 font-medium">代码</th>
            <th className="w-[92px] px-3 py-2 font-medium">名称</th>
            <th className="w-[104px] px-3 py-2 text-right font-medium">最新价</th>
            <th className="w-[84px] px-3 py-2 text-right font-medium">涨跌幅</th>
            <th className="hidden w-[104px] px-3 py-2 text-right font-medium md:table-cell">成交额</th>
            <th className="hidden px-3 py-2 font-medium xl:table-cell">关注原因 / 备注</th>
            <th className="hidden w-[118px] px-3 py-2 text-right font-medium 2xl:table-cell">更新</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.symbol === selectedSymbol;
            return (
              <tr
                key={row.symbol}
                className={cn(
                  'border-b border-[#F0F1F4] text-[12px] text-[#344054] last:border-b-0',
                  selected ? 'bg-[#FFF7F9]' : 'bg-white hover:bg-[#FAFAFB]',
                )}
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    aria-label={`查看${row.name}研究详情`}
                    title={`查看 ${row.name} 研究详情`}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(row.symbol)}
                    className="inline-flex items-center gap-2 font-medium tabular-nums text-[#4F5868] transition hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25"
                  >
                    {selected ? (
                      <CircleDot className="h-3.5 w-3.5 shrink-0 text-[#EA1F59]" aria-hidden />
                    ) : (
                      <Circle className="h-3.5 w-3.5 shrink-0 text-[#C4C9D2]" aria-hidden />
                    )}
                    {row.symbol}
                  </button>
                </td>
                <td className="px-3 py-2 font-semibold text-[#121826]">{row.name}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums text-[#121826]">{row.price}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-right font-medium tabular-nums',
                    row.changePct === null || row.changePct === 0
                      ? 'text-[#667085]'
                      : row.changePct > 0
                        ? 'text-[#E11D48]'
                        : 'text-[#0E9F6E]',
                  )}
                >
                  {row.changePct === null
                    ? '—'
                    : `${row.changePct > 0 ? '+' : ''}${row.changePct.toFixed(2)}%`}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-[#4F5868] md:table-cell">{row.turnover}</td>
                <td className="hidden truncate px-3 py-2 text-[#667085] xl:table-cell">{row.note || '未填写备注'}</td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-[#8B92A1] 2xl:table-cell">{row.updatedAt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StockMarketContextLayout({
  discovery,
  temperature,
  sectors,
  leaderboard,
  marketTable,
  starStocks,
}: {
  discovery: React.ReactNode;
  temperature: React.ReactNode;
  sectors: React.ReactNode;
  leaderboard: React.ReactNode;
  marketTable: React.ReactNode;
  starStocks: React.ReactNode;
}): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <section
      aria-labelledby="stock-market-context-title"
      className="min-w-0 rounded-[9px] border border-[#E7E1EC] bg-[#FFFDFB] p-3 shadow-[0_8px_24px_rgba(91,70,118,0.04)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="px-0.5">
          <h2
            id="stock-market-context-title"
            className="text-[15px] font-semibold tracking-tight text-[#3E3154]"
          >
            市场背景
          </h2>
          <p className="mt-1 text-[11px] text-[#7D718A]">需要横向参照时再展开，不打断当前研究任务</p>
        </div>
        <button
          type="button"
          aria-label={expanded ? '收起市场背景' : '展开市场背景'}
          title={expanded ? '收起市场背景' : '展开市场背景'}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[7px] border border-[#DED5E6] bg-white px-3 text-[11px] font-medium text-[#6B587D] transition hover:border-[#CDBCD8] hover:bg-[#FAF7FC]"
        >
          {expanded ? '收起资料' : '查看市场资料'}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded ? 'rotate-180' : '')} aria-hidden />
        </button>
      </div>
      {expanded ? (
        <div className="mt-4 space-y-4 border-t border-[#EFEAF2] pt-4">
          <div className="min-w-0">{discovery}</div>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="min-w-0">{temperature}</div>
            <div className="min-w-0">{sectors}</div>
            <div className="min-w-0">{leaderboard}</div>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="min-w-0">{marketTable}</div>
            <div className="min-w-0">{starStocks}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

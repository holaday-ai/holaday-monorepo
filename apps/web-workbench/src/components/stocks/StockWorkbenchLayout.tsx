import {
  ArrowRight,
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
}: {
  highlights: React.ReactNode;
  riskRadar: React.ReactNode;
  screening: React.ReactNode;
  preferenceProfile: React.ReactNode;
  briefing: React.ReactNode;
  screeningView: StockScreeningViewState;
}): JSX.Element {
  const [activeTask, setActiveTask] = React.useState<StockWorkspaceTask>('watchlist');
  const showsResults = screeningView === 'results';

  return (
    <section
      aria-label="核心股市任务"
      className="min-w-0 overflow-hidden rounded-[22px] border border-[#E9E0EC] bg-[#FFFCFA] shadow-[0_18px_48px_rgba(103,75,121,0.07)]"
    >
      <nav
        aria-label="股市任务视图"
        className="grid min-w-0 grid-cols-2 gap-1 border-b border-[#EFE7F1] bg-white p-2 sm:grid-cols-4"
      >
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
                'group relative flex h-11 min-w-0 items-center justify-center gap-2 rounded-[13px] px-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 motion-reduce:transition-none sm:px-3',
                selected
                  ? 'bg-[#FFF0F4] text-[#C9184A] shadow-[0_6px_18px_rgba(220,48,93,0.08)]'
                  : 'text-[#566074] hover:bg-[#F7F4FC] hover:text-[#332842]',
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-[#EA1F59]' : 'text-[#7A8192]')} aria-hidden />
              <span className="min-w-0">
                <span className="block whitespace-nowrap text-[13px] font-semibold">{task.label}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 p-2.5 sm:p-3">
        {activeTask === 'watchlist' ? (
          <div className="min-w-0 space-y-3">
            <div className="min-w-0">{highlights}</div>
            <NextStepRail onNavigate={setActiveTask} />
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
}: {
  onNavigate: (task: StockWorkspaceTask) => void;
}): JSX.Element {
  const actions: ReadonlyArray<{
    label: string;
    description: string;
    task: StockWorkspaceTask | null;
    icon: typeof ClipboardList;
  }> = [
    { label: '查看风险证据', description: '核对触发条件与来源', task: 'risk', icon: ShieldAlert },
    { label: '打开选股与偏好', description: '按条件筛选并看偏好盲点', task: 'screening', icon: ClipboardList },
  ];
  return (
    <aside
      aria-label="下一步"
      className="grid min-w-0 gap-2.5 rounded-[14px] border border-[#E8DFEC] bg-[#FFFDFB] px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-[#3E3154]">下一步</div>
        <p className="mt-0.5 truncate text-[10px] text-[#8A8192]">继续核验，或按偏好寻找下一批候选</p>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
        {actions.map((action) => {
          const Icon = action.icon;
          const isPrimary = action.task === 'risk';
          return (
            <button
              key={action.label}
              type="button"
              aria-label={action.label}
              title={action.description}
              onClick={() => {
                if (action.task) onNavigate(action.task);
              }}
              className={cn(
                'group inline-flex h-11 min-[769px]:h-9 min-w-0 items-center justify-center gap-2 rounded-[10px] border px-3 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 motion-reduce:transition-none sm:min-w-[154px]',
                isPrimary
                  ? 'border-[#F2CCD7] bg-[#FFF0F4] text-[#B4234D] hover:border-[#EBAFC0] hover:bg-[#FFE8EF]'
                  : 'border-[#DDE5F1] bg-[#F7FAFF] text-[#475467] hover:border-[#C7D6EA] hover:bg-[#EEF6FF]',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate text-[11px] font-semibold">{action.label}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-55 transition group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
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
    <div className="overflow-hidden rounded-[16px] border border-[#E8E1EC] bg-white shadow-[0_10px_28px_rgba(95,73,112,0.045)]">
      <table aria-label="关注股票列表" className="w-full border-collapse text-left">
        <thead className="sr-only">
          <tr>
            <th>股票</th>
            <th>最新价</th>
            <th>涨跌幅</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F0ECF2]">
          {rows.map((row) => {
            const selected = row.symbol === selectedSymbol;
            return (
              <tr
                key={row.symbol}
                className={cn(
                  'text-[12px] text-[#344054] transition-colors',
                  selected ? 'bg-[#FFF1F5]' : 'bg-white hover:bg-[#FBF9FC]',
                )}
              >
                <td className={cn('px-3 py-2.5', selected ? 'shadow-[inset_3px_0_0_#EA1F59]' : '')}>
                  <button
                    type="button"
                    aria-label={`查看${row.name}研究详情`}
                    title={row.note || `查看 ${row.name} 研究详情`}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(row.symbol)}
                    className="flex min-w-0 items-center gap-2.5 text-left transition hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25"
                  >
                    {selected ? (
                      <CircleDot className="h-4 w-4 shrink-0 text-[#EA1F59]" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-[#C9C5D1]" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-[#2E2639]">{row.name}</span>
                      <span className="mt-0.5 block text-[10px] tabular-nums text-[#8A8192]">{row.symbol} · {row.updatedAt}</span>
                    </span>
                  </button>
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums text-[#2E2639]">{row.price}</td>
                <td
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5 text-right text-[11px] font-semibold tabular-nums',
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
      className="min-w-0 rounded-[18px] border border-[#E8E1EC] bg-[#FFFDFB] p-3.5 shadow-[0_10px_28px_rgba(91,70,118,0.045)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="px-0.5">
          <h2
            id="stock-market-context-title"
            className="text-[15px] font-semibold tracking-[-0.015em] text-[#3E3154]"
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
          className="inline-flex h-11 min-[769px]:h-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-[#DED5E6] bg-[#F8F5FC] px-3 text-[11px] font-medium text-[#6B587D] transition hover:border-[#CDBCD8] hover:bg-[#F2EBF8] motion-reduce:transition-none"
        >
          {expanded ? '收起资料' : '查看市场资料'}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform motion-reduce:transition-none',
              expanded ? 'rotate-180' : '',
            )}
            aria-hidden
          />
        </button>
      </div>
      {expanded ? (
        <div className="mt-4 space-y-4 border-t border-[#EFEAF2] pt-4">
          <div className="min-w-0">{discovery}</div>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="min-w-0 [&>section]:h-full">{temperature}</div>
            <div className="min-w-0 [&>section]:h-full">{sectors}</div>
            <div className="min-w-0 [&>section]:h-full">{leaderboard}</div>
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

import {
  Circle,
  ChevronDown,
  Maximize2,
  Minimize2,
  Layers,
  Clock3,
  ArrowUp,
  ClipboardList,
  Loader2,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const COMMAND_ICONS: readonly LucideIcon[] = [ClipboardList, ShieldCheck, TrendingUp, Scale];

function commandDisplayLabel(command: string, index: number): string {
  if (index === 0) {
    if (command.includes('等待')) return command;
    if (command.includes('历史') || command.includes('回看')) return '整理历史重点';
    if (command.includes('最新交易日') || command.includes('交易日复盘')) {
      return '整理交易日重点';
    }
    return '整理今日关注';
  }
  if (index === 1) return '核对风险变化';
  if (index === 2) return '分析行业主线';
  if (command.includes('添加')) return '添加关注股票';
  if (command.includes('比较')) return '比较两只股票';
  return '分析关注股票';
}

export function StockAiCommandComposer({
  value,
  placeholder,
  assistantStatus,
  commands,
  submitting,
  submitDisabled,
  onValueChange,
  onSubmit,
  onCommand,
  isCommandDisabled = () => false,
  commandTitle = () => undefined,
  approved = false,
  dataDateLabel,
  onManageWatchlist,
}: {
  approved?: boolean;
  dataDateLabel?: string;
  onManageWatchlist?: () => void;
  value: string;
  placeholder: string;
  assistantStatus: string;
  commands: readonly string[];
  submitting: boolean;
  submitDisabled: boolean;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onCommand: (command: string) => void;
  isCommandDisabled?: (command: string) => boolean;
  commandTitle?: (command: string) => string | undefined;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      aria-label="Holaday AI 股市研究助手"
      data-approved={approved || undefined}
      data-collapsed={collapsed}
      data-expanded={expanded}
      className="overflow-hidden rounded-[18px] border border-[#E9E0EC] bg-[#FFFCFB] p-2.5 shadow-[0_14px_36px_rgba(102,74,119,0.055)] sm:p-4"
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFF0F4] text-[#C9184A] sm:h-9 sm:w-9">
            <Sparkles className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-[-0.01em] text-[#332842]">Holaday AI</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[#83788C]">
              <Circle className="h-2 w-2 shrink-0 fill-[#E78CA5] text-[#E78CA5]" aria-hidden />
              <span className="truncate">{assistantStatus}</span>
            </div>
          </div>
        </div>
        <Sparkles className="h-4 w-4 shrink-0 text-[#EAB8C6]" aria-hidden />
      </div>

      {approved && <><div className="hd-stock-dock-meta"><button type="button" title="管理研究范围" onClick={onManageWatchlist}><Layers />我的关注<ChevronDown /></button><span><Clock3 />{dataDateLabel ?? '数据日期待核验'}</span><button type="button" className="hd-dock-collapse" title={collapsed ? '展开输入框' : '收起输入框'} aria-label={collapsed ? '展开输入框' : '收起输入框'} aria-expanded={!collapsed} onClick={() => setCollapsed(current => !current)}><ChevronDown /></button></div></>}
      <div className={approved ? "hd-stock-dock-fold" : undefined} aria-hidden={approved && collapsed || undefined}><div>
      {approved && <div className="hd-stock-source"><span>{assistantStatus}</span><small>A 股研究</small></div>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="mt-2.5 flex min-h-[52px] items-end gap-2 rounded-[14px] bg-[#FFF7FA] px-3 py-2 shadow-[inset_0_-2px_0_#E8C8F5] transition-colors focus-within:bg-white motion-reduce:transition-none sm:mt-3 sm:min-h-[60px] sm:py-2.5"
      >
        {approved ? <textarea value={value} onChange={event => onValueChange(event.target.value)} aria-label="交代股市研究任务" placeholder={placeholder} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!submitDisabled) onSubmit(); } }} /> : <input value={value} onChange={event => onValueChange(event.target.value)} aria-label="交代股市研究任务" placeholder={placeholder} className="min-w-0 flex-1 self-stretch bg-transparent text-[14px] font-medium leading-6 text-[#332842] outline-none placeholder:text-[#968C9D] sm:text-[16px]" />}
        {approved && <div className="hd-stock-editor-tools"><span>Enter 发送</span><button type="button" title={expanded ? '收起编辑' : '展开编辑'} aria-label={expanded ? '收起编辑' : '展开编辑'} aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? <Minimize2 /> : <Maximize2 />}</button></div>}
        <button
          type="submit"
          disabled={submitDisabled}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D95F83] text-white shadow-[0_8px_20px_rgba(217,95,131,0.2)] transition hover:bg-[#C9184A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0061]/30 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          aria-label="提交股市任务"
          title="交给 Holaday AI 研究"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            approved ? <ArrowUp className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />
          )}
        </button>
      </form>

      <div
        role="group"
        aria-label="AI 研究建议"
        className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 sm:mt-3 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-4"
      >
        {commands.map((command, index) => {
          const Icon = COMMAND_ICONS[index] ?? Sparkles;
          return (
            <button
              key={command}
              type="button"
              disabled={isCommandDisabled(command)}
              aria-label={command}
              title={commandTitle(command) ?? command}
              onClick={() => onCommand(command)}
              className={cn(
                'flex min-h-11 min-w-[132px] items-center gap-2 rounded-[11px] border border-[#E5DEEB] bg-[#FCFAFF] px-2.5 text-left text-[11px] font-medium leading-4 text-[#5D5368] transition hover:border-[#E7BEC9] hover:bg-[#FFF0F4] hover:text-[#C9184A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0061]/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none sm:min-w-0',
                index === 0 && 'border-[#F0D1DA] bg-[#FFF7F9] text-[#9F3153]',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-[#C95E7E]" aria-hidden />
              <span className="min-w-0">{commandDisplayLabel(command, index)}</span>
            </button>
          );
        })}
      </div>
      </div></div>
    </section>
  );
}

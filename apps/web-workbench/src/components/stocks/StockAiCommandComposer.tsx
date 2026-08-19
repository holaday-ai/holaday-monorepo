import {
  Circle,
  ClipboardList,
  Loader2,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const COMMAND_ICONS: readonly LucideIcon[] = [ClipboardList, ShieldCheck, TrendingUp, Scale];

function commandDisplayLabel(command: string, index: number): string {
  if (index === 0) {
    if (command.includes('等待')) return command;
    if (command.includes('历史') || command.includes('回看')) return '整理历史重点';
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
}: {
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
  return (
    <section
      aria-label="Holaday AI 股市研究助手"
      className="overflow-hidden rounded-[18px] border border-[#E9E0EC] bg-[#FFFCFB] p-3 shadow-[0_14px_36px_rgba(102,74,119,0.055)] sm:p-4"
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FFF0F4] text-[#C9184A]">
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="mt-3 flex min-h-[60px] items-end gap-2 rounded-[14px] bg-[#FFF7FA] px-3 py-2.5 shadow-[inset_0_-2px_0_#E8C8F5] transition-colors focus-within:bg-white motion-reduce:transition-none"
      >
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-label="交代股市研究任务"
          placeholder={placeholder}
          className="min-w-0 flex-1 self-stretch bg-transparent text-[16px] font-medium leading-6 text-[#332842] outline-none placeholder:text-[#968C9D]"
        />
        <button
          type="submit"
          disabled={submitDisabled}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D95F83] text-white shadow-[0_8px_20px_rgba(217,95,131,0.2)] transition hover:bg-[#C9184A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/30 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          aria-label="提交股市任务"
          title="交给 Holaday AI 研究"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
        </button>
      </form>

      <div role="group" aria-label="AI 研究建议" className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
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
                'flex min-h-10 min-w-0 items-center gap-2 rounded-[11px] border border-[#E5DEEB] bg-[#FCFAFF] px-2.5 text-left text-[11px] font-medium leading-4 text-[#5D5368] transition hover:border-[#E7BEC9] hover:bg-[#FFF0F4] hover:text-[#C9184A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
                index === 0 && 'border-[#F0D1DA] bg-[#FFF7F9] text-[#9F3153]',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-[#C95E7E]" aria-hidden />
              <span className="min-w-0">{commandDisplayLabel(command, index)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

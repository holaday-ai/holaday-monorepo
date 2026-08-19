import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AlertTriangle, BellRing, CalendarClock, Check, Loader2, ShieldCheck } from 'lucide-react';

export function StockRiskMonitorSheet({
  open,
  stock,
  dataAsOf,
  pending,
  error,
  restoreFocus,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  stock: { symbol: string; name: string } | null;
  dataAsOf: string | null;
  pending: boolean;
  error: string | null;
  restoreFocus?: HTMLButtonElement | null;
  onOpenChange(open: boolean): void;
  onConfirm(): Promise<void> | void;
}): JSX.Element {
  const name = stock?.name ?? '这只股票';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full max-w-[430px] flex-col bg-white p-0 motion-reduce:transition-none sm:max-w-[430px]"
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) return;
          event.preventDefault();
          restoreFocus.focus();
        }}
      >
        <SheetHeader className="border-b border-[#ECEEF3] px-5 py-5 pr-12 text-left">
          <div className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#FFF1F4] text-[#C72654]">
            <ShieldCheck className="h-4.5 w-4.5" aria-hidden />
          </div>
          <SheetTitle className="text-[17px] tracking-[-0.01em] text-[#121826]">
            持续监控{name}风险
          </SheetTitle>
          <SheetDescription className="text-[12px] leading-5 text-[#667085]">
            {stock?.symbol ?? '代码待确认'} · 当前可信数据日期 {dataAsOf ?? '待核验'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          <MonitorFact
            icon={<Check className="h-4 w-4" aria-hidden />}
            title="固定检查规则"
            body="质押、商誉、业绩预告、董监高变动、公告风险"
          />
          <MonitorFact
            icon={<CalendarClock className="h-4 w-4" aria-hidden />}
            title="执行时间"
            body="每天 16:30 · Asia/Shanghai"
            note="非交易日或没有新交易日快照时自动跳过"
          />
          <MonitorFact
            icon={<BellRing className="h-4 w-4" aria-hidden />}
            title="提醒边界"
            body="仅在风险新增、升级、解除或无法判断时提醒"
            note="无变化不打扰；首期只发送 HOLA DAY 站内通知"
          />
          <div className="flex gap-2.5 rounded-[9px] border border-[#F0D9B5] bg-[#FFFBF3] px-3.5 py-3 text-[11px] leading-[18px] text-[#80551E]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>监控基于确定性规则和可信快照，不构成投资建议、买卖建议或收益预测。</span>
          </div>
          {error ? (
            <div className="rounded-[9px] border border-[#F4B8C5] bg-[#FFF6F8] px-3.5 py-3 text-[11px] leading-[18px] text-[#A12A4C]" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#ECEEF3] px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[#DADDE4] bg-white px-4 text-[12px] font-semibold text-[#4F5868] hover:bg-[#F8F9FB] disabled:opacity-50 sm:h-9"
          >
            暂不监控
          </button>
          <button
            type="button"
            disabled={pending || !stock}
            onClick={() => void onConfirm()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] bg-[#EA1F59] px-4 text-[12px] font-semibold text-white shadow-[0_5px_14px_rgba(234,31,89,0.18)] hover:bg-[#D91B51] disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {pending ? '正在建立监控' : '确认开始监控'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MonitorFact({
  icon,
  title,
  body,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  note?: string;
}): JSX.Element {
  return (
    <div className="flex gap-3 rounded-[9px] border border-[#E6E8ED] bg-[#FCFCFD] px-3.5 py-3.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white text-[#6B4AA0] shadow-[0_2px_8px_rgba(27,31,43,0.06)]">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-[#667085]">{title}</div>
        <div className="mt-1 text-[12px] font-semibold leading-5 text-[#1F2937]">{body}</div>
        {note ? <div className="mt-0.5 text-[11px] leading-[18px] text-[#8B92A1]">{note}</div> : null}
      </div>
    </div>
  );
}

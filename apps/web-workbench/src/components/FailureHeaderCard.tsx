import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { classifyFriendlyFailure, friendlyFailureDetail } from '@/lib/failure-copy';
import { type RefundStatusCopy } from '@/lib/task-failure-recovery';
import { cn } from '@/lib/utils';
import type { UiTask } from '@/types/task';

/**
 * Failure / cancellation header at the top of a terminal result card.
 * Shows the humanised reason, the refund status from the platform-failure
 * ledger (batch 03 `quota_refunds`), and a one-click retry that resends
 * the original intent + attachments.
 */
export function FailureHeaderCard({
  status,
  errorText,
  onRetry,
  retrying = false,
  refund = null,
  attachmentNote = null,
}: {
  status: UiTask['status'];
  errorText: string;
  onRetry?: () => void;
  retrying?: boolean;
  refund?: RefundStatusCopy | null;
  attachmentNote?: string | null;
}): JSX.Element {
  const cancelled = status === 'cancelled';
  const friendly = cancelled
    ? {
        title: '已取消',
        subtitle: '任务已取消。下方保留了已生成的部分内容。',
        nextStep: '需要继续时可以重新执行这个任务。',
      }
    : classifyFriendlyFailure(errorText);
  const hasTechnical = !cancelled && errorText.trim().length > 0;
  const detailText = friendlyFailureDetail(errorText);
  const [showTechnical, setShowTechnical] = React.useState(false);
  return (
    <div
      className={cn(
        'mb-3 rounded-md border px-3 py-2 text-sm',
        cancelled
          ? 'border-[#DCDDDD] bg-[#EFEFEF]/45 text-muted-foreground dark:border-white/10 dark:bg-white/5'
          : 'border-[#EA1F59]/35 bg-[#EA1F59]/5 text-[#595757] dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10 dark:text-foreground',
      )}
      role="alert"
    >
      <div className="font-medium">{friendly.title}</div>
      <div className="mt-0.5 text-xs opacity-80">{friendly.subtitle}</div>
      {refund && (
        <div
          data-testid="failure-refund-status"
          data-tone={refund.tone}
          className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-5"
        >
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 font-medium',
              refund.tone === 'positive'
                ? 'border-[#1A9A66]/30 bg-[#1A9A66]/10 text-[#1A7A54] dark:text-[#6FD3A6]'
                : refund.tone === 'pending'
                  ? 'border-[#57479C]/30 bg-[#57479C]/10 text-[#57479C] dark:text-[#B9AEF0]'
                  : 'border-[#DCDDDD] bg-white/70 text-[#595757] dark:border-white/10 dark:bg-white/5 dark:text-foreground/80',
            )}
          >
            {refund.label}
          </span>
          <span className="text-[#595757]/75 dark:text-foreground/70">{refund.detail}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="min-w-[180px] flex-1 text-[11px] leading-5 text-[#595757]/75 dark:text-foreground/70">
          {friendly.nextStep}
          {onRetry && attachmentNote ? (
            <span data-testid="failure-retry-attachments" className="block">
              {attachmentNote}
            </span>
          ) : null}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            aria-label={retrying ? '正在重新执行任务' : '重新执行任务'}
            title={retrying ? '正在重新执行' : '重新执行任务'}
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#EA1F59]/25 bg-white px-3 text-[11px] font-medium text-[#EA1F59] transition-colors hover:border-[#EA1F59]/45 hover:bg-[#EA1F59]/5 disabled:cursor-wait disabled:opacity-60 dark:border-[#EA1F59]/35 dark:bg-transparent dark:text-foreground dark:hover:bg-[#EA1F59]/10"
          >
            <RotateCcw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} aria-hidden />
            <span>{retrying ? '重新执行中…' : '重新执行'}</span>
          </button>
        )}
      </div>
      {hasTechnical && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowTechnical((v) => !v)}
            aria-expanded={showTechnical}
            aria-label={showTechnical ? '收起失败详情' : '查看失败详情'}
            title={showTechnical ? '收起失败详情' : '查看失败详情'}
            className="inline-flex h-8 items-center gap-1 rounded-[6px] px-2 text-[11px] font-medium text-[#595757] transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
          >
            {showTechnical ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
            <span>详情</span>
          </button>
          {showTechnical && (
            <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-white/70 px-2 py-1.5 text-[11px] font-mono leading-relaxed text-[#595757] dark:bg-white/10 dark:text-foreground">
              {detailText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

import { AlertTriangle, Check, CircleSlash, Loader2, X } from 'lucide-react';
import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  externalLinkConfirmDescription,
  safeExternalHttpHref,
} from '@/lib/external-link-copy';
import { cn } from '@/lib/utils';
import type { UiStep } from '@/types/task';

interface Props {
  step: UiStep;
  /**
   * Position within the detail list. When true, we draw the connector
   * line above the badge; when `isLast`, we omit the line below. Used
   * so the detail panel reads like a timeline instead of a stack of
   * disconnected cards.
   */
  isFirst?: boolean;
  isLast?: boolean;
}

/**
 * One step card in the task stream. The left badge swaps on status:
 *   - running: blue-pulsed badge (no icon yet)
 *   - done:    cyan badge with a check
 *   - failed:  red badge with an x
 *   - cancelled: muted badge with a slash
 *
 * The action row below the title is the human-readable summary
 * (pre-derived on the orchestrator). Errors reveal a secondary line
 * for the driver message if present.
 */
export function StepCard({ step, isFirst, isLast }: Props): JSX.Element {
  const title = stepTitle(step);
  const antiBotHigh = step.antiBot?.confidence === 'high';
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const markdownComponents = React.useMemo(
    () => makeStepMarkdownComponents(setPendingHref),
    [],
  );
  return (
    <div className="relative flex animate-fade-in items-start gap-3">
      {/* Timeline rail — a 2px line centered behind the badge. */}
      {!isFirst && (
        <span
          aria-hidden
          className="absolute left-3 top-0 h-3 w-px -translate-x-1/2 bg-border"
        />
      )}
      {!isLast && (
        <span
          aria-hidden
          className={cn(
            'absolute left-3 top-6 bottom-0 w-px -translate-x-1/2',
            step.status === 'running' ? 'bg-primary/70 animate-pulse-dot' : 'bg-border',
          )}
        />
      )}
      <StatusBadge step={step} />
      <div
        className={cn(
          'min-w-0 flex-1 rounded-lg border px-4 py-3 shadow-[0_1px_3px_rgba(17,24,39,0.04)] transition-colors',
          antiBotHigh
            ? 'border-[#FFC910]/60 bg-[#FFC910]/10 dark:border-[#FFC910]/40 dark:bg-[#FFC910]/10'
            : 'border-[#DCDDDD] bg-white/90 dark:border-white/10 dark:bg-card/80',
          step.status === 'running' && 'border-[#EA1F59]/35 ring-1 ring-[#EA1F59]/15',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {step.status === 'running' && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            )}
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
          </div>
          <div className="shrink-0 text-xs text-muted-foreground">
            {step.durationMs != null ? formatDuration(step.durationMs) : '…'}
          </div>
        </div>
        {step.actionSummary && (
          // QA #14 — actionSummary may contain markdown (the agent's
          // self-narrated step description occasionally has **bold**
          // emphasis, inline code, or short links). Render through
          // ReactMarkdown so those don't surface as raw asterisks /
          // backticks. Keep the muted padded box; drop the prior
          // font-mono since markdown body text reads better in the
          // default sans stack. The typography overrides keep
          // paragraphs flush with the box and the lists / code spans
          // tight. Links are confirmed before leaving the workbench.
          <div className="prose prose-sm prose-neutral mt-1.5 max-w-none rounded-md bg-[#EFEFEF]/60 px-3 py-2 leading-relaxed text-foreground/80 prose-p:my-0 prose-p:text-xs prose-strong:font-semibold prose-strong:text-foreground prose-code:rounded prose-code:bg-white/80 prose-code:px-1 prose-code:text-[11px] dark:prose-invert dark:bg-white/5 dark:prose-code:bg-white/10">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {step.actionSummary}
            </ReactMarkdown>
            {step.status === 'running' && <Cursor />}
          </div>
        )}
        {step.antiBot && <AntiBotNotice step={step} />}
        {step.status === 'failed' && step.message && !step.antiBot && (
          <div className="mt-1.5 text-xs text-[#EA1F59]">{step.message}</div>
        )}
        <ConfirmDialog
          open={pendingHref !== null}
          title="即将打开外部链接"
          description={
            pendingHref ? externalLinkConfirmDescription(pendingHref) : undefined
          }
          confirmLabel="打开"
          cancelLabel="取消"
          onClose={() => setPendingHref(null)}
          onConfirm={() => {
            const href = pendingHref;
            setPendingHref(null);
            if (href) window.open(href, '_blank', 'noopener,noreferrer');
          }}
        />
      </div>
    </div>
  );
}

function makeStepMarkdownComponents(
  setPendingHref: React.Dispatch<React.SetStateAction<string | null>>,
): Components {
  return {
    a: ({ href, children, ...rest }) => {
      const safeHref = safeExternalHttpHref(href);
      if (!safeHref) return <span {...rest}>{children}</span>;
      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            setPendingHref(safeHref);
          }}
          {...rest}
        >
          {children}
        </a>
      );
    },
  };
}

function AntiBotNotice({ step }: { step: UiStep }): JSX.Element {
  const signal = step.antiBot;
  if (!signal) return <></>;
  return (
    <div
      className={cn(
        'mt-1.5 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        signal.confidence === 'high'
          ? 'border-[#FFC910]/55 bg-[#FFC910]/10 text-[#595757] dark:border-[#FFC910]/35 dark:text-foreground'
          : 'border-[#DCDDDD] bg-[#EFEFEF]/55 text-muted-foreground dark:border-white/10 dark:bg-white/5',
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{signal.message}</div>
        <div className="mt-0.5 text-[11px] opacity-80">
          目标网站检测到自动化操作，可能需要人工验证。匹配：
          <code className="font-mono">{signal.confidence}</code>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ step }: { step: UiStep }): JSX.Element {
  return (
    <div
      className={cn(
        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
        step.status === 'running' && 'animate-pulse-dot bg-[#EA1F59]',
        step.status === 'done' && 'bg-[#42C0EF]',
        step.status === 'failed' && 'bg-[#EA1F59]',
        step.status === 'cancelled' && 'bg-muted-foreground/50 text-background',
      )}
      aria-label={`步骤 ${step.tickIndex + 1} · ${step.status}`}
    >
      {step.status === 'done' ? (
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      ) : step.status === 'failed' ? (
        <X className="h-3.5 w-3.5" strokeWidth={3} />
      ) : step.status === 'cancelled' ? (
        <CircleSlash className="h-3.5 w-3.5" strokeWidth={2.5} />
      ) : (
        <span>{step.tickIndex + 1}</span>
      )}
    </div>
  );
}

function Cursor(): JSX.Element {
  return (
    <span
      aria-hidden
      className="ml-1 inline-block h-3 w-[2px] animate-pulse-dot bg-current align-middle"
    />
  );
}

function stepTitle(step: UiStep): string {
  if (!step.actionKind) return `步骤 ${step.tickIndex + 1}`;
  switch (step.actionKind) {
    case 'click':
    case 'click_ref':
      return '点击元素';
    case 'type':
    case 'type_in_ref':
      return '输入文本';
    case 'key':
    case 'press_key':
      return '按键';
    case 'scroll':
      return '滚动页面';
    case 'wait':
      return '等待';
    case 'screenshot':
      return '截图';
    case 'navigate':
      return '跳转页面';
    case 'wait_for_human':
      return '等待人工验证';
    case 'done':
      return '任务完成';
    case 'give_up':
      return '放弃任务';
    default:
      return step.actionKind;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

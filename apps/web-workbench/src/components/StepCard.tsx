import { AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UiStep } from '@/types/task';

interface Props {
  step: UiStep;
}

/**
 * One step card in the task stream. The left badge swaps on status:
 *   - running: blue-pulsed badge (no icon yet)
 *   - done:    green badge with a check
 *   - failed:  red badge with an x
 *
 * The action row below the title is the human-readable summary
 * (pre-derived on the orchestrator). Errors reveal a secondary line
 * for the driver message if present.
 */
export function StepCard({ step }: Props): JSX.Element {
  const title = stepTitle(step);
  // High-confidence anti-bot signals get a warning treatment on the
  // card itself (orange border) so the row stands out in a long
  // stream. Medium-confidence matches keep the standard border and
  // surface via the inline AntiBotNotice below.
  const antiBotHigh = step.antiBot?.confidence === 'high';
  return (
    <div
      className={cn(
        'flex animate-fade-in items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
        antiBotHigh
          ? 'border-amber-300 bg-amber-50/70'
          : 'border-border/60 bg-white/60',
      )}
    >
      <StatusBadge step={step} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          <div className="shrink-0 text-xs text-muted-foreground">
            {step.durationMs != null ? formatDuration(step.durationMs) : '…'}
          </div>
        </div>
        {step.actionSummary && (
          <div className="mt-1.5 rounded-md bg-muted/60 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/80">
            {step.actionSummary}
            {step.status === 'running' && <Cursor />}
          </div>
        )}
        {step.antiBot && <AntiBotNotice step={step} />}
        {step.status === 'failed' && step.message && !step.antiBot && (
          <div className="mt-1.5 text-xs text-red-500">{step.message}</div>
        )}
      </div>
    </div>
  );
}

function AntiBotNotice({ step }: { step: UiStep }): JSX.Element {
  const signal = step.antiBot;
  if (!signal) return <></>;
  return (
    <div
      className={cn(
        'mt-1.5 flex items-start gap-2 rounded-md px-3 py-2 text-xs',
        signal.confidence === 'high'
          ? 'bg-amber-100/80 text-amber-900'
          : 'bg-muted/60 text-muted-foreground',
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
        step.status === 'running' && 'animate-pulse-dot bg-blue-500',
        step.status === 'done' && 'bg-emerald-500',
        step.status === 'failed' && 'bg-red-500',
      )}
      aria-label={`步骤 ${step.tickIndex + 1} · ${step.status}`}
    >
      {step.status === 'done' ? (
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      ) : step.status === 'failed' ? (
        <X className="h-3.5 w-3.5" strokeWidth={3} />
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

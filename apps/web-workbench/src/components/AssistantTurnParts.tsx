/**
 * FIX-57 — pieces of the conversational task turn (see lib/assistant-turn.ts):
 *   - LiveStatusLine: one moving line while the task runs; opens into the step timeline.
 *   - ProcessDisclosure: the quiet 「参考了 N 个来源 · 查看过程」 footer and what it opens.
 *   - TurnOptions / NextStepChips: light, clickable continuations (no boxes, no numbers).
 */
import {
  ELAPSED_AFTER_SECONDS,
  type NextStepOption,
  type TurnOption,
  elapsedLabel,
} from '@/lib/assistant-turn';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Pencil, RotateCcw } from 'lucide-react';
import * as React from 'react';

export interface TimelineLine {
  key: string;
  text: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
}

/** One live line: 「正在打开东方财富…」 + shimmer, elapsed time after 20 s, opens a timeline. */
export function LiveStatusLine({
  text,
  since,
  timeline,
  children,
}: {
  text: string;
  /** ms epoch the run started (for the elapsed time). */
  since: number;
  timeline: TimelineLine[];
  /** Extra detail shown when the line is opened (the step cards). */
  children?: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const canOpen = timeline.length > 0 || Boolean(children);
  return (
    <div data-testid="live-status-line" className="text-sm">
      <button
        type="button"
        onClick={() => canOpen && setOpen((v) => !v)}
        aria-expanded={canOpen ? open : undefined}
        aria-live="polite"
        className={cn(
          'group inline-flex max-w-full items-center gap-2 rounded-md py-1 text-left text-muted-foreground',
          canOpen ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
        )}
      >
        <span aria-hidden className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF0061]/40 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FF0061]" />
        </span>
        <span className="hd-status-shimmer min-w-0 truncate">{text}</span>
        {seconds > ELAPSED_AFTER_SECONDS && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {elapsedLabel(seconds)}
          </span>
        )}
        {canOpen &&
          (open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
          ) : (
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
              aria-hidden
            />
          ))}
      </button>
      {open && (
        <div className="mt-2 border-l border-[#DCDDDD] pl-4 dark:border-white/10">
          <Timeline lines={timeline} running />
          {children}
        </div>
      )}
    </div>
  );
}

export function Timeline({
  lines,
  running = false,
}: {
  lines: TimelineLine[];
  running?: boolean;
}): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <ol className="space-y-1.5" data-testid="process-timeline">
      {lines.map((line, i) => {
        const current = running && i === lines.length - 1 && line.status !== 'failed';
        return (
          <li key={line.key} className="flex items-start gap-2 text-[13px] leading-5">
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
              {current ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF0061] motion-reduce:animate-none" />
              ) : line.status === 'failed' ? (
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
              ) : (
                <Check className="h-3.5 w-3.5 text-[#42C0EF]" strokeWidth={3} aria-hidden />
              )}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1',
                current ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {line.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 「参考了 N 个来源 · 查看过程」, then everything behind it. */
export function ProcessDisclosure({
  label,
  actions,
  children,
}: {
  label: string;
  /** Hover-only icons on the right (copy, more). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-3" data-testid="process-disclosure">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground/80 transition-colors hover:text-foreground"
        >
          <span>{label}</span>
          {open ? (
            <ChevronDown className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden />
          )}
        </button>
        {actions && (
          <div className="flex items-center gap-0.5 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
            {actions}
          </div>
        )}
      </div>
      {open && (
        <div
          data-testid="process-panel"
          className="mt-2 space-y-4 border-l border-[#DCDDDD] pl-4 dark:border-white/10"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function ProcessSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      {children}
    </section>
  );
}

const CHIP =
  'inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#DCDDDD]/80 bg-white/60 px-3 py-1.5 text-left text-[13px] leading-5 text-[#595757] transition-colors hover:border-[#FF0061]/35 hover:bg-[#FF0061]/[0.04] hover:text-[#FF0061] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0061]/20 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-foreground/80 dark:hover:text-foreground';

/** The ways on after a failed / stopped run (first one fills the gap). */
export function TurnOptions({
  options,
  onRetry,
  retrying,
  onSend,
}: {
  options: TurnOption[];
  onRetry?: () => void;
  retrying?: boolean;
  onSend?: (prompt: string) => void;
}): JSX.Element | null {
  const usable = options.filter((o) => (o.kind === 'retry' ? Boolean(onRetry) : Boolean(onSend)));
  if (usable.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid="turn-options">
      {usable.map((option) => (
        <button
          key={`${option.kind}-${option.label}`}
          type="button"
          disabled={option.kind === 'retry' && retrying}
          onClick={() =>
            option.kind === 'retry' ? onRetry?.() : option.prompt && onSend?.(option.prompt)
          }
          className={CHIP}
        >
          {option.kind === 'retry' && (
            <RotateCcw className={cn('h-3.5 w-3.5 shrink-0', retrying && 'animate-spin')} />
          )}
          <span className="min-w-0">
            {option.kind === 'retry' && retrying ? '正在重新执行…' : option.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Predicted next steps: click sends; the pencil puts it in the composer to edit. */
export function NextStepChips({
  steps,
  onSend,
  onEdit,
}: {
  steps: NextStepOption[];
  onSend?: (prompt: string) => void;
  onEdit?: (prompt: string) => void;
}): JSX.Element | null {
  if (steps.length === 0 || (!onSend && !onEdit)) return null;
  return (
    <div className="mt-3 flex flex-col items-start gap-2" data-testid="next-step-chips">
      {steps.map((step) => (
        <div key={step.label} className="group/chip flex max-w-full items-center gap-1">
          <button
            type="button"
            onClick={() => (onSend ? onSend(step.prompt) : onEdit?.(step.prompt))}
            title={step.prompt}
            className={CHIP}
          >
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
            <span className="min-w-0">{step.label}</span>
          </button>
          {onSend && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(step.prompt)}
              aria-label={`改一改再发：${step.label}`}
              title="改一改再发"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 opacity-100 transition-opacity hover:bg-[#EFEFEF]/70 hover:text-foreground sm:opacity-0 sm:group-hover/chip:opacity-100 sm:focus-visible:opacity-100"
            >
              <Pencil className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

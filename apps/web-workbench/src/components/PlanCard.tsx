import { Check, ChevronDown, ChevronRight, ListChecks, Loader2, X } from 'lucide-react';
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  externalLinkConfirmDescription,
  safeExternalHttpHref,
} from '@/lib/external-link-copy';
import { planProgressSummary, type PlanStepState } from '@/lib/plan-card-state';
import { cn } from '@/lib/utils';

export interface PlanStepStatus {
  idx: number;
  status: PlanStepState;
  note?: string;
}

interface Props {
  /** Markdown body the planner emitted (full text as-is). */
  planText: string;
  /** Per-step status array, parallel to the bullet list count. */
  planStatus?: PlanStepStatus[];
  /**
   * Default expansion state. When the task is still in flight the
   * plan is the live "what's coming next" view and should stay open;
   * once a task lands in a terminal state the plan reads like a stale
   * step-by-step log on top of the result, so callers pass `false`
   * to fold it by default. The user can still expand to inspect.
   */
  defaultExpanded?: boolean;
}

/**
 * Phase 13 Dim 1 — pre-execution plan display.
 *
 * Shown above the live progress / step stream the moment the
 * orchestrator emits `server.task.plan`. The body is markdown (the
 * planner emits a numbered list; we render via ReactMarkdown for
 * consistency with TerminalSummary). Step-level state icons sit
 * inline next to each numbered bullet — `planStatus` array is
 * matched by 1-based step index (the planner emits "1. ..." / "2.
 * ..." prefixes).
 *
 * Style choice: muted neutral card with a faint left border. We
 * deliberately avoid blue/red primary accents here so the card
 * reads as "context, not active work" — the live ticker below
 * keeps its own colour cues for in-flight steps.
 */
export function PlanCard({
  planText,
  planStatus,
  defaultExpanded = true,
}: Props): JSX.Element {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  // Re-sync expansion when the caller's default flips — happens when
  // a task transitions in-flight → terminal, where we want the plan
  // to fold itself on first render of the terminal state. If the
  // user has already toggled it manually we still respect that:
  // the effect only runs when defaultExpanded actually changes.
  const lastDefault = React.useRef(defaultExpanded);
  React.useEffect(() => {
    if (lastDefault.current !== defaultExpanded) {
      setExpanded(defaultExpanded);
      lastDefault.current = defaultExpanded;
    }
  }, [defaultExpanded]);

  // Build a quick lookup so the markdown renderer can attach the
  // correct status icon to each numbered list item without reparsing
  // the bullet on every render.
  const statusByIdx = React.useMemo(() => {
    const map = new Map<number, PlanStepStatus>();
    for (const s of planStatus ?? []) map.set(s.idx, s);
    return map;
  }, [planStatus]);

  const progress = React.useMemo(
    () => planProgressSummary(planStatus ?? null),
    [planStatus],
  );

  return (
    <div className="rounded-[8px] border border-[#DCDDDD] bg-white px-5 py-4 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#DCDDDD] bg-white text-[#EA1F59]">
            <ListChecks className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">执行计划</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {progress.label}
            </span>
          </span>
        </span>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-[#DCDDDD] bg-white px-2.5 py-1 text-[11px] font-medium text-[#595757] transition-colors hover:border-[#ADADAD]">
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
      </button>
      {progress.total > 0 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#EFEFEF]">
          <div
            className={`h-full rounded-full transition-[width] ${planProgressFillTone(progress.tone)}`}
            style={{ width: `${progress.percent}%` }}
            aria-label={`${progress.percent}%`}
          />
        </div>
      )}
      {expanded && (
        <div className="prose prose-sm prose-neutral mt-3 max-w-none prose-ol:my-1 prose-li:my-0.5 dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              ol: ({ children }) => {
                return <PlanList statusByIdx={statusByIdx}>{children}</PlanList>;
              },
              a: ({ href, children, ...rest }) => {
                const safeHref = safeExternalHttpHref(href);
                if (!safeHref) {
                  return <span {...rest}>{children}</span>;
                }
                return (
                  <a
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      setPendingHref(safeHref);
                    }}
                    className="text-[#EA1F59] underline decoration-[#EA1F59]/35 underline-offset-2 hover:text-[#D91B51] dark:text-[#EA1F59]"
                    {...rest}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {planText}
          </ReactMarkdown>
        </div>
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
  );
}

/**
 * Custom OL renderer that prepends a status pill to each child <li>.
 * React's React.Children.map preserves the original order so the
 * idx-to-status mapping stays stable as items mount/unmount.
 */
function PlanList({
  children,
  statusByIdx,
}: {
  children: React.ReactNode;
  statusByIdx: Map<number, PlanStepStatus>;
}): JSX.Element {
  let itemIndex = 0;
  return (
    <ol className="list-none pl-0">
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        itemIndex += 1;
        const status = statusByIdx.get(itemIndex);
        return (
          <li key={itemIndex} className="flex items-start gap-2 py-0.5">
            <StatusPill state={status?.status ?? 'pending'} />
            <div className="min-w-0 flex-1">
              {(child as React.ReactElement).props.children}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StatusPill({
  state,
}: {
  state: PlanStepStatus['status'];
}): JSX.Element {
  const cls =
    'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]';
  if (state === 'done') {
    return (
      <span className={cn(cls, 'bg-[#42C0EF] text-white')} aria-label="done">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className={cn(cls, 'bg-[#EA1F59] text-white')} aria-label="failed">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'running') {
    return (
      <span className={cn(cls, 'animate-pulse-dot bg-[#EA1F59] text-white')} aria-label="running">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      </span>
    );
  }
  return (
    <span className={cn(cls, 'border border-[#DCDDDD] bg-[#EFEFEF]/50 text-muted-foreground')} aria-label="pending" />
  );
}

function planProgressFillTone(tone: 'idle' | 'running' | 'done' | 'failed'): string {
  if (tone === 'done') return 'bg-[#42C0EF]';
  if (tone === 'idle') return 'bg-[#ADADAD]';
  return 'bg-[#EA1F59]';
}

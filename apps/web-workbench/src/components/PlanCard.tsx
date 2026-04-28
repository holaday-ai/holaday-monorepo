import { Check, Loader2, X } from 'lucide-react';
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export interface PlanStepStatus {
  idx: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  note?: string;
}

interface Props {
  /** Markdown body the planner emitted (full text as-is). */
  planText: string;
  /** Per-step status array, parallel to the bullet list count. */
  planStatus?: PlanStepStatus[];
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
export function PlanCard({ planText, planStatus }: Props): JSX.Element {
  // Build a quick lookup so the markdown renderer can attach the
  // correct status icon to each numbered list item without reparsing
  // the bullet on every render.
  const statusByIdx = React.useMemo(() => {
    const map = new Map<number, PlanStepStatus>();
    for (const s of planStatus ?? []) map.set(s.idx, s);
    return map;
  }, [planStatus]);

  return (
    <div className="rounded-xl border border-border bg-card/60 px-5 py-4">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        执行计划
      </div>
      <div className="prose prose-sm prose-neutral max-w-none prose-ol:my-1 prose-li:my-0.5 dark:prose-invert">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Each <li> we render gets a status pill prepended. We
            // can't read the bullet's index from inside the LI
            // renderer cheaply, so we count via a closure +
            // useRef-style counter scoped per ReactMarkdown render.
            ol: ({ children }) => {
              return <PlanList statusByIdx={statusByIdx}>{children}</PlanList>;
            },
            // Re-anchor markdown links to open in a new tab so a
            // citation-rich plan doesn't yank the user out of the
            // workbench.
            a: ({ href, children, ...rest }) => (
              <a
                href={href ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800 dark:text-blue-400"
                {...rest}
              >
                {children}
              </a>
            ),
          }}
        >
          {planText}
        </ReactMarkdown>
      </div>
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
  return (
    <ol className="list-none pl-0">
      {React.Children.map(children, (child, idx) => {
        if (!React.isValidElement(child)) return child;
        const status = statusByIdx.get(idx);
        return (
          <li key={idx} className="flex items-start gap-2 py-0.5">
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
      <span className={cn(cls, 'bg-blue-500 text-white')} aria-label="done">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className={cn(cls, 'bg-red-500 text-white')} aria-label="failed">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'running') {
    return (
      <span className={cn(cls, 'bg-blue-500 text-white animate-pulse-dot')} aria-label="running">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      </span>
    );
  }
  return (
    <span className={cn(cls, 'border border-border bg-muted text-muted-foreground')} aria-label="pending" />
  );
}

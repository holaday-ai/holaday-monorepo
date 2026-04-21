import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  /** URL of the page the agent is currently driving. */
  currentUrl?: string;
  /** 'live' while a task is executing; 'idle' when nothing is happening. */
  status?: 'idle' | 'live' | 'error';
}

/**
 * 400px right rail with a collapse affordance. The collapse state is
 * purely local — BrowserPanel doesn't tell the layout its own width.
 * The parent renders two variants (`w-[400px]` vs `w-10`) based on
 * the `collapsed` state so tailwind generates both widths ahead of
 * time.
 */
export function BrowserPanel({ currentUrl, status = 'idle' }: Props): JSX.Element {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <section
      className={cn(
        'relative flex h-full shrink-0 flex-col border-l border-black/[0.06] backdrop-blur-xl transition-[width] duration-200',
        collapsed ? 'w-10' : 'w-[400px]',
      )}
      style={{ backgroundColor: 'rgba(255,255,255,0.7)' }}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? '展开浏览器' : '收起浏览器'}
        className="absolute left-0 top-3 h-6 w-6 -translate-x-1/2 rounded-full border border-black/[0.06] bg-white shadow-sm hover:bg-white"
      >
        {collapsed ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </Button>

      {collapsed ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="rotate-180 text-[11px] tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
            浏览器
          </div>
        </div>
      ) : (
        <>
          <header className="flex h-11 items-center gap-2 border-b border-black/[0.06] px-3">
            <StatusDot status={status} />
            <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {currentUrl ?? 'about:blank'}
            </div>
          </header>
          <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
            <div className="text-center text-xs text-muted-foreground">
              {status === 'live' ? '浏览器画面传输中…' : '等待任务开始...'}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function StatusDot({ status }: { status: 'idle' | 'live' | 'error' }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        status === 'idle' && 'bg-muted-foreground/40',
        status === 'live' && 'animate-pulse-dot bg-emerald-500',
        status === 'error' && 'bg-red-500',
      )}
    />
  );
}

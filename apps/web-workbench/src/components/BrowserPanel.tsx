import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UiScreencast, UiTaskStatus } from '@/types/task';

interface Props {
  /** Latest screencast frame for the selected task (if any). */
  frame?: UiScreencast | null;
  /** Selected task status — drives the status dot colour. */
  taskStatus?: UiTaskStatus | null;
}

/**
 * Right-hand screencast panel. Shows the newest JPEG the runner
 * produced for the active task, with URL + resolution + tick counter
 * chrome around it. Collapses to a thin vertical rail on demand.
 *
 * The runner ships maybe 1 frame every 2–5 s, so we don't get a true
 * screencast — it's a poor-man's "picture in picture" for the task's
 * tab. Good enough for PoC dogfooding; a real screencast would need
 * CDP `Page.startScreencast` wired through the SW.
 */
export function BrowserPanel({ frame, taskStatus }: Props): JSX.Element {
  const [collapsed, setCollapsed] = React.useState(false);
  const status: DotStatus = deriveDotStatus(taskStatus, Boolean(frame));

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
              {frame?.url ?? 'about:blank'}
            </div>
          </header>
          <div className="flex flex-1 items-center justify-center overflow-hidden bg-muted/40 p-3">
            {frame ? (
              <img
                src={`data:image/jpeg;base64,${frame.imageBase64}`}
                alt={`screencast tick ${frame.tickIndex + 1}`}
                className="max-h-full max-w-full rounded-md border border-black/[0.06] object-contain shadow-sm"
              />
            ) : (
              <div className="text-center text-xs text-muted-foreground">
                {taskStatus === 'executing' ? '等待第一帧…' : '等待任务开始...'}
              </div>
            )}
          </div>
          <footer className="flex h-7 items-center justify-between border-t border-black/[0.06] px-3 text-[11px] text-muted-foreground">
            <span>
              {frame ? `${frame.viewport.width}×${frame.viewport.height}` : '—'}
            </span>
            <span>{frame ? `第 ${frame.tickIndex + 1} 帧` : ''}</span>
          </footer>
        </>
      )}
    </section>
  );
}

type DotStatus = 'idle' | 'live' | 'error';

function deriveDotStatus(status: UiTaskStatus | null | undefined, hasFrame: boolean): DotStatus {
  if (status === 'failed') return 'error';
  if (status === 'executing' || hasFrame) return 'live';
  return 'idle';
}

function StatusDot({ status }: { status: DotStatus }): JSX.Element {
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

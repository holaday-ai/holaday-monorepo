import { ChevronLeft, ChevronRight, MousePointerClick, Power } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { send as wsSend } from '@/lib/ws';
import { cn } from '@/lib/utils';
import type { UiScreencast, UiTaskStatus } from '@/types/task';

interface Props {
  /** Latest screencast frame for the selected task (if any). */
  frame?: UiScreencast | null;
  /** Selected task status — drives the status dot colour. */
  taskStatus?: UiTaskStatus | null;
  /** Non-null when the orchestrator paused on a captcha signal. */
  awaitingUser?: boolean;
  /** Active task id — forwarded on user_input events so backend can correlate. */
  activeTaskId?: string | null;
}

/**
 * Right-hand screencast panel. Shows the newest JPEG the runner
 * produced for the active task, with URL + resolution + tick counter
 * chrome around it. Collapses to a thin vertical rail on demand.
 *
 * Interactive mode (toggle in header) forwards mouse + keyboard events
 * from the screencast image to PlaywrightExecutor via WS so users can
 * drive the browser directly — captcha solves, filling a field the
 * agent missed, or plain "I want to browse this site from HOLA DAY's
 * headless Chrome" free-drive.
 */
export function BrowserPanel({
  frame,
  taskStatus,
  awaitingUser,
  activeTaskId,
}: Props): JSX.Element {
  const [collapsed, setCollapsed] = React.useState(false);
  const [interactive, setInteractive] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const status: DotStatus = awaitingUser
    ? 'error'
    : deriveDotStatus(taskStatus, Boolean(frame));

  // Interactive mode only makes sense when there's a real frame. If the
  // tab is on about:blank there's nothing to click; silently clamp off
  // so the toggle doesn't "activate" on nothing.
  const interactiveActive = interactive && Boolean(frame) && !isBlankUrl(frame?.url);

  const sendInput = React.useCallback(
    (payload: Omit<UserInputEvent, 'type' | 'taskId'>) => {
      wsSend({
        type: 'client.vision.user_input',
        ...(activeTaskId ? { taskId: activeTaskId } : {}),
        ...payload,
      } as never);
    },
    [activeTaskId],
  );

  const mapToViewport = React.useCallback(
    (e: React.MouseEvent<HTMLImageElement>): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img || !frame) return null;
      // Rendered size on screen vs. true viewport pixels on the remote
      // page. The screencast JPEG is sized to the real viewport, so
      // scale back from the img.clientWidth/Height → frame.viewport.
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      return {
        x: Math.round(px * frame.viewport.width),
        y: Math.round(py * frame.viewport.height),
      };
    },
    [frame],
  );

  const onClick = React.useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!interactiveActive) return;
      const pt = mapToViewport(e);
      if (!pt) return;
      e.preventDefault();
      sendInput({ kind: 'click', x: pt.x, y: pt.y, button: 'left' });
    },
    [interactiveActive, mapToViewport, sendInput],
  );

  const onWheel = React.useCallback(
    (e: React.WheelEvent<HTMLImageElement>) => {
      if (!interactiveActive) return;
      e.preventDefault();
      // deltaMode=0 (pixel) is by far most common; if it's line/page
      // (1/2) we approximate with 24 px per line.
      const dy = e.deltaMode === 0 ? e.deltaY : e.deltaY * 24;
      sendInput({ kind: 'scroll', scrollDeltaY: Math.round(dy) });
    },
    [interactiveActive, sendInput],
  );

  // Global keyboard listener while interactive mode is on. We forward
  // printable chars as `type` and named keys (Enter / Tab / Backspace
  // / arrows / Escape) as `key`. Skip modifier-only chords to avoid
  // doubling browser shortcuts.
  React.useEffect(() => {
    if (!interactiveActive) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      // Don't steal typing when the user is in a normal input/textarea
      // elsewhere on the page.
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const named = NAMED_KEYS[ev.key];
      if (named) {
        ev.preventDefault();
        const chord = [
          ev.ctrlKey && 'ctrl',
          ev.metaKey && 'meta',
          ev.altKey && 'alt',
          ev.shiftKey && 'shift',
          named,
        ]
          .filter(Boolean)
          .join('+');
        sendInput({ kind: 'key', key: chord });
        return;
      }
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault();
        sendInput({ kind: 'type', text: ev.key });
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [interactiveActive, sendInput]);

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
            <button
              type="button"
              onClick={() => setInteractive((v) => !v)}
              title={interactive ? '退出交互模式' : '进入交互模式'}
              aria-label="toggle interactive mode"
              aria-pressed={interactive}
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors',
                interactive
                  ? 'border-sky-300 bg-sky-100 text-sky-700'
                  : 'border-transparent bg-transparent text-muted-foreground hover:bg-black/5',
              )}
            >
              {interactive ? (
                <MousePointerClick className="h-3.5 w-3.5" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
            </button>
          </header>
          {awaitingUser && (
            <div className="animate-pulse-dot border-b border-amber-300/60 bg-amber-100/80 px-3 py-1.5 text-center text-[11px] font-semibold text-amber-900">
              需要您操作 · 请在 Chrome 中完成验证
            </div>
          )}
          {interactiveActive && (
            <div className="border-b border-sky-300/60 bg-sky-50 px-3 py-1.5 text-center text-[11px] font-medium text-sky-800">
              交互模式 · 点击 / 滚动 / 键盘输入会转发到浏览器
            </div>
          )}
          <div
            className={cn(
              'flex flex-1 items-center justify-center overflow-hidden p-3',
              interactiveActive ? 'bg-sky-50/40' : 'bg-muted/40',
            )}
          >
            {frame ? (
              isBlankUrl(frame.url) ? (
                <div className="text-center text-xs text-muted-foreground/80">
                  等待浏览器加载页面...
                </div>
              ) : (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard capture is handled via window listener in interactive mode
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${frame.imageBase64}`}
                  alt={`screencast tick ${frame.tickIndex + 1}`}
                  onClick={onClick}
                  onWheel={onWheel}
                  draggable={false}
                  className={cn(
                    'max-h-full max-w-full rounded-md border object-contain shadow-sm',
                    interactiveActive
                      ? 'cursor-pointer border-sky-400 ring-2 ring-sky-300'
                      : 'border-black/[0.06]',
                  )}
                />
              )
            ) : (
              <div className="text-center text-xs text-muted-foreground">
                {taskStatus === 'executing' ? '等待第一帧…' : '等待任务开始...'}
              </div>
            )}
          </div>
          <footer className="flex h-7 items-center justify-between border-t border-black/[0.06] px-3 text-[11px] text-muted-foreground">
            <span>{frame ? `${frame.viewport.width}×${frame.viewport.height}` : '—'}</span>
            <span>{frame ? `第 ${frame.tickIndex + 1} 帧` : ''}</span>
          </footer>
        </>
      )}
    </section>
  );
}

export function isBlankUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const u = url.trim().toLowerCase();
  return u === 'about:blank' || u === '' || u === 'chrome://newtab/';
}

interface UserInputEvent {
  type: 'client.vision.user_input';
  taskId?: string;
  kind: 'click' | 'scroll' | 'type' | 'key';
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  scrollDeltaY?: number;
  button?: 'left' | 'right' | 'middle';
}

// Browser KeyboardEvent.key → Playwright canonical key name for the
// handful we actively translate. Everything else falls through to the
// `text` path as a literal char.
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Escape: 'Escape',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

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

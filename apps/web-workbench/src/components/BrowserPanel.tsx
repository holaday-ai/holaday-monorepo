import { ChevronLeft, ChevronRight, Globe, MousePointerClick, Power, Square } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { VncViewport, type VncStatus } from '@/components/VncViewport';
import { send as wsSend } from '@/lib/ws';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';
import type { UiScreencast, UiStep, UiTaskStatus } from '@/types/task';

/**
 * VNC bridge URL. Relative path lets the browser auto-resolve the
 * scheme (wss on HTTPS, ws on HTTP dev) and host. The nginx block on
 * production strips `/vnc/` and proxies to websockify on :6080. In
 * dev, vite's proxy can forward the same path if desired; absent a
 * proxy the component gracefully reports 'error' and we fall back to
 * the static JPEG screencast.
 *
 * `VITE_VNC_PATH` overrides the default for environments that can't
 * use the production proxy path (e.g. a secondary orchestrator). Set
 * to empty string to disable the VNC layer entirely and stick with
 * screencast-only rendering.
 */
const VNC_PATH = (import.meta.env.VITE_VNC_PATH as string | undefined) ?? '/vnc/websockify';
function buildVncUrl(): string | null {
  if (!VNC_PATH) return null;
  if (typeof window === 'undefined') return null;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${VNC_PATH}`;
}

interface Props {
  /** Latest screencast frame for the selected task (if any). */
  frame?: UiScreencast | null;
  /** Selected task status — drives the status dot colour. */
  taskStatus?: UiTaskStatus | null;
  /** Non-null when the orchestrator paused on a captcha signal. */
  awaitingUser?: boolean;
  /** Active task id — forwarded on user_input events so backend can correlate. */
  activeTaskId?: string | null;
  /**
   * Mobile/tablet layout mode. When `sheet`, the panel renders as a
   * bottom-sheet rather than a fixed right column, with a backdrop
   * + close handle. Default `rail` preserves the original desktop
   * three-column layout.
   */
  layout?: 'rail' | 'sheet';
  /** Sheet-only: whether the drawer is currently open. */
  open?: boolean;
  /** Sheet-only: close handler. */
  onClose?: () => void;
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
  layout = 'rail',
  open = true,
  onClose,
}: Props): JSX.Element | null {
  const [collapsed, setCollapsed] = React.useState(false);
  // Interactive mode is in the global store so the TaskStream's
  // "Continue in browser" button can flip it on from the left panel.
  const interactive = useTaskStore((s) => s.browserInteractive);
  const setInteractive = useTaskStore((s) => s.setBrowserInteractive);

  // When the selected task has no screencast of its own (e.g. a
  // pending task the user clicked into before it produced frames),
  // fall back to the most recently-updated frame from ANY task so
  // the URL header still reflects what the live VNC stream is
  // showing. Brave is a shared singleton, so whatever URL another
  // task left it on is also what's on screen right now.
  const screencastByTask = useTaskStore((s) => s.screencastByTask);
  const latestFrame = React.useMemo<UiScreencast | null>(() => {
    const all = Object.values(screencastByTask);
    if (all.length === 0) return null;
    // Latest by timestamp; string ISO compare is correct for
    // same-locale UTC ISO-8601.
    return all.reduce((best, cur) =>
      !best || cur.timestamp > best.timestamp ? cur : best,
    null as UiScreencast | null) ?? null;
  }, [screencastByTask]);
  const displayFrame = frame ?? latestFrame;
  const displayUrl = displayFrame?.url ?? 'about:blank';
  const abortTask = useTaskStore((s) => s.abortTask);
  const [aborting, setAborting] = React.useState(false);
  const isExecuting = taskStatus === 'executing';
  const onStopClick = React.useCallback(async () => {
    if (!activeTaskId || aborting) return;
    setAborting(true);
    try {
      await abortTask(activeTaskId);
    } finally {
      setAborting(false);
    }
  }, [activeTaskId, aborting, abortTask]);

  // VNC live stream — memoised so prop identity is stable across
  // re-renders (the viewport's effect re-runs on any URL change).
  const vncUrl = React.useMemo(() => buildVncUrl(), []);
  const [vncStatus, setVncStatus] = React.useState<VncStatus>('idle');
  const handleVncStatus = React.useCallback((status: VncStatus) => {
    setVncStatus(status);
  }, []);
  // Default to the VNC layer when we have a URL, and fall back to the
  // legacy JPEG screencast only when VNC actively errors. Idle /
  // connecting / connected / disconnected all stay on the VNC path;
  // the transient states overlay their own banners rather than
  // flipping the whole viewport. This keeps the mount stable so the
  // RFB instance stays alive across panel redraws instead of churning
  // a new WebSocket every tick.
  const useVnc = Boolean(vncUrl) && vncStatus !== 'error';

  // When the agent parks on awaiting-user (captcha, login wall, user
  // question the model injected), auto-flip the panel to interactive
  // mode — the user almost certainly needs to click into the browser
  // to unblock it. Only auto-enable; never auto-disable, so a user who
  // deliberately toggled off stays in view-only mode on their next
  // task's captcha. Trigger condition covers both rendering lanes:
  //   - VNC: live connection present.
  //   - JPEG fallback: a real frame (not about:blank).
  React.useEffect(() => {
    if (!awaitingUser || interactive) return;
    const hasLiveViewport = useVnc
      ? vncStatus === 'connected' || vncStatus === 'connecting'
      : Boolean(frame) && !isBlankUrl(frame?.url);
    if (hasLiveViewport) setInteractive(true);
  }, [awaitingUser, interactive, useVnc, vncStatus, frame, setInteractive]);
  // Recent steps for the in-panel activity overlay. Select WITHOUT a
  // fresh-array fallback — zustand treats each new `[]` as a changed
  // snapshot and infinite-loops the component (getSnapshot cache warn,
  // then React unmounts the tree → white screen). Instead, keep the
  // possibly-undefined value and default inside the memo so the
  // selector return is referentially stable per render.
  const steps = useTaskStore((s) =>
    activeTaskId ? s.stepsByTask[activeTaskId] : undefined,
  );
  const recentSteps = React.useMemo(
    () =>
      (steps ?? EMPTY_STEPS)
        .filter((s) => !TERMINAL_KINDS.has(s.actionKind ?? ''))
        .slice(-3),
    [steps],
  );
  const [activityVisible, setActivityVisible] = React.useState(true);
  // Click-ripple visualisation on the screencast image. When the
  // agent (or the user in interactive mode) clicks, we animate a red
  // dot at the mapped coordinates for ~600ms so viewers can trace the
  // action.
  const [ripple, setRipple] = React.useState<{ x: number; y: number; id: number } | null>(null);
  const rippleIdRef = React.useRef(0);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const status: DotStatus = awaitingUser
    ? 'error'
    : deriveDotStatus(taskStatus, Boolean(frame));

  // Interactive mode only makes sense when there's something to drive.
  // VNC lane: the RFB canvas always has content once connected, so
  // `interactive` alone is the gate. JPEG fallback lane: needs a real
  // frame, otherwise there's nothing to map clicks against.
  const interactiveActive = useVnc
    ? interactive && (vncStatus === 'connected' || vncStatus === 'connecting')
    : interactive && Boolean(frame) && !isBlankUrl(frame?.url);

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

  const flashRipple = React.useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const id = ++rippleIdRef.current;
    setRipple({ x: clientX - rect.left, y: clientY - rect.top, id });
    setTimeout(() => {
      setRipple((r) => (r?.id === id ? null : r));
    }, 600);
  }, []);

  const onClick = React.useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!interactiveActive) return;
      const pt = mapToViewport(e);
      if (!pt) return;
      e.preventDefault();
      flashRipple(e.clientX, e.clientY);
      sendInput({ kind: 'click', x: pt.x, y: pt.y, button: 'left' });
    },
    [interactiveActive, mapToViewport, sendInput, flashRipple],
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

  if (layout === 'sheet' && !open) return null;

  const isSheet = layout === 'sheet';
  const section = (
    <section
      className={cn(
        'relative flex flex-col border-l border-border backdrop-blur-xl',
        isSheet
          ? 'fixed inset-x-0 bottom-0 z-[75] h-[75vh] rounded-t-xl border-t border-l-0 shadow-2xl animate-fade-in'
          : 'h-full transition-[width] duration-150',
        // Desktop: fill the parent wrapper (App owns the flex-basis /
        // resize logic). The collapsed rail stays a local state the
        // wrapper's flex-basis doesn't fight — just w-10 overrides.
        !isSheet && (collapsed ? 'w-10 shrink-0' : 'h-full w-full'),
      )}
      style={{ backgroundColor: 'hsl(var(--card))' }}
    >
      {!isSheet && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? '展开浏览器' : '收起浏览器'}
          className="absolute left-0 top-3 h-6 w-6 -translate-x-1/2 rounded-full border border-border bg-card shadow-sm"
        >
          {collapsed ? (
            <ChevronLeft className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
      {isSheet && (
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭浏览器抽屉"
          className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30"
        />
      )}

      {!isSheet && collapsed ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="rotate-180 text-[11px] tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
            浏览器
          </div>
        </div>
      ) : (
        <>
          <header className="flex h-11 items-center gap-2 border-b border-border px-3 pt-2">
            <StatusDot status={status} />
            <div
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              title={displayUrl}
            >
              {displayUrl}
            </div>
            {isExecuting && activeTaskId && (
              <button
                type="button"
                onClick={onStopClick}
                disabled={aborting}
                title="停止当前任务"
                aria-label="停止当前任务"
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors',
                  aborting
                    ? 'cursor-wait border-border bg-muted text-muted-foreground'
                    : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
                )}
              >
                <Square className="h-3 w-3" strokeWidth={2.5} />
                停止
              </button>
            )}
            <button
              type="button"
              onClick={() => setInteractive(!interactive)}
              title={
                interactive
                  ? '退出交互模式'
                  : '开启交互模式 — 直接在这个浏览器里点击、滚动、输入'
              }
              aria-label="toggle interactive mode"
              aria-pressed={interactive}
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors',
                interactive
                  ? 'border-sky-300 bg-sky-100 text-sky-700'
                  : 'border-transparent bg-transparent text-muted-foreground hover:bg-foreground/5',
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
            {useVnc ? (
              <div className="relative h-full w-full">
                <VncViewport
                  wsUrl={vncUrl}
                  viewOnly={!interactiveActive}
                  onStatusChange={handleVncStatus}
                  className={cn(
                    'rounded-md border shadow-sm',
                    interactiveActive
                      ? 'border-sky-400 ring-2 ring-sky-300'
                      : 'border-black/[0.06]',
                  )}
                />
                {(vncStatus === 'idle' || vncStatus === 'connecting') && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/30 text-xs text-muted-foreground">
                    连接实时画面…
                  </div>
                )}
                {vncStatus === 'disconnected' && (
                  <div className="pointer-events-none absolute right-2 top-2 rounded bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                    画面已断开，重连中
                  </div>
                )}
                {activityVisible && recentSteps.length > 0 && (
                  <ActivityOverlay
                    steps={recentSteps}
                    onClose={() => setActivityVisible(false)}
                  />
                )}
                {!activityVisible && recentSteps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActivityVisible(true)}
                    className="absolute bottom-2 right-2 rounded bg-black/40 px-2 py-1 text-[10px] text-white backdrop-blur hover:bg-black/60"
                  >
                    显示操作日志
                  </button>
                )}
              </div>
            ) : frame ? (
              isBlankUrl(frame.url) ? (
                <div className="text-center text-xs text-muted-foreground/80">
                  等待浏览器加载页面...
                </div>
              ) : (
                <div className="relative">
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard capture is handled via window listener in interactive mode */}
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
                  {ripple && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/70 animate-click-pulse"
                      style={{ left: ripple.x, top: ripple.y }}
                    />
                  )}
                  {activityVisible && recentSteps.length > 0 && (
                    <ActivityOverlay
                      steps={recentSteps}
                      onClose={() => setActivityVisible(false)}
                    />
                  )}
                  {!activityVisible && recentSteps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActivityVisible(true)}
                      className="absolute bottom-2 right-2 rounded bg-black/40 px-2 py-1 text-[10px] text-white backdrop-blur hover:bg-black/60"
                    >
                      显示操作日志
                    </button>
                  )}
                </div>
              )
            ) : (
              <EmptyBrowserState taskStatus={taskStatus} />
            )}
          </div>
          <footer className="flex h-7 items-center justify-between border-t border-border px-3 text-[11px] text-muted-foreground">
            <span>{frame ? `${frame.viewport.width}×${frame.viewport.height}` : '—'}</span>
            <span>{frame ? `第 ${frame.tickIndex + 1} 帧` : ''}</span>
          </footer>
        </>
      )}
    </section>
  );
  if (isSheet) {
    return (
      <>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭浏览器抽屉"
          className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-sm animate-fade-in"
        />
        {section}
      </>
    );
  }
  return section;
}

/**
 * Floating activity overlay on the bottom of the screencast image.
 * Shows up to 3 most-recent non-terminal actions so users can see the
 * agent narrate its work without reading the left-panel step stream.
 */
function ActivityOverlay({
  steps,
  onClose,
}: {
  steps: UiStep[];
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-black/55 px-3 py-2 text-[11px] text-white backdrop-blur-md">
      <div className="pointer-events-auto mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-white/70">
        <span>最近操作</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1 hover:bg-white/10"
          aria-label="收起操作日志"
        >
          收起
        </button>
      </div>
      <ul className="space-y-0.5 font-mono leading-snug">
        {steps.map((s) => (
          <li key={s.tickIndex} className="flex items-start gap-1.5">
            <span className="shrink-0 text-white/50">{activityGlyph(s.actionKind)}</span>
            <span className="min-w-0 flex-1 truncate">{summariseAction(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyBrowserState({
  taskStatus,
}: {
  taskStatus: UiTaskStatus | null | undefined;
}): JSX.Element {
  if (taskStatus === 'executing') {
    return <div className="text-center text-xs text-muted-foreground">等待第一帧…</div>;
  }
  return (
    <div className="flex flex-col items-center px-6 text-center text-muted-foreground">
      <Globe className="h-10 w-10 text-muted-foreground/40" aria-hidden />
      <div className="mt-3 text-sm font-medium text-foreground/80">浏览器将在这里显示</div>
      <div className="mt-1 text-xs leading-relaxed">
        创建一个任务后，HOLA DAY 的浏览器画面会实时出现在这里，
        <br />
        你可以观察或亲自接管。
      </div>
    </div>
  );
}

function activityGlyph(kind?: string): string {
  switch (kind) {
    case 'click':
    case 'click_ref':
      return '🖱';
    case 'type':
    case 'type_in_ref':
      return '⌨️';
    case 'key':
    case 'press_key':
      return '⏎';
    case 'scroll':
      return '↕';
    case 'navigate':
      return '→';
    case 'wait':
      return '⏳';
    case 'wait_for_human':
      return '🧑';
    default:
      return '•';
  }
}

function summariseAction(step: UiStep): string {
  return step.actionSummary || step.actionKind || `步骤 ${step.tickIndex + 1}`;
}

const TERMINAL_KINDS: ReadonlySet<string> = new Set(['done', 'give_up', 'screenshot']);

// Module-level stable empty array so zustand selectors that fall back
// to "no steps yet" return the SAME reference on every render — a new
// `[]` literal breaks getSnapshot's structural-equality check.
const EMPTY_STEPS: UiStep[] = [];

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
        status === 'live' && 'animate-pulse-dot bg-blue-500',
        status === 'error' && 'bg-red-500',
      )}
    />
  );
}

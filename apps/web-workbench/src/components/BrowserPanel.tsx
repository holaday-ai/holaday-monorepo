import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Hand,
  Keyboard,
  LockKeyhole,
  ListChecks,
  Maximize2,
  Minimize2,
  MousePointerClick,
  RotateCw,
  Square,
  X,
} from 'lucide-react';
import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  browserLiveOverlayCopy,
  browserReconnectAffordanceDelay,
  browserControlAction,
  browserInputFallbackMode,
  browserStartupTargetUrl,
  browserWorkspaceTaskIntent,
  browserFrameCanPanInPortraitSheet,
  browserPanelEvidenceHeaderStatus,
  browserPanelHeaderStatus,
  type BrowserPanelHeaderStatus,
  type BrowserControlAction,
  browserPanelDotLabel,
  browserReleasedCardCopy,
  browserViewportFooterLabel,
  browserWakeFeedback,
  shouldShowBrowserHeader,
  shouldShowBrowserLiveOverlay,
  shouldPreserveBrowserCanvasOnTaskSwitch,
  shouldRemountBrowserStreamAfterRestore,
  shouldSuspectTerminalBrowserSession,
  shouldShowBrowserFullscreen,
  shouldShowTerminalEvidenceLedger,
  shouldConnectBrowserStream,
  shouldUseTerminalEvidence,
  isBrowserInteractionActive,
  taskOwnedBrowserFrame,
  taskOwnedBrowserUrl,
  terminalEvidenceContinuation,
  terminalEvidenceFrameForTask,
  terminalEvidenceFrameLabel,
  terminalEvidenceLayout,
  terminalBrowserRecoveryWindow,
  terminalBrowserRecoveryRetryDelay,
  terminalBrowserSessionUnavailable,
  type TerminalBrowserRecoveryState,
  type TerminalEvidenceScreenshotSource,
} from '@/components/browser-panel-state';
import {
  CdpScreencastViewport,
  type CdpScreencastStatus,
} from '@/components/CdpScreencastViewport';
import { useToast } from '@/components/ui/toast';
import { VncViewport, type VncStatus } from '@/components/VncViewport';
import {
  browserNavExceptionMessage,
  browserNavFailureMessage,
} from '@/lib/browser-nav-copy';
import { awaitingUserCopy } from '@/lib/awaiting-user-copy';
import {
  fitScreencastContain,
  fitScreencastReadable,
  readableScreencastAutoScrollKey,
  readableScreencastStartScrollLeft,
} from '@/lib/screencast-fit';
import {
  externalLinkConfirmDescription,
  safeExternalHttpHref,
} from '@/lib/external-link-copy';
import { hdDebug } from '@/lib/hd-debug';
import { trpc } from '@/lib/trpc';
import { useStreamToken } from '@/lib/use-stream-token';
import { shouldConnectTaskBrowserForWorkbench } from '@/lib/workbench-state';
import { send as wsSend } from '@/lib/ws';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';
import type { UiScreencast, UiStep, UiTaskStatus } from '@/types/task';
import { isTerminalStatus } from '@/types/task';
import { liveStatusLabel } from '@/utils/step-humanize';

/**
 * Emergency-only VNC bridge URL. CDP screencast is the production
 * default; this path is inert unless both the frontend and backend
 * explicitly enable VNC fallback.
 *
 * `VITE_VNC_PATH` is only for deployments that intentionally expose
 * a separately secured VNC proxy. Empty keeps the legacy shared path
 * disabled.
 */
const VNC_PATH = (import.meta.env.VITE_VNC_PATH as string | undefined) ?? '';
const VNC_FALLBACK_ENABLED =
  (import.meta.env.VITE_ENABLE_VNC_FALLBACK as string | undefined) === 'true';
const BROWSER_SURFACE =
  'border-[#DCDDDD] bg-white/95 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85';
const BROWSER_DIVIDER = 'border-[#DCDDDD]/80 dark:border-white/10';
const BROWSER_TOOL_BUTTON =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-foreground disabled:pointer-events-none disabled:opacity-45 dark:hover:bg-white/10';

/**
 * Build the VNC WebSocket URL for the current panel session.
 *
 * Two modes:
 *   - Legacy shared singleton (`poolUserId = null`): connects to the
 *     fixed `/vnc/websockify` path at port 6080 via nginx. Matches the
 *     pre-Phase-8 deployment where every user shares one Brave.
 *   - Per-user pool (`poolUserId != null`): connects to
 *     `/vnc-ws/<userId>?token=<JWT>` served by the orchestrator's own
 *     upgrade handler. The token is read off localStorage so a page
 *     reload reconnects transparently; the URL itself isn't persisted
 *     anywhere.
 *
 * Returns null when no enabled VNC route is available.
 */
function buildVncUrl(
  activeTaskId: string | null,
  poolUserId: string | null,
  streamToken: string | null,
): string | null {
  if (typeof window === 'undefined') return null;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // Prefer the per-task route so concurrent tasks each get their
  // own VNC stream; fall back to the legacy userId path (caller's
  // most-recently-active task) when no task is selected. Mirrors
  // buildScreencastUrl below. Token is the 60s stream JWT, not the
  // workbench access JWT — keeps the long-lived secret out of WS
  // URLs that browsers print on connect failure.
  const arg = activeTaskId ?? poolUserId;
  if (arg) {
    if (!streamToken) return null;
    return `${scheme}://${window.location.host}/vnc-ws/${encodeURIComponent(
      arg,
    )}?token=${encodeURIComponent(streamToken)}`;
  }
  if (!VNC_PATH) return null;
  return `${scheme}://${window.location.host}${VNC_PATH}`;
}

/**
 * Phase 19 — sister of buildVncUrl for the new CDP screencast
 * transport. Only the per-user pool path supports it (the legacy
 * shared-Brave VNC stream is VNC-only). Returns null when CDP
 * isn't usable for this user.
 *
 * Phase 24 fix #2 — prefer the per-task route. When `activeTaskId`
 * is set, the URL targets `/screencast-ws/<taskId>` so the panel
 * mirrors that specific task's Brave even when the user has other
 * concurrent tasks. The orchestrator dispatches by `tsk_` prefix and
 * verifies the JWT subject owns the task. Falls back to the legacy
 * userId path (most-recently-active task for the caller) when no
 * task is selected — keeps the panel populated on idle dashboards.
 */
function buildScreencastUrl(
  activeTaskId: string | null,
  poolUserId: string | null,
): string | null {
  if (typeof window === 'undefined') return null;
  const arg = activeTaskId ?? poolUserId;
  if (!arg) return null;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/screencast-ws/${encodeURIComponent(
    arg,
  )}`;
}

/**
 * CDP is the default. VNC can only be selected when the build-time
 * emergency flag is enabled and the operator opts in through localStorage.
 */
function readStreamTransport(): 'vnc' | 'cdp' {
  if (typeof window === 'undefined' || !VNC_FALLBACK_ENABLED) return 'cdp';
  try {
    return window.localStorage.getItem('holaday.streamTransport') === 'vnc'
      ? 'vnc'
      : 'cdp';
  } catch {
    return 'cdp';
  }
}

interface Props {
  /** Latest screencast frame for the selected task (if any). */
  frame?: UiScreencast | null;
  /** Selected task status — drives the status dot colour. */
  taskStatus?: UiTaskStatus | null;
  /** Non-null when the orchestrator paused on a captcha signal. */
  awaitingUser?: boolean;
  /**
   * P2-A — what KIND of input the agent is waiting on. Only the
   * non-`clarification` kinds need the panel's verify banner / auto
   * takeover. `clarification` (intake / follow-up question) leaves
   * the panel idle so the user can keep typing in the chat composer
   * without losing the page they were watching. Missing == treated
   * as `clarification` for safety on legacy events.
   */
  awaitingKind?: 'clarification' | 'login' | 'captcha' | 'permission' | 'browser_action' | 'video_quote';
  /** Active task id — forwarded on user_input events so backend can correlate. */
  activeTaskId?: string | null;
  /**
   * Shell-level browser workspace opened without a browser task. The panel
   * renders its browser chrome and an honest idle state, but never starts a
   * screencast or enables controls that require a task-owned browser.
   */
  workspaceIdle?: boolean;
  /** Start a real task-owned browser from the shell-level address bar. */
  onStartWorkspaceTask?: (intent: string) => Promise<boolean>;
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
  /**
   * Phase 8.2 per-user pool mode. When non-null, the VNC URL points
   * at `/vnc-ws/<userId>` served by the orchestrator's upgrade
   * handler instead of the shared `/vnc/websockify` nginx path.
   * `null` falls back to the legacy singleton behaviour.
   */
  poolUserId?: string | null;
  /**
   * Round-2 remote-desktop mode. When true, the caller has hidden
   * the sidebar + chat area and wants the panel to own the viewport.
   * The header shows a Minimize icon instead of Maximize so the
   * user can exit — Escape also exits via the keyboard handler up
   * in WorkbenchApp.
   */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /**
   * Lifted-collapse mode. When `collapsed` is provided, the panel
   * runs as a controlled component — onToggleCollapse fires when the
   * user hits the collapse button. Lets the parent (WorkbenchApp)
   * also shrink the right column / hide the resize handle, since
   * the previous local-state collapse only narrowed the inner div
   * inside a column the parent had already sized.
   */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /**
   * Fires when the user clicks "重新执行" on a terminal task that
   * has neither a saved finalScreenshot nor a finalUrl. Provided
   * by WorkbenchApp; the panel only knows the click happened.
   */
  onReExecute?: () => void;
  /** True while the parent is creating the fresh replacement task. */
  reExecuting?: boolean;
  /** Focus the current task's follow-up composer before handing a terminal page back to AI. */
  onRequestAgentHelp?: () => void;
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
  awaitingKind,
  activeTaskId,
  workspaceIdle = false,
  onStartWorkspaceTask,
  layout = 'rail',
  open = true,
  onClose,
  poolUserId = null,
  fullscreen = false,
  onToggleFullscreen,
  collapsed: collapsedProp,
  onToggleCollapse,
  onReExecute,
  reExecuting = false,
  onRequestAgentHelp,
}: Props): JSX.Element | null {
  const isSheet = layout === 'sheet';
  // P2-A — only the non-clarification kinds need browser takeover.
  // Treat missing kind as `clarification` so older WS events / legacy
  // DB rows (NULL awaiting_kind) don't accidentally flash the verify
  // banner. The banner + auto-interactive used to fire for every
  // awaiting_user, including expert-workflow intake — that was the
  // BOSS-reported bug.
  const browserAwaiting =
    awaitingUser === true &&
    awaitingKind != null &&
    awaitingKind !== 'clarification' &&
    // video_quote 是聊天内的报价卡(无浏览器会话)→ 不触发浏览器面板接管。
    awaitingKind !== 'video_quote';
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const [collapsedLocal, setCollapsedLocal] = React.useState(false);
  const collapsed = collapsedProp ?? collapsedLocal;
  const toggleCollapsed = onToggleCollapse ?? (() => setCollapsedLocal((c) => !c));
  /**
   * BOSS bug fix — panel content adapts to its OWN width, not the
   * viewport. The panel is user-resizable on desktop and lives in
   * a bottom sheet on mobile, so a viewport-width media query is
   * the wrong axis. ResizeObserver tracks the panel root and flips
   * `isNarrow` true under 500px; CSS / conditionals downstream use
   * `data-narrow` (set on the root) or this state to compress the
   * toolbar density.
   */
  const panelRootRef = React.useRef<HTMLDivElement | null>(null);
  const [isNarrow, setIsNarrow] = React.useState(false);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  React.useEffect(() => {
    const el = panelRootRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;
    const dockInsetProperty = '--holaday-browser-panel-inset';
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setIsNarrow(w > 0 && w < 500);
      if (!isSheet && w > 0) {
        document.documentElement.style.setProperty(
          dockInsetProperty,
          `${Math.ceil(w) + 16}px`,
        );
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (!isSheet) document.documentElement.style.removeProperty(dockInsetProperty);
    };
  }, [isSheet]);
  // Interactive mode is in the global store so the TaskStream's
  // "Continue in browser" button can flip it on from the left panel.
  const interactive = useTaskStore((s) => s.browserInteractive);
  const setInteractive = useTaskStore((s) => s.setBrowserInteractive);

  const activeTask = useTaskStore((s) =>
    activeTaskId ? s.tasks.find((t) => t.taskId === activeTaskId) ?? null : null,
  );
  const taskIsTerminal = taskStatus ? isTerminalStatus(taskStatus) : false;
  const terminalEvidence = React.useMemo(
    () =>
      terminalEvidenceFrameForTask({
        taskIsTerminal,
        task: activeTask,
        liveFrame: frame ?? null,
      }),
    [activeTask, frame, taskIsTerminal],
  );
  const finalEvidenceFrame = terminalEvidence?.frame ?? null;
  // P2 — URL fallback chain: task.finalUrl (persisted, survives
  // refreshes / awaiting_user pauses / screencast disconnects)
  // → displayFrame.url (live or evidence) → lastKnownUrl (in-memory
  // grace) → about:blank.
  // Earlier the URL chip dropped to about:blank during an
  // awaiting_user pause whenever the screencast WS dropped; finalUrl
  // is written by the supercar on park / terminal so it pins the
  // last real URL through any transient connection loss.
  //
  // F3 — `lastKnownUrl` closes the brief flash window at the
  // executing→terminal transition. The screencast WS shuts off the
  // moment status flips; `frame` becomes stale and the next render
  // saw `about:blank` until tasks.detail's `finalUrl` hydrate
  // landed (~200-800 ms later, sometimes longer on slow connections).
  // We mirror every non-blank screencast URL into a ref-backed state,
  // and slot it in BETWEEN frameUrl and 'about:blank'. Reset on
  // active-task switch so the prior task's URL doesn't bleed in.
  const persistedFinalUrl =
    activeTask?.finalUrl && !isBlankUrl(activeTask.finalUrl)
      ? activeTask.finalUrl
      : null;
  const incomingFrameUrl =
    frame?.url && !isBlankUrl(frame.url)
      ? frame.url
      : null;
  const [lastKnownUrlState, setLastKnownUrlState] =
    React.useState<{ taskId: string; url: string } | null>(null);
  const lastKnownUrl = taskOwnedBrowserUrl(activeTaskId ?? null, lastKnownUrlState);
  React.useEffect(() => {
    if (activeTaskId && incomingFrameUrl) {
      setLastKnownUrlState({ taskId: activeTaskId, url: incomingFrameUrl });
    }
  }, [activeTaskId, incomingFrameUrl]);
  // Optimization #3 R2 — live CDP URL from the streamer's
  // `Page.frameNavigated` event. Tracks user / agent navigation on
  // the remote browser in real time (clicking a link, JS pushState,
  // page reload). When set, takes priority over `persistedFinalUrl`
  // during a live session — including the renewable idle lease after
  // completion. The persisted final URL only wins after that real
  // browser is no longer available and the panel falls back to evidence.
  const [cdpLiveUrlState, setCdpLiveUrlState] =
    React.useState<{ taskId: string; url: string } | null>(null);
  const cdpLiveUrl = taskOwnedBrowserUrl(activeTaskId ?? null, cdpLiveUrlState);
  const onCdpUrlChange = React.useCallback((url: string) => {
    if (!activeTaskId || !url || isBlankUrl(url)) return;
    const taskUrl = { taskId: activeTaskId, url };
    setCdpLiveUrlState(taskUrl);
    setLastKnownUrlState(taskUrl);
  }, [activeTaskId]);
  const lastCheckpointRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    lastCheckpointRef.current = null;
  }, [activeTaskId]);
  React.useEffect(() => {
    if (
      !activeTaskId ||
      !taskIsTerminal ||
      !cdpLiveUrl ||
      !safeExternalHttpHref(cdpLiveUrl) ||
      lastCheckpointRef.current === cdpLiveUrl
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      lastCheckpointRef.current = cdpLiveUrl;
      void trpc.tasks.checkpointBrowserSession
        .mutate({ taskId: activeTaskId, url: cdpLiveUrl })
        .catch(() => {
          lastCheckpointRef.current = null;
        });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [activeTaskId, cdpLiveUrl, taskIsTerminal]);
  const terminalStatus = taskStatus ? isTerminalStatus(taskStatus) : false;
  const startupTargetUrl =
    !terminalStatus &&
    !cdpLiveUrl &&
    !incomingFrameUrl &&
    !persistedFinalUrl &&
    !lastKnownUrl
      ? browserStartupTargetUrl(activeTask?.intent)
      : null;
  const abortTask = useTaskStore((s) => s.abortTask);
  const [aborting, setAborting] = React.useState(false);
  const isExecuting = taskStatus === 'executing';
  const onStopClick = React.useCallback(async () => {
    if (!activeTaskId || aborting) return;
    setAborting(true);
    try {
      await abortTask(activeTaskId);
    } finally {
      if (mountedRef.current) {
        setAborting(false);
      }
    }
  }, [activeTaskId, aborting, abortTask]);

  // Pick the live-stream transport per user. CDP is always the
  // default; VNC requires both a build-time emergency flag and the
  // localStorage opt-in. Read once on mount — flipping
  // the localStorage value mid-session requires a reload, which
  // matches how feature flags usually work and avoids tearing down
  // a live socket on every render.
  const streamTransport = React.useMemo(() => readStreamTransport(), []);
  const usingCdp = streamTransport === 'cdp';
  // Phase 24 diagnostic — log the current task scope so DevTools can
  // confirm the panel is actually receiving the expected taskId from
  // its parent. Re-fires whenever the user picks a different task.
  // Gated through hdDebug so prod builds emit nothing.
  React.useEffect(() => {
    hdDebug('BrowserPanel scope', {
      transport: streamTransport,
      activeTaskId: activeTaskId ?? null,
      taskStatus: taskStatus ?? null,
      poolUserId: poolUserId ?? null,
    });
  }, [streamTransport, activeTaskId, taskStatus, poolUserId]);
  const taskTerminal = taskIsTerminal;
  // Idle gate. The browser panel only connects when a selected task
  // actually owns a browser. The old no-active-task user-pool stream
  // was removed when HOLA DAY moved to per-task browsers.
  // Text/runtime buffers identify legacy generate tasks when no execution
  // mode has arrived yet. Browser tasks also emit progress phases, so this is
  // deliberately a fallback signal rather than a pool-ownership veto.
  const streamingForActive = useTaskStore((s) =>
    activeTaskId ? s.streamingByTask[activeTaskId] : undefined,
  );
  const progressForActive = useTaskStore((s) =>
    activeTaskId ? s.progressByTask[activeTaskId] : undefined,
  );
  const isNonPoolTask = Boolean(streamingForActive ?? progressForActive);
  // Browser ownership is authoritative. Generic progress buffers also exist
  // on the browser lane (planning / verifying), so they can only help classify
  // a legacy task with no browser evidence; they must never veto a browser the
  // task already owns.
  const isBrowserTask = shouldConnectTaskBrowserForWorkbench({
    task: activeTask,
    hasRuntimeTextSignal: isNonPoolTask,
  });
  const shouldConnect = shouldConnectBrowserStream({
    isBrowserTask,
    taskIsTerminal: taskTerminal,
  });
  // Item 6 — short-lived stream token for screencast / VNC WS auth.
  // Refreshes every 45s. CDP receives the token separately from its stable
  // endpoint and consumes the latest value only when a real reconnect is
  // needed, so credential rotation never tears down a healthy browser input
  // session. VNC remains URL-authenticated as an emergency-only fallback.
  const { token: streamToken, refresh: refreshStreamToken } =
    useStreamToken(shouldConnect);
  // VNC live stream — memoised so prop identity is stable across
  // re-renders (the viewport's effect re-runs on any URL change).
  const vncUrl = React.useMemo(() => {
    if (!shouldConnect) return null;
    if (usingCdp) return null;
    return buildVncUrl(activeTaskId ?? null, poolUserId, streamToken);
  }, [activeTaskId, shouldConnect, poolUserId, usingCdp, streamToken]);
  const screencastUrlForCdp = React.useMemo(() => {
    if (!shouldConnect) return null;
    if (!usingCdp) return null;
    return buildScreencastUrl(activeTaskId ?? null, poolUserId);
  }, [activeTaskId, shouldConnect, poolUserId, usingCdp]);
  // [HD-DEBUG] log every URL change (or change to/from null). Token
  // redacted so console dumps stay safe to share.
  React.useEffect(() => {
    hdDebug('screencast URL', {
      activeTaskId: activeTaskId ?? null,
      taskTerminal,
      isNonPoolTask,
      url: screencastUrlForCdp,
    });
  }, [screencastUrlForCdp, activeTaskId, taskTerminal, isNonPoolTask]);
  const [vncStatus, setVncStatus] = React.useState<VncStatus>('idle');
  // P3 hibernation detection: count consecutive failed attempts. The
  // pool's idle GC reaps after 5 min, after which /vnc-ws/ rejects
  // with HTTP 409 ("browser not allocated") which surfaces in noVNC
  // as a 'disconnected' event. After ≥3 consecutive failures we
  // assume the browser is hibernated and offer the wake card. Reset
  // to 0 on a successful 'connect'.
  const [vncAttemptFails, setVncAttemptFails] = React.useState(0);
  const [showReconnect, setShowReconnect] = React.useState(false);
  const [reconnectEpoch, setReconnectEpoch] = React.useState(0);
  const [hasPresentedLiveFrame, setHasPresentedLiveFrame] = React.useState(false);
  const previousActiveTaskIdRef = React.useRef<string | null>(
    activeTaskId ?? null,
  );
  const handlePresentedLiveFrame = React.useCallback(() => {
    setHasPresentedLiveFrame(true);
  }, []);
  // Phase 24: switching tasks must reset the attempt counter so a
  // prior task's stale failures or reconnect affordance don't leak
  // into a freshly selected task.
  React.useEffect(() => {
    const preserveCanvas = shouldPreserveBrowserCanvasOnTaskSwitch({
      previousTaskId: previousActiveTaskIdRef.current,
      nextTaskId: activeTaskId ?? null,
      nextReplyToTaskId: activeTask?.replyToTaskId ?? null,
      nextExecutionMode: activeTask?.executionMode,
    });
    setVncAttemptFails(0);
    setVncStatus('idle');
    setShowReconnect(false);
    if (!preserveCanvas) setHasPresentedLiveFrame(false);
    previousActiveTaskIdRef.current = activeTaskId ?? null;
  }, [activeTask?.executionMode, activeTask?.replyToTaskId, activeTaskId]);
  const handleVncStatus = React.useCallback((status: VncStatus) => {
    setVncStatus(status);
    if (!usingCdp && status === 'connected') setHasPresentedLiveFrame(true);
    setVncAttemptFails((n) => {
      if (status === 'connected') return 0;
      // CDP reports `error` and then `close` for one failed socket. Count the
      // close only so a single transient failure is not treated as two outages.
      if (status === 'disconnected') return n + 1;
      return n;
    });
  }, [usingCdp]);
  // Codex Pack B2 — long-connecting reconnect affordance. The viewer
  // sits in `connecting` state when noVNC is still finishing its TLS
  // handshake / RFB protocol negotiation. Usually 1-3s; if it drags
  // past 5s, surface a "刷新画面" button so the user can force a
  // fresh browser-frame attempt instead of staring at the placeholder text.
  // Tracked separately from `vncAttemptFails` (which counts
  // disconnected/error, not slow-connect).
  const browserConnectionReady = vncStatus === 'connected';
  React.useEffect(() => {
    if (browserConnectionReady) {
      setShowReconnect(false);
      return;
    }
    const timer = window.setTimeout(
      () => setShowReconnect(true),
      browserReconnectAffordanceDelay({
        taskIsTerminal: taskTerminal,
        hasPresentedFrame: hasPresentedLiveFrame,
      }),
    );
    return () => window.clearTimeout(timer);
  }, [
    activeTaskId,
    browserConnectionReady,
    hasPresentedLiveFrame,
    reconnectEpoch,
    taskTerminal,
  ]);
  const handleManualReconnect = React.useCallback(() => {
    setShowReconnect(false);
    setVncStatus('idle');
    setVncAttemptFails(0);
    if (!usingCdp) setHasPresentedLiveFrame(false);
    void refreshStreamToken().finally(() => {
      if (mountedRef.current) setReconnectEpoch((n) => n + 1);
    });
    toast.show('正在刷新浏览器画面', 'info');
  }, [refreshStreamToken, toast, usingCdp]);
  const liveOverlayCopy = browserLiveOverlayCopy({
    status: vncStatus,
    showReconnect,
    taskIsTerminal: taskTerminal,
  });
  const showLiveOverlay = shouldShowBrowserLiveOverlay({
    liveStatus: vncStatus,
    showReconnect,
    hasPresentedFrame: hasPresentedLiveFrame,
  });
  // Keep transient transport jitter silent. The last painted frame remains
  // visible; only an outage that survives the reconnect grace period gets
  // a compact, non-blocking reconnect affordance below.
  // Phase 24: hibernation is a userId-pool concept (idle GC after
  // 5min). Per-task pool has no hibernation — retained terminal and
  // executing task sessions use renewable/continuous reconnect logic
  // instead. Only fire the hibernation card on the LEGACY userId-scoped
  // panel state (no task selected).
  // This prevents the "浏览器已休眠" flicker BOSS reported on both
  // executing tasks (transient WS hiccups) and terminal tasks (Brave
  // released after task end).
  const hibernated = poolUserId != null && vncAttemptFails >= 3 && !activeTaskId;
  // Legacy no-task wake/check call. Task-bound recovery uses
  // ensureBrowserSession below so it can restore the selected task at its last
  // trusted page instead of probing an unrelated user-level browser.
  const [waking, setWaking] = React.useState(false);
  const onWake = React.useCallback(async () => {
    if (waking) return;
    setWaking(true);
    try {
      const res = await trpc.tasks.wakeBrowser.mutate();
      const feedback = browserWakeFeedback(
        (res as { status?: unknown } | null)?.status?.toString(),
      );
      if (!mountedRef.current) return;
      if (res.status === 'ready') {
        // Reset counter and remount the screencast viewport. In the
        // per-task browser model this is a status check, not a wake-up;
        // when a task-owned browser does exist, a remount is the
        // clearest way to refresh the stale viewer.
        setVncAttemptFails(0);
        setShowReconnect(false);
        setVncStatus('idle');
        setReconnectEpoch((n) => n + 1);
      }
      toast.show(feedback.message, feedback.tone);
    } catch {
      toast.show(browserWakeFeedback(null).message, 'error');
    } finally {
      if (mountedRef.current) {
        setWaking(false);
      }
    }
  }, [toast, waking]);
  // Terminal browser tasks receive a renewable backend idle lease. Keep the
  // real stream connected while the user is present; if the process is gone,
  // restore the same task at its last trusted page before falling back to an
  // honestly labelled screenshot.
  const [terminalConnectTimedOut, setTerminalConnectTimedOut] =
    React.useState(false);
  const [terminalRecoveryState, setTerminalRecoveryState] =
    React.useState<TerminalBrowserRecoveryState>('idle');
  const [terminalRecoveryAttempt, setTerminalRecoveryAttempt] =
    React.useState(0);
  const terminalDisconnectedAtRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    setTerminalRecoveryState('idle');
    setTerminalRecoveryAttempt(0);
    terminalDisconnectedAtRef.current = null;
  }, [activeTaskId]);
  const terminalBrowserDisconnected =
    taskTerminal && vncStatus !== 'connected';
  React.useEffect(() => {
    const recoveryWindow = terminalBrowserRecoveryWindow({
      disconnected: terminalBrowserDisconnected,
      disconnectedAt: terminalDisconnectedAtRef.current,
      now: Date.now(),
      hasPresentedFrame: hasPresentedLiveFrame,
    });
    terminalDisconnectedAtRef.current = recoveryWindow.disconnectedAt;
    setTerminalConnectTimedOut(recoveryWindow.timedOut);
    if (!terminalBrowserDisconnected || recoveryWindow.timedOut) return;
    const timer = window.setTimeout(() => {
      setTerminalConnectTimedOut(true);
    }, recoveryWindow.remainingMs);
    return () => window.clearTimeout(timer);
  }, [
    activeTaskId,
    hasPresentedLiveFrame,
    terminalBrowserDisconnected,
  ]);
  const terminalSessionSuspected = shouldSuspectTerminalBrowserSession({
    taskIsTerminal: taskTerminal,
    liveStatus: vncStatus,
    failedAttempts: vncAttemptFails,
    connectTimedOut: terminalConnectTimedOut,
    hasPresentedFrame: hasPresentedLiveFrame,
  });
  const terminalRestoreUrl =
    safeExternalHttpHref(persistedFinalUrl) ??
    safeExternalHttpHref(finalEvidenceFrame?.url);
  const terminalCanRestore = Boolean(activeTaskId && terminalRestoreUrl);
  const restoreTerminalSession = React.useCallback(
    async (announce = false): Promise<boolean> => {
      if (!activeTaskId || !taskTerminal || !terminalCanRestore) return false;
      setTerminalRecoveryState('restoring');
      try {
        const result = await trpc.tasks.ensureBrowserSession.mutate({
          taskId: activeTaskId,
        });
        if (!mountedRef.current) return false;
        // A process restart invalidates the prior server's short-lived stream
        // credential even when its nominal TTL has not elapsed. Refresh it as
        // part of recovery so the remounted viewport can authenticate now
        // instead of waiting for the 45-second background rotation.
        await refreshStreamToken();
        if (!mountedRef.current) return false;
        setTerminalConnectTimedOut(false);
        setVncAttemptFails(0);
        setShowReconnect(false);
        setVncStatus('idle');
        setTerminalRecoveryState('ready');
        setTerminalRecoveryAttempt(0);
        if (shouldRemountBrowserStreamAfterRestore({ usingCdp })) {
          setReconnectEpoch((epoch) => epoch + 1);
        }
        if (announce) {
          toast.show(
            result.restored
              ? '浏览器已恢复，可以继续操作'
              : '浏览器仍在，可以继续操作',
            'info',
          );
        }
        return true;
      } catch {
        if (mountedRef.current) {
          setTerminalRecoveryState('failed');
          setTerminalRecoveryAttempt((attempt) => attempt + 1);
          if (announce) toast.show('浏览器恢复失败，请稍后重试', 'error');
        }
        return false;
      }
    }, [
      activeTaskId,
      refreshStreamToken,
      taskTerminal,
      terminalCanRestore,
      toast,
      usingCdp,
    ]);
  React.useEffect(() => {
    if (!taskTerminal) return;
    if (vncStatus === 'connected') {
      setTerminalRecoveryState('connected');
      setTerminalRecoveryAttempt(0);
      return;
    }
    if (!terminalSessionSuspected || !terminalCanRestore) return;
    if (
      terminalRecoveryState !== 'idle' &&
      terminalRecoveryState !== 'connected'
    ) {
      return;
    }
    void restoreTerminalSession(false);
  }, [
    restoreTerminalSession,
    taskTerminal,
    terminalCanRestore,
    terminalRecoveryState,
    terminalSessionSuspected,
    vncStatus,
  ]);
  React.useEffect(() => {
    if (
      terminalRecoveryState !== 'failed' ||
      !taskTerminal ||
      !terminalSessionSuspected ||
      !terminalCanRestore
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setTerminalRecoveryState('idle');
    }, terminalBrowserRecoveryRetryDelay(terminalRecoveryAttempt));
    return () => window.clearTimeout(timer);
  }, [
    taskTerminal,
    terminalCanRestore,
    terminalRecoveryAttempt,
    terminalRecoveryState,
    terminalSessionSuspected,
  ]);
  React.useEffect(() => {
    if (terminalRecoveryState !== 'ready' || vncStatus === 'connected') return;
    const timer = window.setTimeout(() => {
      setTerminalRecoveryState('failed');
      setTerminalRecoveryAttempt((attempt) => attempt + 1);
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [terminalRecoveryState, vncStatus]);
  const terminalSessionUnavailable = terminalBrowserSessionUnavailable({
    sessionSuspected: terminalSessionSuspected,
    canRestore: terminalCanRestore,
    hasPresentedFrame: hasPresentedLiveFrame,
    recoveryState: terminalRecoveryState,
    recoveryAttempt: terminalRecoveryAttempt,
  });
  const useVnc = usingCdp
    ? shouldConnect && !terminalSessionUnavailable
    : Boolean(vncUrl) && !terminalSessionUnavailable;
  const showTerminalEvidence = shouldUseTerminalEvidence({
    taskIsTerminal: taskTerminal,
    hasFinalEvidence: Boolean(finalEvidenceFrame),
    liveSessionUnavailable: terminalSessionUnavailable,
  });
  const displayFrame = taskOwnedBrowserFrame({
    taskIsTerminal,
    liveFrame: frame ?? null,
    finalEvidenceFrame,
    preferLiveTerminalSession: taskTerminal && !terminalSessionUnavailable,
  });
  const displayFrameUrl =
    displayFrame?.url && !isBlankUrl(displayFrame.url)
      ? displayFrame.url
      : null;
  const displayUrl = terminalSessionUnavailable
    ? (persistedFinalUrl ?? displayFrameUrl ?? lastKnownUrl ?? 'about:blank')
    : (cdpLiveUrl ??
      incomingFrameUrl ??
      persistedFinalUrl ??
      lastKnownUrl ??
      startupTargetUrl ??
      'about:blank');
  const displayUrlIsPendingTarget =
    startupTargetUrl != null && displayUrl === startupTargetUrl;
  // When the agent parks on awaiting-user (captcha, login wall, user
  // question the model injected), auto-flip the panel to interactive
  // mode — the user almost certainly needs to click into the browser
  // to unblock it. Only auto-enable; never auto-disable, so a user who
  // deliberately toggled off stays in view-only mode on their next
  // task's captcha. Trigger condition covers both rendering lanes:
  //   - VNC: live connection present.
  //   - JPEG fallback: a real frame (not about:blank).
  React.useEffect(() => {
    if (!browserAwaiting || interactive) return;
    const hasLiveViewport = useVnc
      ? vncStatus === 'connected' || vncStatus === 'connecting'
      : Boolean(frame) && !isBlankUrl(frame?.url);
    if (hasLiveViewport) setInteractive(true);
  }, [browserAwaiting, interactive, useVnc, vncStatus, frame, setInteractive]);
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
  const screencastAutoScrolledKeyRef = React.useRef<string | null>(null);
  /**
   * BUG-11 — pure-JS sizing for the JPEG-fallback img.
   *
   * Five rounds of CSS attempts (object-fit, max-w-full, absolute
   * inset-0, h-full w-full, min-w-0 chains) all failed because
   * somewhere in the ancestor chain `min-width: auto` (flex
   * default) let the img's 1014px intrinsic box leak through and
   * size everything to itself. JS sizing bypasses that entirely:
   * read host.clientWidth/Height in pixels, compute scale from
   * naturalWidth/Height, write px on the img.
   *
   * `fitScreencastImg` is exposed as a callback so the img's
   * onLoad can call it directly (frames arrive with new natural
   * dims). ResizeObserver on the host handles panel-drag resize.
   */
  const screencastHostRef = React.useRef<HTMLDivElement | null>(null);
  const fitScreencastImg = React.useCallback((): void => {
    const host = screencastHostRef.current;
    const img = imgRef.current;
    if (!host || !img) return;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (natW <= 0 || natH <= 0) return;
    const hostW = host.clientWidth;
    const hostH = host.clientHeight;
    const fitFn = isSheet ? fitScreencastReadable : fitScreencastContain;
    const fit = fitFn({
      hostWidth: hostW,
      hostHeight: hostH,
      sourceWidth: natW,
      sourceHeight: natH,
    });
    if (!fit) return;
    img.style.width = `${fit.width}px`;
    img.style.height = `${fit.height}px`;
    const frameKey = readableScreencastAutoScrollKey({
      frameKey: frame?.imageBase64,
      hostWidth: hostW,
      hostHeight: hostH,
      contentWidth: fit.width,
    });
    if (
      isSheet &&
      !interactive &&
      frameKey &&
      screencastAutoScrolledKeyRef.current !== frameKey
    ) {
      screencastAutoScrolledKeyRef.current = frameKey;
      const startLeft = readableScreencastStartScrollLeft({
        contentWidth: fit.width,
        hostWidth: hostW,
      });
      host.scrollTo({ left: startLeft, top: 0 });
    }
  }, [frame?.imageBase64, interactive, isSheet]);
  React.useEffect(() => {
    const host = screencastHostRef.current;
    if (!host) return;
    fitScreencastImg();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => fitScreencastImg());
      ro.observe(host);
    }
    const onWin = () => fitScreencastImg();
    window.addEventListener('resize', onWin);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWin);
    };
  }, [fitScreencastImg]);
  React.useEffect(() => {
    screencastAutoScrolledKeyRef.current = null;
    screencastHostRef.current?.scrollTo({ left: 0, top: 0 });
  }, [activeTaskId, frame?.imageBase64]);
  const liveBrowserCanPan = browserFrameCanPanInPortraitSheet({
    isSheet,
    viewport: displayFrame?.viewport,
    assumeScrollableWhenUnknown: useVnc,
  });
  // Codex P2 follow-up — hidden input for direct CJK typing on the
  // JPEG screencast path (CDP mode). Browser-native IME composition
  // events fire on this focused-but-invisible element; on
  // `compositionend` we forward the finalised text via `insert_text`
  // so Chinese / Japanese / Korean characters land on the remote
  // page intact. Without it, each pinyin keystroke went through
  // sendInput's `type` branch as a single ASCII letter, producing
  // garbage when the user typed Chinese directly. The visible
  // CjkInputBar is now an opt-in fallback for users whose IME path
  // doesn't cooperate.
  const hiddenCjkInputRef = React.useRef<HTMLInputElement | null>(null);
  const cjkComposingRef = React.useRef(false);
  const [cjkFallbackOpen, setCjkFallbackOpen] = React.useState(false);
  const status: DotStatus = browserAwaiting
    ? 'error'
    : deriveDotStatus(taskStatus, Boolean(frame));

  // Interactive mode only makes sense when there's something to drive.
  // VNC lane: the RFB canvas always has content once connected, so
  // `interactive` alone is the gate. JPEG fallback lane: needs a real
  // frame, otherwise there's nothing to map clicks against.
  const interactiveActive = isBrowserInteractionActive({
    interactive,
    taskIsTerminal,
    useLiveStream: useVnc,
    liveStatus: vncStatus,
    hasLiveFrame: Boolean(frame) && !isBlankUrl(frame?.url),
    liveSessionUnavailable: terminalSessionUnavailable,
  });
  const headerStatus = browserPanelHeaderStatus({
    dotStatus: status,
    liveStatus: vncStatus,
    browserAwaiting,
    interactiveActive,
    interactiveOwned: interactive && !terminalSessionUnavailable,
    showReconnect,
    hasPresentedFrame: hasPresentedLiveFrame,
    taskIsTerminal,
  });
  const evidenceHeaderActive = terminalSessionUnavailable;
  const displayedHeaderStatus = evidenceHeaderActive
    ? browserPanelEvidenceHeaderStatus(
        taskStatus,
        finalEvidenceFrame?.url ?? persistedFinalUrl,
      )
    : headerStatus;

  const browserControl = browserControlAction({
    interactive,
    taskIsTerminal,
  });
  const inputFallbackMode = browserInputFallbackMode({
    interactiveActive,
    usingCdp,
    fallbackOpen: cjkFallbackOpen,
  });
  React.useEffect(() => {
    setActivityVisible(true);
    setCjkFallbackOpen(false);
  }, [activeTaskId]);
  const handleUserTakeoverClick = React.useCallback(() => {
    const next = browserControl.nextInteractive;
    if (next) {
      // If a terminal process was released, takeover first restores the same
      // task's browser. Static evidence never receives interactive controls.
      if (terminalSessionUnavailable) {
        void restoreTerminalSession(true).then((restored) => {
          if (!restored || !mountedRef.current) return;
          setInteractive(true);
        });
        return;
      }
    }
    setInteractive(next);
    if (browserControl.focusFollowUp) onRequestAgentHelp?.();
  }, [
    browserControl,
    onRequestAgentHelp,
    restoreTerminalSession,
    terminalSessionUnavailable,
    setInteractive,
  ]);

  // Codex P2 — hide the address bar / nav / takeover chrome when
  // the panel is open on a terminal task with no viewable evidence
  // (no live frame, no captured screenshot, no recent frame). The
  // toolbar's buttons can't do anything in that state; the panel
  // becomes a "no evidence saved" placeholder + re-execute prompt.
  // interactiveActive flips it back on if the user is mid-takeover
  // for some reason (shouldn't happen on terminal but defensive).
  const taskIsTerminalForHeader = taskStatus ? isTerminalStatus(taskStatus) : false;
  const showHeader =
    workspaceIdle ||
    shouldShowBrowserHeader({
      taskIsTerminal: taskIsTerminalForHeader,
      hasCurrentFrame: Boolean(frame),
      hasFinalEvidence: Boolean(finalEvidenceFrame || persistedFinalUrl),
      interactiveActive,
      hasLiveStream: useVnc,
    });

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
      hdDebug('img-onClick fired', {
        interactiveActive,
        interactive,
        useVnc,
        hasFrame: Boolean(frame),
        frameUrl: frame?.url ?? null,
        browserAwaiting,
      });
      if (!interactiveActive) {
        hdDebug('img-onClick skipped — interactiveActive=false', {
          interactive,
          frame: Boolean(frame),
          frameUrl: frame?.url,
        });
        return;
      }
      const pt = mapToViewport(e);
      hdDebug('img-onClick mapToViewport', {
        pt,
        rect: imgRef.current?.getBoundingClientRect(),
      });
      if (!pt) return;
      e.preventDefault();
      flashRipple(e.clientX, e.clientY);
      sendInput({ kind: 'click', x: pt.x, y: pt.y, button: 'left' });
      hdDebug('img-onClick sendInput dispatched', {
        x: pt.x,
        y: pt.y,
        activeTaskId,
      });
      // Codex P2 — pull focus onto the hidden CJK input so the
      // user's next keystroke (ASCII or IME-composed CJK) goes
      // through our composition handlers instead of the page's
      // default focus owner (which can't reach the remote Brave).
      // We use the next tick so the click's default-prevention
      // doesn't conflict with the focus call in some browsers.
      const el = hiddenCjkInputRef.current;
      if (el) requestAnimationFrame(() => el.focus());
    },
    [
      interactiveActive,
      mapToViewport,
      sendInput,
      flashRipple,
      // Below are debug-only — listed so hdDebug captures fresh values.
      interactive,
      useVnc,
      frame,
      browserAwaiting,
      activeTaskId,
    ],
  );

  // CJK input bar — sends `insert_text` (atomic) so Chinese composed
  // in the user's local IME lands in the focused element on the
  // remote Brave. Shown only in interactive mode (no point typing
  // when the user can't drive). The window keydown listener above
  // forwards plain ASCII keystrokes via `type` / `key` paths; CJK
  // composition input bypasses that route entirely (browsers swallow
  // composing keystrokes from the keydown handler).
  const sendInsertText = React.useCallback(
    (text: string) => {
      if (!interactiveActive || !text) return;
      sendInput({ kind: 'insert_text', text });
    },
    [interactiveActive, sendInput],
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

  const section = (
    <section
      ref={panelRootRef}
      aria-label="浏览器工作区"
      data-narrow={isNarrow || isSheet ? 'true' : 'false'}
      className={cn(
        'relative flex flex-col border-l border-[#DCDDDD] backdrop-blur-xl dark:border-white/10',
        isSheet
          ? 'fixed inset-x-0 bottom-0 z-[75] h-[calc(100dvh-56px)] max-h-[calc(100dvh-56px)] rounded-t-lg border-t border-l-0 shadow-2xl animate-fade-in motion-reduce:animate-none'
          : 'h-full transition-[width] duration-150',
        // Desktop: fill the parent wrapper (App owns the flex-basis /
        // resize logic). The collapsed rail stays a local state the
        // wrapper's flex-basis doesn't fight — just w-10 overrides.
        !isSheet && (collapsed ? 'w-10 shrink-0' : 'h-full w-full'),
      )}
      // Phase 13 B3 follow-up — was hsl(var(--card)) (#171717 in dark
      // mode), which read as a slightly-different black band next to
      // the #121212 main area. Switching to --background means the
      // panel and the rest of the workbench are tonally identical;
      // the border-l divider is the only visible separator.
      style={{ backgroundColor: 'hsl(var(--background))' }}
    >
      {!isSheet && !fullscreen && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          aria-label={collapsed ? '展开浏览器' : '收起浏览器'}
          title={collapsed ? '展开浏览器' : '收起浏览器'}
          /* BOSS bug fix — was top-3 which sat right next to the
             toolbar's red stop / back / forward buttons (panel
             left-padding starts at the same x-band). Pushed down
             to top-1/2 (vertical center) so the collapse handle
             reads as a panel-edge affordance, not part of the
             browser nav row. */
          className="absolute left-0 top-1/2 z-30 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#DCDDDD] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.08)] hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-card"
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
          aria-label="收起浏览器"
          title="收起浏览器"
          className="absolute left-1/2 top-0 z-[90] flex h-8 w-20 -translate-x-1/2 items-start justify-center pt-2"
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        </button>
      )}

      {!isSheet && collapsed ? (
        <div className="flex flex-1 items-center justify-center">
          <div
            className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
            title="展开浏览器"
            aria-label="浏览器已收起"
          >
            <Globe className="h-4 w-4 text-[#118AB2] dark:text-[#42C0EF]" aria-hidden />
            <div className="rotate-180 text-[11px] tracking-wider [writing-mode:vertical-rl]">
              浏览器
            </div>
          </div>
        </div>
      ) : (
        <>
          {/*
           * Fullscreen renders WITHOUT the fixed header / footer / banners —
           * BOSS reported the chrome was eating the top of the page
           * (Google logo blocked). In fullscreen, only a small floating
           * exit button + the canvas itself. Everything else falls back
           * to the usual stacked layout.
           */}
          {fullscreen && onToggleFullscreen && (
            // Optimization #3 R2 — floating toolbar. Replaces the
            // lonely exit button with a peek-on-hover bar that
            // mirrors the non-fullscreen header essentials: status
            // dot, back / forward / reload, URL bar, takeover
            // toggle. Auto-hides 2.5s after the cursor leaves so the
            // canvas stays unobstructed while the user watches the
            // agent work; reappears on hover or focus.
            //
            // The bar sits at the TOP — covering the page title is
            // a smaller hit than covering action buttons at the
            // bottom of most sites.
            //
            // EXIT is NOT in this auto-hiding bar (see the persistent
            // pill below). Native fullscreen removes browser chrome,
            // while the CSS fallback keeps this explicit exit visible;
            // both paths therefore have the same reliable escape route.
            <>
              <FullscreenFloatingToolbar
                displayUrl={displayUrl}
                pendingTarget={displayUrlIsPendingTarget}
                status={displayedHeaderStatus}
                interactiveActive={interactiveActive}
                interactive={interactive}
                controlAction={browserControl}
                onToggleInteractive={handleUserTakeoverClick}
                navTaskId={evidenceHeaderActive ? null : activeTaskId ?? null}
                controlsEnabled={!evidenceHeaderActive}
                isExecuting={!evidenceHeaderActive && isExecuting}
                aborting={aborting}
                onStop={onStopClick}
              />
              {/* A — persistent exit. Never auto-hides; sits top-right where
                  the "go close it" instinct lands, intercepting it before the
                  browser's native window X. */}
              <button
                type="button"
                onClick={onToggleFullscreen}
                title="退出全屏 (Esc)"
                aria-label="退出全屏"
                className="absolute right-3 top-3 z-[60] inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-black/65 px-3 text-[13px] font-medium text-white shadow-2xl backdrop-blur-md transition-colors hover:bg-black/80"
              >
                <Minimize2 className="h-4 w-4" />
                退出全屏
              </button>
              {/* B — persistent Esc hint. Esc already exits (WorkbenchApp Esc
                  routing); this just makes it discoverable. */}
              <div className="pointer-events-none absolute right-3 top-[3.25rem] z-[60] rounded-md bg-black/45 px-2 py-0.5 text-[11px] text-white/75 backdrop-blur-sm">
                或按 Esc 退出
              </div>
            </>
          )}
          {!fullscreen && showHeader && (shouldConnect || evidenceHeaderActive || workspaceIdle) && (
            <header
              aria-label="浏览器工具栏"
              className={cn(
                'flex items-center border-b bg-white/92 backdrop-blur-md dark:bg-background/90',
                isSheet ? 'h-11 gap-1.5 px-2 pt-3' : 'h-12 gap-2 px-3',
                BROWSER_DIVIDER,
              )}
            >
              <BrowserIdentity
                state={displayedHeaderStatus}
                compact={isNarrow || isSheet}
              />
              {!(evidenceHeaderActive && (isNarrow || isSheet)) && (
                <BrowserConnectionChip state={displayedHeaderStatus} compact={isNarrow || isSheet} />
              )}
              {/* BOSS bug fix — when the panel is narrow (< 500px),
                  hide back/forward to keep the URL bar legible. The
                  agent rarely needs them, and the user can take over
                  + use Brave's own gestures if they really need to
                  go back. Reload stays — it's the highest-utility
                  button when a page hangs. */}
              {!evidenceHeaderActive && !workspaceIdle && !isNarrow && !isSheet && (
                <div className="hidden items-center gap-1 sm:flex">
                  <NavButton direction="back" title="后退" navTaskId={activeTaskId ?? null} />
                  <NavButton direction="forward" title="前进" navTaskId={activeTaskId ?? null} />
                </div>
              )}
              {!evidenceHeaderActive && !workspaceIdle && (
                <NavButton direction="reload" title="刷新" navTaskId={activeTaskId ?? null} />
              )}
              <UrlBar
                displayUrl={workspaceIdle ? '' : displayUrl}
                interactiveActive={interactiveActive}
                navTaskId={evidenceHeaderActive ? null : activeTaskId ?? null}
                readOnly={evidenceHeaderActive}
                pendingTarget={displayUrlIsPendingTarget}
                onLaunchTask={workspaceIdle ? onStartWorkspaceTask : undefined}
              />
              {!evidenceHeaderActive && isExecuting && activeTaskId && (
                <button
                  type="button"
                  onClick={onStopClick}
                  disabled={aborting}
                  title="停止当前任务"
                  aria-label="停止当前任务"
                  className={cn(
                    BROWSER_TOOL_BUTTON,
                    'border',
                    aborting
                      ? 'cursor-wait border-[#DCDDDD] bg-[#EFEFEF] text-muted-foreground dark:border-white/10 dark:bg-white/5'
                      : 'border-[#EA1F59]/35 bg-white text-[#EA1F59] hover:bg-[#EA1F59]/10 dark:border-[#EA1F59]/35 dark:bg-transparent dark:hover:bg-[#EA1F59]/10',
                  )}
                >
                  <Square className="h-3 w-3" strokeWidth={2.5} />
                </button>
              )}
              {!evidenceHeaderActive && !workspaceIdle && (
                <button
                  type="button"
                  onClick={handleUserTakeoverClick}
                  title={browserControl.title}
                  aria-label={browserControl.ariaLabel}
                  aria-pressed={interactive}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[9px] border transition-colors',
                    taskIsTerminal && !isNarrow && !isSheet ? 'px-2.5' : 'w-8',
                    interactive
                      ? 'border-[#EA1F59]/35 bg-[#EA1F59]/10 text-[#EA1F59]'
                      : 'border-transparent bg-transparent text-muted-foreground hover:bg-foreground/5',
                  )}
                >
                  {interactive ? (
                    <Bot className="h-3.5 w-3.5" />
                  ) : (
                    <MousePointerClick className="h-3.5 w-3.5" />
                  )}
                  {taskIsTerminal && !isNarrow && !isSheet && (
                    <span className="text-[11px] font-medium">{browserControl.label}</span>
                  )}
                </button>
              )}
              {/* Fullscreen toggle is a power-user feature; hide on
                  narrow panels (BOSS bug — toolbar was crowded). The
                  user can still open fullscreen from the keyboard
                  shortcut or by widening the panel first. */}
              {shouldShowBrowserFullscreen({
                available: Boolean(onToggleFullscreen),
                workspaceIdle,
                isNarrow,
                isSheet,
                evidenceHeaderActive,
              }) && (
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  title={fullscreen ? '退出全屏 (Esc)' : '全屏浏览器模式'}
                  aria-label={fullscreen ? '退出全屏' : '全屏浏览器模式'}
                  aria-pressed={fullscreen}
                  className={cn(
                    BROWSER_TOOL_BUTTON,
                  )}
                >
                  {fullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </header>
          )}
          {browserAwaiting && !fullscreen && (
            <div
              role="alert"
              className={cn(
                'flex animate-fade-in items-start rounded-lg border border-[#FFC910]/60 bg-white text-[#595757] shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-[#FFC910]/35 dark:bg-card/85 dark:text-foreground',
                isSheet ? 'mx-2 mt-2 gap-2 px-3 py-2' : 'mx-3 mt-3 gap-3 px-4 py-3',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full bg-[#FFC910]/20 font-bold text-[#57479C]',
                  isSheet ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-base',
                )}
              >
                !
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('font-semibold', isSheet ? 'text-[13px]' : 'text-sm')}>
                  {awaitingUserCopy(awaitingKind).panelTitle}
                </div>
                <div className={cn('mt-0.5 text-muted-foreground', isSheet ? 'text-[11px] leading-snug' : 'text-xs')}>
                  {awaitingUserCopy(awaitingKind).panelBody}
                </div>
                {/* Phase 1 follow-up — login park resume affordance.
                    Surfaces ONLY when:
                    - kind is 'login' (the case where users actually
                      need to act outside our panel)
                    - we have a real URL to point at (the persisted
                      finalUrl, not a stale `about:blank`)
                    - and the live screencast is NOT current
                      (frame === null means WS dropped on refresh OR
                      Brave was released; the static evidence frame
                      is what the user is seeing). When the live
                      screencast is up, the inline interactive
                      takeover already handles the login flow inside
                      the panel.
                    The button confirms the login URL before opening
                    a new tab so the user can complete the login flow
                    on the live site, then come back and reply to the
                    task. */}
                {awaitingKind === 'login' &&
                  !frame &&
                  persistedFinalUrl && (
                    <SafeExternalLinkButton
                      href={persistedFinalUrl}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#FFC910]/60 bg-[#FFC910]/10 px-2.5 py-1 text-[11px] font-medium text-[#57479C] hover:bg-[#FFC910]/15 dark:border-[#FFC910]/35 dark:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                      在新标签打开登录页
                    </SafeExternalLinkButton>
                  )}
              </div>
            </div>
          )}
          <div
            ref={screencastHostRef}
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 items-center',
              isSheet ? 'justify-start overflow-auto' : 'justify-center overflow-hidden',
              fullscreen || (useVnc && !isSheet) ? 'p-0' : isSheet ? 'p-1' : 'p-3',
              'bg-[#F6F7F9] dark:bg-white/[0.03]',
            )}
          >
            {showTerminalEvidence && finalEvidenceFrame && terminalEvidence ? (
              <TerminalEvidenceView
                frame={finalEvidenceFrame}
                source={terminalEvidence.source}
                taskStatus={taskStatus}
                isSheet={isSheet}
                isNarrow={isNarrow}
                fullscreen={fullscreen}
                onToggleFullscreen={onToggleFullscreen}
                onReExecute={onReExecute}
                reExecuting={reExecuting}
                onRestoreSession={
                  terminalCanRestore
                    ? () => restoreTerminalSession(true)
                    : undefined
                }
              />
            ) : hibernated ? (
              <HibernationCard
                lastFrame={displayFrame}
                onWake={onWake}
                waking={waking}
              />
            ) : useVnc ? (
              <div
                className={cn(
                  'relative h-full min-h-0 min-w-0',
                  isSheet ? 'shrink-0' : 'w-full',
                  isSheet ? 'overflow-auto' : 'overflow-hidden',
                )}
                style={
                  isSheet
                    ? {
                        // noVNC handles its own internal canvas scale.
                        // In a portrait sheet, giving it only the
                        // phone-width container forces desktop pages
                        // into a tiny full-page thumbnail. Mirror the
                        // CDP/JPEG readable mode by letting the VNC
                        // surface own a wider virtual canvas and scroll.
                        width: 'min(1280px, max(100%, 300dvw))',
                      }
                    : undefined
                }
              >
                {usingCdp ? (
                  <CdpScreencastViewport
                    wsUrl={screencastUrlForCdp}
                    streamToken={streamToken}
                    reconnectSignal={reconnectEpoch}
                    viewOnly={!interactiveActive}
                    fitMode={isSheet ? 'readable' : 'contain'}
                    onStatusChange={(s: CdpScreencastStatus) =>
                      // Reuse the VNC status state — the enum values
                      // overlap exactly so the existing
                      // "connecting…" / hibernation banners just work.
                      handleVncStatus(s as VncStatus)
                    }
                    onUrlChange={onCdpUrlChange}
                    onFrameReady={handlePresentedLiveFrame}
                    className={cn(
                      isSheet && 'rounded-md border shadow-[0_1px_3px_rgba(17,24,39,0.06)]',
                      interactiveActive
                        ? fullscreen
                          ? 'border-black/[0.06]'
                          : 'ring-1 ring-inset ring-[#EA1F59]/25'
                        : isSheet && 'border-black/[0.06]',
                    )}
                  />
                ) : (
                  <VncViewport
                    // Codex Pack B2 — same reconnect-via-remount key.
                    key={`vnc-${reconnectEpoch}`}
                    wsUrl={vncUrl}
                    viewOnly={!interactiveActive}
                    onStatusChange={handleVncStatus}
                    fitMode={isSheet ? 'readable' : 'contain'}
                    className={cn(
                      isSheet && 'rounded-md border shadow-[0_1px_3px_rgba(17,24,39,0.06)]',
                      interactiveActive
                        ? fullscreen
                          ? 'border-black/[0.06]'
                          : 'ring-1 ring-inset ring-[#EA1F59]/25'
                        : isSheet && 'border-black/[0.06]',
                    )}
                  />
                )}
              </div>
            ) : !taskIsTerminal && frame ? (
              isBlankUrl(frame.url) ? (
                <div className="text-center text-xs text-muted-foreground/80">
                  等待浏览器加载页面...
                </div>
              ) : (
                /* JPEG fallback path: keep the wrapper shrinkable
                   and let fitScreencastImg write exact contained
                   pixel dimensions on the image. That avoids the
                   source frame's intrinsic width leaking through
                   flex layout during side-panel resize. */
                <div
                  className={cn(
                    'relative min-h-0 min-w-0',
                    isSheet ? 'shrink-0' : 'max-h-full max-w-full',
                  )}
                >
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard capture is handled via window listener in interactive mode */}
                  {/* BUG-11 final — width/height set imperatively in
                      `fitScreencastImg` (pure JS, pixel values).
                      The wrapper has no width because the img owns
                      its computed dims; flex centering on the
                      content-area handles positioning. */}
                  <img
                    ref={imgRef}
                    src={`data:image/jpeg;base64,${frame.imageBase64}`}
                    alt={`screencast tick ${frame.tickIndex + 1}`}
                    onClick={onClick}
                    onWheel={onWheel}
                    onLoad={fitScreencastImg}
                    draggable={false}
                    className={cn(
                      'block rounded-md border shadow-[0_1px_3px_rgba(17,24,39,0.06)]',
                      interactiveActive
                        ? fullscreen
                          ? 'cursor-pointer border-black/[0.06]'
                          : 'cursor-pointer border-[#EA1F59]/30 ring-1 ring-[#EA1F59]/10'
                        : 'border-black/[0.06]',
                    )}
                  />
                  {ripple && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#EA1F59]/70 animate-click-pulse"
                      style={{ left: ripple.x, top: ripple.y }}
                    />
                  )}
                  {activityVisible && recentSteps.length > 0 && (
                    <ActivityOverlay
                      steps={recentSteps}
                      compact={isSheet}
                      onClose={() => setActivityVisible(false)}
                    />
                  )}
                  {!activityVisible && recentSteps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActivityVisible(true)}
                      className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
                      aria-label="显示操作日志"
                      title="显示操作日志"
                    >
                      <ListChecks className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  {/* Codex P2 — hidden CJK input is always-mounted in
                      interactive mode. It captures composition events
                      so typing 中文 via the user's local IME goes via
                      `compositionend → insert_text` instead of being
                      shredded into pinyin letters by the window
                      keydown listener. Visible CjkInputBar is now a
                      fallback the user can opt into via the small
                      toggle button when the hidden path doesn't
                      cooperate with their IME / browser. */}
                  {interactiveActive && (
                    <HiddenCjkInput
                      ref={hiddenCjkInputRef}
                      composingRef={cjkComposingRef}
                      sendInsertText={sendInsertText}
                      sendInput={sendInput}
                    />
                  )}
                  {interactiveActive && !cjkFallbackOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setCjkFallbackOpen(true);
                        // Drop focus from the hidden input so the
                        // visible bar can take over.
                        hiddenCjkInputRef.current?.blur();
                      }}
                      className={cn(
                        'absolute left-2 z-30 inline-flex h-8 w-8 items-center justify-center rounded bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60',
                        fullscreen ? 'bottom-4' : 'bottom-2',
                      )}
                      aria-label="切换输入方式"
                      title="切换输入方式（当 IME 直打不工作时使用浮动输入框）"
                    >
                      <Keyboard className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  {interactiveActive && cjkFallbackOpen && (
                    <CjkInputBar
                      onSend={sendInsertText}
                      fullscreen={fullscreen}
                      onClose={() => setCjkFallbackOpen(false)}
                    />
                  )}
                </div>
              )
            ) : (
              <EmptyBrowserState
                taskStatus={taskStatus}
                isBrowserTask={isBrowserTask}
                workspaceIdle={workspaceIdle}
                finalUrl={persistedFinalUrl}
                hasSavedScreenshot={Boolean(activeTask?.finalScreenshot)}
                onReopenFinalUrl={onStartWorkspaceTask}
                onReExecute={onReExecute}
                reExecuting={reExecuting}
              />
            )}
            {useVnc && showLiveOverlay && (
              <div
                role="status"
                aria-live="polite"
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/45 px-4 text-xs text-muted-foreground backdrop-blur-[2px] dark:bg-background/45"
              >
                <div className="pointer-events-none flex w-full max-w-[280px] flex-col items-center rounded-[18px] border border-[#E6E7EB] bg-white/90 px-5 py-4 text-center shadow-[0_18px_44px_rgba(17,24,39,0.10)] dark:border-white/10 dark:bg-card/90">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#42C0EF]/12 text-[#118AB2] dark:text-[#42C0EF]">
                    <Globe className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="font-semibold text-foreground">{liveOverlayCopy.title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {liveOverlayCopy.detail}
                  </div>
                </div>
                {showReconnect && (
                  <button
                    type="button"
                    onClick={handleManualReconnect}
                    aria-label={liveOverlayCopy.reconnectLabel}
                    title={liveOverlayCopy.reconnectLabel}
                    className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-[#DCDDDD] bg-white px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-card dark:hover:bg-white/10"
                  >
                    <RotateCw className="h-3 w-3" />
                    {liveOverlayCopy.reconnectLabel}
                  </button>
                )}
              </div>
            )}
            {useVnc &&
              hasPresentedLiveFrame &&
              showReconnect &&
              vncStatus !== 'connected' && (
              <div
                role="status"
                aria-live="polite"
                className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-[9px] border border-[#DCDDDD] bg-white/95 py-1 pl-2.5 pr-1 text-[11px] text-muted-foreground shadow-[0_4px_16px_rgba(17,24,39,0.10)] backdrop-blur dark:border-white/10 dark:bg-card/95"
              >
                <span className="truncate">连接恢复较慢，接管状态已保留</span>
                <button
                  type="button"
                  onClick={handleManualReconnect}
                  aria-label={liveOverlayCopy.reconnectLabel}
                  title={liveOverlayCopy.reconnectLabel}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2 font-medium text-foreground transition-colors hover:bg-foreground/5"
                >
                  <RotateCw className="h-3 w-3" aria-hidden />
                  重连
                </button>
              </div>
            )}
            {useVnc && activityVisible && recentSteps.length > 0 && (
              <ActivityOverlay
                steps={recentSteps}
                compact={isSheet}
                onClose={() => setActivityVisible(false)}
              />
            )}
            {useVnc && !activityVisible && recentSteps.length > 0 && (
              <button
                type="button"
                onClick={() => setActivityVisible(true)}
                className="absolute bottom-2 right-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
                aria-label="显示操作日志"
                title="显示操作日志"
              >
                <ListChecks className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {useVnc && inputFallbackMode === 'toggle' && (
              <button
                type="button"
                onClick={() => setCjkFallbackOpen(true)}
                className="absolute bottom-3 left-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-white/20 bg-black/45 text-white shadow-sm backdrop-blur transition-colors hover:bg-black/60"
                aria-label="打开文字输入辅助"
                title="文字输入辅助"
              >
                <Keyboard className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {useVnc && inputFallbackMode === 'bar' && (
              <CjkInputBar
                onSend={sendInsertText}
                fullscreen={fullscreen}
                onClose={usingCdp ? () => setCjkFallbackOpen(false) : undefined}
              />
            )}
          </div>
          {liveBrowserCanPan && !terminalSessionUnavailable && !hibernated && !interactiveActive && !showLiveOverlay && (
            <div className="pointer-events-none absolute left-1/2 top-20 z-20 max-w-[calc(100%-1rem)] -translate-x-1/2 truncate rounded-full bg-black/45 px-3 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur">
              左右滑动查看页面
            </div>
          )}
          {!fullscreen && useVnc && showHeader && (
            <footer
              className={cn(
                'flex items-center justify-between border-t bg-white/78 text-muted-foreground backdrop-blur dark:bg-background/75',
                isSheet ? 'h-7 px-2 text-[11px]' : 'h-7 px-3 text-[11px]',
                BROWSER_DIVIDER,
              )}
            >
              <span>
                {browserViewportFooterLabel({
                  usingCdp,
                  viewport: displayFrame?.viewport,
                })}
              </span>
              <span>{vncStatus === 'connected' ? '画面实时同步' : ''}</span>
            </footer>
          )}
        </>
      )}
    </section>
  );
  if (isSheet) {
    return (
      <>
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-sm animate-fade-in motion-reduce:animate-none"
        />
        {section}
      </>
    );
  }
  return section;
}

function TerminalEvidenceView({
  frame,
  source,
  taskStatus,
  isSheet,
  isNarrow,
  fullscreen,
  onToggleFullscreen,
  onReExecute,
  reExecuting,
  onRestoreSession,
}: {
  frame: UiScreencast;
  source: TerminalEvidenceScreenshotSource;
  taskStatus: UiTaskStatus | null | undefined;
  isSheet: boolean;
  isNarrow: boolean;
  fullscreen: boolean;
  onToggleFullscreen?: () => void;
  onReExecute?: () => void;
  reExecuting: boolean;
  onRestoreSession?: () => Promise<boolean>;
}): JSX.Element {
  const [viewMode, setViewMode] = React.useState<'contain' | 'readable'>(
    'contain',
  );
  const [naturalSize, setNaturalSize] = React.useState<{
    width: number;
    height: number;
  } | null>(null);

  React.useEffect(() => {
    setViewMode('contain');
    setNaturalSize(null);
  }, [frame.imageBase64]);

  const sourceWidth = naturalSize?.width || frame.viewport.width;
  const sourceHeight = naturalSize?.height || frame.viewport.height;
  const sourceAspect =
    sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : null;
  const layout = terminalEvidenceLayout({
    isNarrow,
    isSheet,
    fullscreen,
    sourceAspect,
    viewMode,
  });
  const compactPreview = layout === 'compact-preview';
  const safeFinalUrl = safeExternalHttpHref(frame.url);
  const continuation = terminalEvidenceContinuation(safeFinalUrl);
  const [continuing, setContinuing] = React.useState(false);
  const title = terminalEvidenceFrameLabel({
    status: taskStatus,
    url: frame.url,
  });
  const screenshotCopy =
    source === 'saved-screenshot'
      ? '任务结束时保存的只读截图'
      : '任务结束前最后可见的只读截图';
  const restoreSession = async (): Promise<void> => {
    if (!continuation || !onRestoreSession || continuing) return;
    setContinuing(true);
    try {
      await onRestoreSession();
    } finally {
      setContinuing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-white dark:bg-background">
      {shouldShowTerminalEvidenceLedger(fullscreen) && (
        <div className={cn('shrink-0 border-b bg-white/96 dark:bg-background/95', BROWSER_DIVIDER)}>
          <div className={cn('flex min-w-0 items-start gap-2', isSheet ? 'px-3 pb-2 pt-3' : 'px-3 py-2.5')}>
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#42C0EF]/12 text-[#118AB2] dark:text-[#42C0EF]">
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12px] font-semibold text-foreground">
                  终态截图 · 只读
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {title}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {screenshotCopy}，不能点击或输入；结果中的判断仍以来源和任务上下文为准。
              </p>
            </div>
            {safeFinalUrl && !isSheet && (
              <SafeExternalLinkButton
                href={safeFinalUrl}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] border border-[#DCDDDD] bg-white px-2 text-[11px] font-medium text-[#595757] transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/60 dark:border-white/10 dark:bg-transparent dark:text-foreground/80 dark:hover:bg-white/10"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                外部打开
              </SafeExternalLinkButton>
            )}
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2 border-t border-[#DCDDDD]/60 px-3 py-1.5 dark:border-white/10">
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {viewMode === 'contain' ? '按比例适应窗口' : '原始尺寸，可滑动查看'}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {continuation && onRestoreSession && (
                <button
                  type="button"
                  onClick={() => void restoreSession()}
                  disabled={continuing}
                  aria-label={
                    continuing ? continuation.pendingLabel : continuation.label
                  }
                  title={continuation.description}
                  className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#DCDDDD] bg-white px-2 text-[11px] font-medium text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/60 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
                >
                  <Globe
                    className={cn('h-3 w-3', continuing && 'animate-pulse')}
                    aria-hidden
                  />
                  {continuing ? continuation.pendingLabel : continuation.label}
                </button>
              )}
              {isSheet && (
                <button
                  type="button"
                  onClick={() =>
                    setViewMode((mode) =>
                      mode === 'contain' ? 'readable' : 'contain',
                    )
                  }
                  aria-label={
                    viewMode === 'contain' ? '按原始尺寸查看' : '适应窗口查看'
                  }
                  className="inline-flex h-7 items-center rounded-[8px] border border-[#DCDDDD] bg-white px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-[#EFEFEF]/60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
                >
                  {viewMode === 'contain' ? '原始尺寸' : '适应窗口'}
                </button>
              )}
              {!isSheet && onToggleFullscreen && (
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  aria-label="全屏查看任务截图"
                  title="全屏查看任务截图"
                  className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#DCDDDD] bg-white px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-[#EFEFEF]/60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
                >
                  <Maximize2 className="h-3 w-3" aria-hidden />
                  全屏查看
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative min-h-0 min-w-0 bg-[#F6F7F9] dark:bg-white/[0.03]',
          compactPreview
            ? 'shrink-0 overflow-hidden'
            : viewMode === 'readable'
              ? 'flex-1 overflow-auto'
              : 'flex flex-1 items-center justify-center overflow-hidden',
        )}
        style={
          compactPreview && sourceAspect
            ? { aspectRatio: String(sourceAspect) }
            : undefined
        }
      >
        <div
          className={cn(
            'relative',
            compactPreview
              ? 'h-full w-full'
              : viewMode === 'readable'
                ? 'shrink-0'
                : 'flex h-full w-full items-center justify-center',
          )}
          style={
            viewMode === 'readable' && sourceWidth > 0 && sourceHeight > 0
              ? { width: sourceWidth, height: sourceHeight }
              : undefined
          }
        >
          <img
            src={`data:image/jpeg;base64,${frame.imageBase64}`}
            alt="任务完成时的浏览器画面"
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                setNaturalSize({
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                });
              }
            }}
            className={cn(
              'block border-0 object-contain',
              compactPreview || viewMode === 'readable'
                ? 'h-full w-full'
                : 'max-h-full max-w-full',
            )}
          />
          {!isSheet && compactPreview && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 flex min-w-0 items-center justify-between gap-2 rounded-[7px] bg-black/55 px-2 py-1 text-[10px] text-white backdrop-blur">
              <span className="truncate">{title}</span>
              {safeFinalUrl && (
                <span className="max-w-[52%] truncate font-mono opacity-80">
                  {frame.url}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {!fullscreen && (
        <div className={cn('flex shrink-0 min-w-0 items-center gap-2 border-t bg-white/96 px-3 py-2 text-[11px] dark:bg-background/95', BROWSER_DIVIDER)}>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {title}
          </span>
          {safeFinalUrl && isSheet && (
            <SafeExternalLinkButton
              href={safeFinalUrl}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#DCDDDD] bg-white text-foreground transition-colors hover:bg-[#EFEFEF]/60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
              ariaLabel="打开最终页面"
              title="打开最终页面"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </SafeExternalLinkButton>
          )}
          {onReExecute && (
            <button
              type="button"
              onClick={onReExecute}
              disabled={reExecuting}
              aria-label={reExecuting ? '正在重新执行任务' : '重新执行任务'}
              title={reExecuting ? '正在重新执行' : '重新执行'}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#DCDDDD] bg-white text-foreground transition-colors hover:bg-[#EFEFEF]/60 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
            >
              <RotateCw
                className={cn('h-3.5 w-3.5', reExecuting && 'animate-spin')}
                aria-hidden
              />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Floating activity overlay on the bottom of the screencast image.
 * Shows up to 3 most-recent non-terminal actions so users can see the
 * agent narrate its work without reading the left-panel step stream.
 */
function ActivityOverlay({
  steps,
  compact = false,
  onClose,
}: {
  steps: UiStep[];
  compact?: boolean;
  onClose: () => void;
}): JSX.Element {
  const visibleSteps = compact ? steps.slice(-1) : steps;
  return (
    <div
      className={cn(
        'pointer-events-none absolute rounded-md bg-black/55 text-white backdrop-blur-md',
        compact
          ? 'inset-x-1 bottom-1 px-2.5 py-1.5 text-[11px]'
          : 'inset-x-2 bottom-2 px-3 py-2 text-[11px]',
      )}
    >
      <div
        className={cn(
          'pointer-events-auto flex items-center justify-between uppercase tracking-wider text-white/70',
          compact ? 'mb-1 text-[10px]' : 'mb-1 text-[10px]',
        )}
      >
        <span>最近操作</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-white/10"
          aria-label="收起操作日志"
          title="收起操作日志"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <ul className="space-y-0.5 font-mono leading-snug">
        {visibleSteps.map((s) => (
          <li key={s.tickIndex} className="flex items-start gap-1.5">
            <span className="shrink-0 text-white/50">{activityGlyph(s.actionKind)}</span>
            <span className="min-w-0 flex-1 truncate">{summariseAction(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CJK input bar. Floats at the bottom of the panel viewport when
 * interactive mode is on. The Brave on Xvfb has no IME (fcitx5 /
 * ibus aren't installed in the per-user data-dir image), so users
 * type Chinese in their LOCAL OS IME, hit 发送 / Enter, and we ship
 * the composed text via `client.vision.user_input` kind=insert_text.
 * Server side it lands as `page.keyboard.insertText(text)` —
 * atomic, bypasses keystroke simulation.
 *
 * Caller is responsible for clicking the target input first (the
 * insert lands in whatever has focus on the remote page). The bar
 * deliberately doesn't try to manage focus: the user already
 * clicked through VNC to focus, this is just the typing channel.
 */
/**
 * Codex P2 follow-up — invisible-but-focusable input that hosts the
 * browser-native IME composition. Auto-focused on canvas click (see
 * `onClick` handler in the BrowserPanel body). When the user types
 * via their local IME:
 *   - compositionstart → flip the composing flag so the window
 *     keydown listener doesn't double-dispatch
 *   - compositionend   → fire `sendInsertText` with the finalised text
 *
 * For non-composing keystrokes we still replicate the window
 * keydown listener's named-key + printable-char dispatch so a
 * canvas-focused user can type ASCII without needing window-level
 * focus. The window listener already skips when target is an INPUT,
 * so there is no double-dispatch.
 */
const HiddenCjkInput = React.forwardRef<
  HTMLInputElement,
  {
    composingRef: React.MutableRefObject<boolean>;
    sendInsertText: (text: string) => void;
    sendInput: (payload: Omit<UserInputEvent, 'type' | 'taskId'>) => void;
  }
>(function HiddenCjkInput({ composingRef, sendInsertText, sendInput }, ref): JSX.Element {
  // Empty controlled input that we wipe after every compositionend.
  // Keeping it controlled makes React happy about the change events
  // without affecting visible state.
  const [, setValue] = React.useState('');
  return (
    <input
      ref={ref}
      type="text"
      tabIndex={-1}
      aria-hidden
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      // Invisible to the user but focusable + receives IME events.
      // Positioned in the canvas wrapper so it stays inside the
      // panel viewport (some browsers refuse focus on display:none
      // elements). `width: 1px` keeps the cursor caret invisible.
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const text =
          e.data ?? (e.target as HTMLInputElement).value ?? '';
        if (text) sendInsertText(text);
        // Wipe local + DOM value so the next composition starts fresh.
        setValue('');
        const el = e.target as HTMLInputElement;
        el.value = '';
      }}
      onKeyDown={(e) => {
        // While composing, the IME owns the keystroke. Don't dispatch.
        if (composingRef.current || e.nativeEvent.isComposing) return;
        const named = NAMED_KEYS[e.key];
        if (named) {
          e.preventDefault();
          const chord = [
            e.ctrlKey && 'ctrl',
            e.metaKey && 'meta',
            e.altKey && 'alt',
            e.shiftKey && 'shift',
            named,
          ]
            .filter(Boolean)
            .join('+');
          sendInput({ kind: 'key', key: chord });
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          sendInput({ kind: 'type', text: e.key });
        }
      }}
      onChange={(e) => setValue(e.target.value)}
    />
  );
});

function CjkInputBar({
  onSend,
  fullscreen,
  onClose,
}: {
  onSend: (text: string) => void;
  fullscreen: boolean;
  /** Codex P2 — when set, the bar is in "opt-in fallback" mode and
   *  shows a close button so users who toggled it on can dismiss it
   *  back to the default hidden-input flow. */
  onClose?: () => void;
}): JSX.Element {
  const [value, setValue] = React.useState('');
  const handleSend = (): void => {
    const t = value.trim();
    if (!t) return;
    onSend(t);
    setValue('');
  };
  return (
    <div
      className={cn(
        'pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur',
        fullscreen ? 'bottom-4' : 'bottom-2',
      )}
      style={{
        width: 'min(360px, calc(100% - 1rem))',
        maxWidth: 'calc(100% - 1rem)',
      }}
    >
      <input
        type="text"
        value={value}
        placeholder="中文 / 任意文本输入（先点击页面上的输入框获得焦点）"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter is reserved (no multi-line in this bar).
          // Also: stop propagation so the window-level keydown listener
          // (interactive ASCII forwarder) doesn't double-fire each keystroke.
          // Phase 4 R2 4c — composing-Enter guard so an IME commit
          // doesn't fire send mid-input.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSend();
          }
          e.stopPropagation();
        }}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/70"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!value.trim()}
        className={cn(
          'shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
          value.trim()
            ? 'bg-foreground text-background hover:bg-foreground/85'
            : 'bg-muted text-muted-foreground',
        )}
      >
        发送
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭浮动输入框"
          title="关闭浮动输入框（恢复直接输入）"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * P3 hibernation card. In the older per-user browser model this
 * could wake an idle Brave. Per-task browsers now only exist while a
 * task is running, so the card frames this as a connection check
 * instead of promising to resurrect a released browser.
 */
function HibernationCard({
  lastFrame,
  onWake,
  waking,
}: {
  lastFrame: UiScreencast | null;
  onWake: () => void;
  waking: boolean;
}): JSX.Element {
  const showLastFrame = lastFrame && !isBlankUrl(lastFrame.url);
  const releasedCopy = browserReleasedCardCopy();
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {showLastFrame && (
        <img
          src={`data:image/jpeg;base64,${lastFrame.imageBase64}`}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full rounded-md object-contain opacity-25"
        />
      )}
      {/* BOSS feedback — calmer language for the post-task state.
          Hibernation only fires after a task completes (gated on
          !activeTaskId upstream), so framing it as "任务已完成 ·
          浏览器已释放" is honest AND less alarming than "已休眠".
          Wake button demoted from black-CTA to muted text link so
          it doesn't compete with the final screenshot behind it. */}
      <div className={cn('relative flex flex-col items-center gap-2.5 rounded-lg px-6 py-4 backdrop-blur', BROWSER_SURFACE)}>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#42C0EF]/15 text-[#42C0EF]"
          aria-hidden
        >
          <Check className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">
            {releasedCopy.title}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {releasedCopy.detail}
          </div>
        </div>
        <button
          type="button"
          onClick={onWake}
          disabled={waking}
          aria-label={waking ? releasedCopy.checkingLabel : releasedCopy.checkLabel}
          title={waking ? releasedCopy.checkingLabel : releasedCopy.checkLabel}
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 transition-colors',
            waking
              ? 'cursor-wait text-muted-foreground'
              : 'text-muted-foreground hover:text-foreground hover:underline',
          )}
        >
          {waking ? `${releasedCopy.checkingLabel}…` : releasedCopy.checkLabel}
        </button>
      </div>
    </div>
  );
}

function EmptyBrowserState({
  taskStatus,
  isBrowserTask = true,
  workspaceIdle = false,
  finalUrl,
  hasSavedScreenshot = false,
  onReopenFinalUrl,
  onReExecute,
  reExecuting = false,
}: {
  taskStatus: UiTaskStatus | null | undefined;
  /**
   * P3 — when the active task does NOT need a browser (generate /
   * scrape / intake clarification), render the generic idle copy
   * instead of "等待第一帧…". The latter implies a Brave is about
   * to show a frame, but for a non-browser task no frame will ever
   * arrive. Default true preserves prior behaviour for callers
   * without active-task context.
   */
  isBrowserTask?: boolean;
  workspaceIdle?: boolean;
  finalUrl?: string | null;
  hasSavedScreenshot?: boolean;
  onReopenFinalUrl?: (intent: string) => Promise<boolean>;
  onReExecute?: () => void;
  reExecuting?: boolean;
}): JSX.Element {
  const [reopening, setReopening] = React.useState(false);
  if (taskStatus === 'executing' && isBrowserTask) {
    return (
      <div className={cn('flex max-w-[320px] flex-col items-center gap-2.5 rounded-[18px] px-6 py-5 text-center', BROWSER_SURFACE)}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EA1F59]/10 text-[#EA1F59]">
          <Globe className="h-4 w-4 animate-pulse-dot" aria-hidden />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">正在打开浏览器</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
            页面准备好后会自动显示在这里；你可以继续看左侧任务进度。
          </div>
        </div>
      </div>
    );
  }
  const terminal = taskStatus ? isTerminalStatus(taskStatus) : false;
  if (terminal && isBrowserTask) {
    const safeFinalUrl = safeExternalHttpHref(finalUrl);
    const canReopen = Boolean(safeFinalUrl && onReopenFinalUrl);
    const actionBusy = canReopen ? reopening : reExecuting;
    const actionLabel = canReopen
      ? reopening
        ? '正在重新打开…'
        : '重新打开页面'
      : reExecuting
        ? '重新执行中…'
        : '重新执行任务';
    const runAction = async (): Promise<void> => {
      if (actionBusy) return;
      if (safeFinalUrl && onReopenFinalUrl) {
        const intent = browserWorkspaceTaskIntent(safeFinalUrl);
        if (!intent) return;
        setReopening(true);
        try {
          await onReopenFinalUrl(intent);
        } finally {
          setReopening(false);
        }
        return;
      }
      onReExecute?.();
    };
    return (
      <div className={cn('flex w-full max-w-[360px] flex-col items-center px-7 py-6 text-center text-muted-foreground', BROWSER_SURFACE, 'rounded-lg')}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#42C0EF]/12 text-[#118AB2] dark:text-[#42C0EF]">
          <Globe className="h-5 w-5" aria-hidden />
        </div>
        <div className="mt-3 text-sm font-semibold text-foreground">
          浏览器会话已结束
        </div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          任务结果{hasSavedScreenshot ? '和页面截图' : ''}已保存在左侧。重新打开会启动新的浏览器，不会改写原任务记录。
        </div>
        {(canReopen || onReExecute) && (
          <button
            type="button"
            onClick={() => void runAction()}
            disabled={actionBusy}
            aria-label={actionLabel}
            title={actionLabel}
            className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md border border-[#DCDDDD] bg-white px-3 text-[12px] font-medium text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
          >
            <RotateCw className={cn('h-3.5 w-3.5', actionBusy && 'animate-spin')} />
            {actionLabel}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={cn('flex max-w-[340px] flex-col items-center px-6 py-5 text-center text-muted-foreground', BROWSER_SURFACE, 'rounded-[18px]')}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#42C0EF]/12 text-[#118AB2]">
        <Globe className="h-5 w-5" aria-hidden />
      </div>
      <div className="mt-3 text-sm font-semibold text-foreground">
        {workspaceIdle ? '输入网址开始浏览' : '浏览器工作区'}
      </div>
      <div className="mt-1 text-xs leading-relaxed">
        {workspaceIdle
          ? '在上方输入网址或搜索内容。HOLA DAY 会创建浏览任务，并在这里实时显示页面。'
          : '当任务需要打开网页、登录、验证或读取页面时，HOLA DAY 会在这里显示浏览器。'}
      </div>
      <div className="mt-3 rounded-full bg-[#EFEFEF]/80 px-3 py-1 text-[11px] text-[#595757] dark:bg-white/10 dark:text-foreground/70">
        {workspaceIdle ? '回车或点击箭头开始' : '支持观察进度和手动接管'}
      </div>
    </div>
  );
}

function SafeExternalLinkButton({
  href,
  className,
  children,
  ariaLabel,
  title,
}: {
  href: string | null | undefined;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
  title?: string;
}): JSX.Element | null {
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const safeHref = safeExternalHttpHref(href);
  if (!safeHref) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setPendingHref(safeHref)}
        className={className}
        aria-label={ariaLabel}
        title={title}
      >
        {children}
      </button>
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
          const target = pendingHref;
          setPendingHref(null);
          if (target) window.open(target, '_blank', 'noopener,noreferrer');
        }}
      />
    </>
  );
}

function activityGlyph(kind?: string): string {
  switch (kind) {
    case 'click':
    case 'click_ref':
      return '点';
    case 'type':
    case 'type_in_ref':
      return '输';
    case 'key':
    case 'press_key':
      return '⏎';
    case 'scroll':
      return '滚';
    case 'navigate':
      return '→';
    case 'wait':
      return '等';
    case 'wait_for_human':
      return '人';
    default:
      return '•';
  }
}

/**
 * Round-3 #9: the 最近操作 overlay no longer leaks raw tool names
 * (`computer`, `navigate`, `web_search`). If actionSummary is
 * present and not an identifier-looking string we use it; otherwise
 * we fall through to liveStatusLabel() which maps kind → Chinese
 * progress text ("正在操作浏览器…" etc.). Last-resort "步骤 N"
 * stays so the row is never empty.
 */
function summariseAction(step: UiStep): string {
  const s = step.actionSummary?.trim();
  if (s && !/^[a-z_][a-z0-9_]*$/.test(s)) return s;
  if (step.actionKind) return liveStatusLabel(step.actionKind);
  return `步骤 ${step.tickIndex + 1}`;
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
  kind: 'click' | 'scroll' | 'type' | 'key' | 'insert_text';
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

function StatusDot({
  status,
  label = browserPanelDotLabel(status),
}: {
  status: DotStatus;
  label?: string;
}): JSX.Element {
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        status === 'idle' && 'bg-muted-foreground/40',
        status === 'live' && 'animate-pulse-dot bg-[#42C0EF]',
        status === 'error' && 'bg-[#EA1F59]',
      )}
    />
  );
}

function BrowserIdentity({
  state,
  compact,
}: {
  state: BrowserPanelHeaderStatus;
  compact: boolean;
}): JSX.Element {
  const identityLabel = `HOLA DAY 浏览器 · ${state.tooltip}`;
  return (
    <span
      title={identityLabel}
      aria-label={identityLabel}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-[#E6E7EB] bg-white px-2 text-[12px] font-semibold text-[#111827] shadow-[0_1px_2px_rgba(17,24,39,0.03)] dark:border-white/10 dark:bg-white/5 dark:text-foreground"
    >
      <Globe className="h-3.5 w-3.5 text-[#118AB2] dark:text-[#42C0EF]" aria-hidden />
      {!compact && <span>浏览器</span>}
      <StatusDot status={state.dotStatus} label={state.tooltip} />
    </span>
  );
}

function BrowserConnectionChip({
  state,
  compact,
}: {
  state: BrowserPanelHeaderStatus;
  compact: boolean;
}): JSX.Element | null {
  if (!state.showLabel) return null;
  return (
    <span
      title={state.tooltip}
      aria-label={state.tooltip}
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-md border text-[11px] font-medium leading-none transition-colors',
        compact ? 'px-1.5' : 'px-2',
        state.tone === 'idle' &&
          'border-[#DCDDDD] bg-white/70 text-muted-foreground dark:border-white/10 dark:bg-white/5',
        state.tone === 'live' &&
          'border-[#42C0EF]/35 bg-[#42C0EF]/10 text-[#256D85] dark:border-[#42C0EF]/35 dark:text-[#9BDDF2]',
        state.tone === 'recovering' &&
          'border-[#FFC910]/55 bg-[#FFC910]/10 text-[#6A5B19] dark:border-[#FFC910]/35 dark:text-[#FFE17A]',
        state.tone === 'attention' &&
          'border-[#FFC910]/60 bg-[#FFC910]/15 text-[#57479C] dark:border-[#FFC910]/35 dark:text-foreground',
        state.tone === 'takeover' &&
          'border-[#EA1F59]/35 bg-[#EA1F59]/10 text-[#EA1F59]',
        state.tone === 'error' &&
          'border-[#EA1F59]/35 bg-[#EA1F59]/10 text-[#EA1F59]',
      )}
    >
      {state.label}
    </span>
  );
}

/**
 * Editable URL bar in the panel header. Mirrors a real browser's
 * address bar:
 *   - Renders the page's current URL (the prop wins on every prop
 *     change, so the agent's own navigations land here).
 *   - User typing replaces the displayed value locally; pressing
 *     Enter fires `tasks.browserNav.mutate({direction:'goto', url})`
 *     so the remote Brave navigates.
 *   - Escape reverts the local edit to the prop value.
 *   - Disabled appearance + cursor-not-allowed when there's no
 *     active page — typing here would error against `no_executor`.
 *
 * Compact ~24 px tall to fit in the existing 44 px header next to
 * the status dot and back/forward/reload buttons.
 */
function UrlBar({
  displayUrl,
  interactiveActive,
  navTaskId,
  readOnly = false,
  pendingTarget = false,
  onLaunchTask,
}: {
  displayUrl: string;
  interactiveActive: boolean;
  /**
   * F3 — when the panel is showing a specific task's screencast,
   * its taskId is passed here so the goto navigation routes to
   * that exact pool instance (not just the user's most-recent
   * Brave). Null = explicit "browser live" mode (no task picked);
   * backend falls through to peekActiveForUser.
   */
  navTaskId: string | null;
  readOnly?: boolean;
  /** Requested destination shown before the first observed page URL arrives. */
  pendingTarget?: boolean;
  /** Shell-level mode: create a task-owned browser instead of navigating a missing executor. */
  onLaunchTask?: (intent: string) => Promise<boolean>;
}): JSX.Element {
  const toast = useToast();
  // Local editing state. Resync to the prop whenever the agent
  // navigates (or the user clicks back/forward) so the bar always
  // reflects the live page url unless the user is mid-edit.
  const [draft, setDraft] = React.useState(displayUrl);
  const [editing, setEditing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const mountedRef = React.useRef(false);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (!editing) setDraft(displayUrl);
  }, [displayUrl, editing]);
  const normalizedDraft = draft.trim().toLowerCase();
  const isSecurePage = normalizedDraft.startsWith('https://');
  const isPageUrl =
    normalizedDraft.startsWith('https://') ||
    normalizedDraft.startsWith('http://');
  const UrlIcon = pending || pendingTarget ? RotateCw : isSecurePage ? LockKeyhole : Globe;

  const submit = async (): Promise<void> => {
    if (readOnly) return;
    if (pending) return;
    const target = draft.trim();
    if (!target || (!onLaunchTask && target === displayUrl)) {
      setEditing(false);
      return;
    }
    setPending(true);
    try {
      if (onLaunchTask) {
        const intent = browserWorkspaceTaskIntent(target);
        if (!intent) {
          toast.show('请输入网址或搜索内容；不支持 file、data、javascript 等地址', 'error');
          return;
        }
        const started = await onLaunchTask(intent);
        if (mountedRef.current && started) setDraft('');
        return;
      }
      const res = await trpc.tasks.browserNav.mutate({
        direction: 'goto',
        url: target,
        ...(navTaskId ? { taskId: navTaskId } : {}),
      });
      if (!mountedRef.current) return;
      if (!res.ok) {
        const message = browserNavFailureMessage(res.reason, 'goto');
        if (message) toast.show(message, 'error');
        setDraft(displayUrl);
      }
    } catch (err) {
      toast.show(browserNavExceptionMessage(err, 'goto'), 'error');
      if (mountedRef.current) {
        setDraft(displayUrl);
      }
    } finally {
      if (mountedRef.current) {
        setPending(false);
        setEditing(false);
      }
    }
  };

  return (
    <div
      className={cn(
        'group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] border px-2 transition-colors',
        'border-[#E6E7EB] bg-[#F6F7F9] text-muted-foreground hover:border-[#DCDDDD] hover:bg-white',
        'focus-within:border-[#ADADAD] focus-within:bg-white focus-within:text-foreground',
        interactiveActive && 'border-[#EA1F59]/35 bg-[#EA1F59]/5',
        readOnly && 'bg-white/70',
        pending && 'cursor-wait opacity-75',
      )}
      title={pendingTarget ? `正在打开 ${draft}` : draft}
    >
      <UrlIcon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          (pending || pendingTarget) && 'animate-spin',
          isSecurePage && 'text-[#0F9F6E]',
          !isPageUrl && 'text-muted-foreground/70',
        )}
        aria-hidden
      />
      <input
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={draft}
        placeholder={onLaunchTask ? '输入网址或搜索内容' : '输入网址回车跳转'}
        readOnly={readOnly}
        onFocus={() => {
          if (!readOnly) setEditing(true);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          if (!readOnly) setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (readOnly) return;
          // Phase 4 R2 4c — composing-Enter guard. URL bar with a
          // Chinese-domain IME commit (e.g. typing 中文.com) used to
          // submit the partial composition.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            setDraft(displayUrl);
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={pending}
        aria-label={
          readOnly
            ? '浏览器最终地址'
            : onLaunchTask
              ? '浏览器启动栏 (输入网址或搜索内容，Enter 开始)'
              : pendingTarget
                ? '浏览器目标地址 (正在打开，尚未确认到达)'
              : '浏览器地址栏 (Enter 跳转, Esc 还原)'
        }
        className={cn(
          'h-full min-w-0 flex-1 truncate border-0 bg-transparent px-0 font-mono text-[11px] outline-none',
          'text-[#374151] placeholder:text-muted-foreground/70 disabled:cursor-wait',
          readOnly && 'cursor-default text-muted-foreground',
        )}
      />
      {onLaunchTask && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void submit()}
          disabled={pending || !draft.trim()}
          title="开始浏览"
          aria-label="开始浏览"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#EA1F59] text-white transition-colors hover:bg-[#D71950] disabled:cursor-not-allowed disabled:bg-[#DCDDDD] disabled:text-white"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Small 20x20 icon button that fires `tasks.browserNav` on the shared
 * Brave instance. The stream updates within a tick on success; failed
 * actions surface a small, specific toast instead of looking like a
 * dead button.
 */
function NavButton({
  direction,
  title,
  navTaskId,
}: {
  direction: 'back' | 'forward' | 'reload';
  title: string;
  /** F3 — same as UrlBar's navTaskId. Null falls through to user-pick. */
  navTaskId: string | null;
}): JSX.Element {
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const mountedRef = React.useRef(false);
  const Icon = direction === 'back' ? ArrowLeft : direction === 'forward' ? ArrowRight : RotateCw;
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={pending}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          const res = await trpc.tasks.browserNav.mutate({
            direction,
            ...(navTaskId ? { taskId: navTaskId } : {}),
          });
          if (!res.ok) {
            const message = browserNavFailureMessage(res.reason, direction);
            if (message) toast.show(message, 'error');
          }
        } catch (err) {
          toast.show(browserNavExceptionMessage(err, direction), 'error');
        } finally {
          if (mountedRef.current) {
            setPending(false);
          }
        }
      }}
      className={cn(
        BROWSER_TOOL_BUTTON,
        pending && 'opacity-50',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Optimization #3 R2 — fullscreen floating toolbar.
 *
 * In fullscreen takeover, BOSS reported the bare exit-button left
 * users stranded: they couldn't see the URL, couldn't go back, and
 * had to exit fullscreen to take over the page. The new toolbar
 * is a single horizontal bar floating at the TOP of the canvas
 * that mirrors the non-fullscreen header essentials.
 *
 * Auto-hide:
 *   - Visible by default (cold mount + cursor in-bar)
 *   - Hides 2.5s after pointer leaves so the canvas stays clean
 *     while watching the agent work
 *   - Cursor near top edge (< 56px) re-summons it
 *
 * Visible elements (left → right):
 *   - status dot
 *   - back / forward / reload
 *   - URL bar (read-only display; the same UrlBar component the
 *     header uses, so clipboard + edit-to-navigate behave
 *     identically)
 *   - browser ownership toggle (mirrors the header button)
 *   - stop button (when executing)
 *   - exit fullscreen
 *
 * Terminal evidence mode reuses the toolbar as a passive viewer while the
 * live browser is unavailable. Navigation and takeover return after the
 * current task's managed browser has been restored.
 */
function FullscreenFloatingToolbar({
  displayUrl,
  pendingTarget,
  status,
  interactiveActive,
  interactive,
  controlAction,
  onToggleInteractive,
  navTaskId,
  controlsEnabled,
  isExecuting,
  aborting,
  onStop,
}: {
  displayUrl: string;
  pendingTarget: boolean;
  status: BrowserPanelHeaderStatus;
  interactiveActive: boolean;
  interactive: boolean;
  controlAction: BrowserControlAction;
  onToggleInteractive: () => void;
  navTaskId: string | null;
  controlsEnabled: boolean;
  isExecuting: boolean;
  aborting: boolean;
  onStop: () => Promise<void> | void;
}): JSX.Element {
  const [visible, setVisible] = React.useState(true);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleHide = React.useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), 2_500);
  }, []);
  const cancelHide = React.useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);
  // Re-summon on cursor near top edge.
  React.useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (e.clientY < 56) setVisible(true);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  React.useEffect(() => {
    if (!visible) return;
    scheduleHide();
    return () => cancelHide();
  }, [visible, scheduleHide, cancelHide]);
  React.useEffect(() => () => cancelHide(), [cancelHide]);
  return (
    <div
      onMouseEnter={() => {
        cancelHide();
        setVisible(true);
      }}
      onMouseLeave={scheduleHide}
      onFocus={() => {
        cancelHide();
        setVisible(true);
      }}
      // Codex Browser-UX #5 — when hidden, the toolbar still
      // intercepted clicks on the canvas because opacity:0 leaves
      // hit-testing intact. `pointer-events-none` while hidden
      // restores click-through to the page; visible state restores
      // pointer-events-auto via the conditional class below.
      className={cn(
        'absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-white/15 bg-black/55 px-2.5 py-1.5 shadow-2xl backdrop-blur-md transition-opacity duration-200',
        visible
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0 hover:opacity-100',
      )}
      style={{ minWidth: 'min(640px, 90%)', maxWidth: '90%' }}
    >
      <StatusDot status={status.dotStatus} label={status.tooltip} />
      <BrowserConnectionChip state={status} compact={false} />
      {controlsEnabled && (
        <>
          <NavButton direction="back" title="后退" navTaskId={navTaskId} />
          <NavButton direction="forward" title="前进" navTaskId={navTaskId} />
          <NavButton direction="reload" title="刷新" navTaskId={navTaskId} />
        </>
      )}
      <UrlBar
        displayUrl={displayUrl}
        interactiveActive={interactiveActive}
        navTaskId={navTaskId}
        readOnly={!controlsEnabled}
        pendingTarget={pendingTarget}
      />
      {isExecuting && navTaskId && (
        <button
          type="button"
          onClick={() => void onStop()}
          disabled={aborting}
          title="停止当前任务"
          aria-label="停止当前任务"
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors',
            aborting
              ? 'cursor-wait border-white/20 bg-white/10 text-white/60'
              : 'border-[#EA1F59]/35 bg-[#EA1F59]/15 text-white hover:bg-[#EA1F59]/25',
          )}
        >
          <Square className="h-3 w-3" strokeWidth={2.5} />
        </button>
      )}
      {controlsEnabled && (
        <button
          type="button"
          onClick={onToggleInteractive}
          title={controlAction.title}
          aria-label={controlAction.ariaLabel}
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10',
            interactive && 'bg-[#EA1F59]/35 text-white',
          )}
        >
          {interactive ? (
            <Bot className="h-3.5 w-3.5" />
          ) : (
            <Hand className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

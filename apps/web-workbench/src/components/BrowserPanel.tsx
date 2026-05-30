import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Hand,
  Keyboard,
  ListChecks,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Power,
  RotateCw,
  Square,
  X,
} from 'lucide-react';
import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  browserLiveOverlayCopy,
  browserPanelDotLabel,
  browserReleasedCardCopy,
  browserWakeFeedback,
  shouldShowBrowserHeader,
  terminalBrowserTakeoverMessage,
  terminalEvidenceStatusLabel,
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
  externalLinkConfirmDescription,
  safeExternalHttpHref,
} from '@/lib/external-link-copy';
import { hdDebug } from '@/lib/hd-debug';
import { trpc } from '@/lib/trpc';
import { useStreamToken } from '@/lib/use-stream-token';
import { send as wsSend } from '@/lib/ws';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';
import type { UiScreencast, UiStep, UiTaskStatus } from '@/types/task';
import { isTerminalStatus } from '@/types/task';
import { liveStatusLabel } from '@/utils/step-humanize';

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
const BROWSER_SURFACE =
  'border-[#DCDDDD] bg-white/95 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85';
const BROWSER_DIVIDER = 'border-[#DCDDDD]/80 dark:border-white/10';

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
 * Returns null when VNC is explicitly disabled via VITE_VNC_PATH.
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
  streamToken: string | null,
): string | null {
  if (typeof window === 'undefined') return null;
  const arg = activeTaskId ?? poolUserId;
  if (!arg) return null;
  if (!streamToken) return null;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/screencast-ws/${encodeURIComponent(
    arg,
  )}?token=${encodeURIComponent(streamToken)}`;
}

/**
 * Phase 19f — CDP is now the default. VNC is kept as a manual
 * fallback: set `localStorage.holaday.streamTransport='vnc'` and
 * reload to opt back in. The VNC path will be deleted in a
 * follow-up once CDP has soaked in prod.
 */
function readStreamTransport(): 'vnc' | 'cdp' {
  if (typeof window === 'undefined') return 'cdp';
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
  awaitingKind?: 'clarification' | 'login' | 'captcha' | 'permission' | 'browser_action';
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
}: Props): JSX.Element | null {
  // P2-A — only the non-clarification kinds need browser takeover.
  // Treat missing kind as `clarification` so older WS events / legacy
  // DB rows (NULL awaiting_kind) don't accidentally flash the verify
  // banner. The banner + auto-interactive used to fire for every
  // awaiting_user, including expert-workflow intake — that was the
  // BOSS-reported bug.
  const browserAwaiting =
    awaitingUser === true &&
    awaitingKind != null &&
    awaitingKind !== 'clarification';
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
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setIsNarrow(w > 0 && w < 500);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  // R7 — terminal-state evidence frame, synthesised from the
  // captured-pre-release screenshot persisted on the task row.
  // Lets the panel render the final-state image after refresh
  // instead of leaving an empty about:blank when the live Brave is
  // gone. Memoised so the synthetic UiScreencast keeps a stable
  // identity across renders (preventing the inner viewport's
  // useEffect from refiring).
  const activeTask = useTaskStore((s) =>
    activeTaskId ? s.tasks.find((t) => t.taskId === activeTaskId) ?? null : null,
  );
  const finalEvidenceFrame = React.useMemo<UiScreencast | null>(() => {
    if (!activeTask?.finalScreenshot) return null;
    return {
      tickIndex: -1,
      imageBase64: activeTask.finalScreenshot,
      url: activeTask.finalUrl ?? 'about:blank',
      viewport: { width: 0, height: 0 },
      timestamp: new Date().toISOString(),
    };
  }, [activeTask?.finalScreenshot, activeTask?.finalUrl]);
  const latestFrame = React.useMemo<UiScreencast | null>(() => {
    const all = Object.values(screencastByTask);
    if (all.length === 0) return null;
    // Latest by timestamp; string ISO compare is correct for
    // same-locale UTC ISO-8601.
    return all.reduce((best, cur) =>
      !best || cur.timestamp > best.timestamp ? cur : best,
    null as UiScreencast | null) ?? null;
  }, [screencastByTask]);
  // P1.1 — terminal task fall-through policy:
  //   1. If the task is terminal AND has captured evidence
  //      (finalEvidenceFrame), use ONLY that. Don't bleed
  //      another task's latestFrame into the panel.
  //   2. If the task is terminal WITHOUT evidence (legacy task,
  //      or capture failed), don't fall through to another task's
  //      latestFrame either — render the empty terminal state.
  //   3. For active tasks, prefer live `frame`, then any latest
  //      frame as a hint, then evidence (rare; would mean a task
  //      ended but isn't marked terminal here yet).
  // The previous "frame ?? finalEvidenceFrame ?? latestFrame" mixed
  // task A's frame into task B's panel after a task switch.
  const taskIsTerminal = taskStatus ? isTerminalStatus(taskStatus) : false;
  const displayFrame = taskIsTerminal
    ? finalEvidenceFrame
    : (frame ?? latestFrame ?? finalEvidenceFrame);
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
  const frameUrl =
    displayFrame?.url && !isBlankUrl(displayFrame.url)
      ? displayFrame.url
      : null;
  const [lastKnownUrl, setLastKnownUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    setLastKnownUrl(null);
  }, [activeTaskId]);
  React.useEffect(() => {
    if (frameUrl) setLastKnownUrl(frameUrl);
  }, [frameUrl]);
  // Optimization #3 R2 — live CDP URL from the streamer's
  // `Page.frameNavigated` event. Tracks user / agent navigation on
  // the remote browser in real time (clicking a link, JS pushState,
  // page reload). When set, takes priority over `persistedFinalUrl`
  // during EXECUTING — the live URL is fresher than `result.finalUrl`
  // (which only updates on terminal / park). On terminal status we
  // fall back to the persisted final URL so the address bar matches
  // the captured evidence frame.
  const [cdpLiveUrl, setCdpLiveUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    setCdpLiveUrl(null);
  }, [activeTaskId]);
  const onCdpUrlChange = React.useCallback((url: string) => {
    if (!url || isBlankUrl(url)) return;
    setCdpLiveUrl(url);
    setLastKnownUrl(url); // also feed the grace cache
  }, []);
  const terminalStatus = taskStatus ? isTerminalStatus(taskStatus) : false;
  const terminalEvidenceLabel = terminalEvidenceStatusLabel(taskStatus);
  const displayUrl = terminalStatus
    ? (persistedFinalUrl ?? cdpLiveUrl ?? frameUrl ?? lastKnownUrl ?? 'about:blank')
    : (cdpLiveUrl ?? frameUrl ?? persistedFinalUrl ?? lastKnownUrl ?? 'about:blank');
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

  // Phase 19 — pick the live-stream transport per user. The flag
  // is a localStorage opt-in (`holaday.streamTransport='cdp'`); the
  // default 'vnc' keeps the existing path unchanged until BOSS
  // verifies CDP screencast in prod. Read once on mount — flipping
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
  // Phase 24: completed/failed/cancelled tasks have had their per-task
  // Brave released — connecting to /screencast-ws/<taskId> would 409
  // and bounce through the noVNC retry/error loop. Compute taskTerminal
  // up front so the URL memo can short-circuit cleanly.
  const taskTerminal = taskStatus ? isTerminalStatus(taskStatus) : false;
  // Idle gate. The browser panel only connects when a selected task
  // actually owns a browser. The old no-active-task user-pool stream
  // was removed when HOLA DAY moved to per-task browsers.
  const hasActiveTask = Boolean(activeTaskId);
  // RC follow-up audit fix — generate / scrape tasks have NO pool
  // slot (no Brave allocated), so /screencast-ws/<taskId> 409s in a
  // loop and the user sees "实时画面断开，正在自动重连" cycling every ~5s
  // forever. Detect non-pool tasks via the streaming/progress
  // buffers (those types only ever populate for generate/scrape
  // runners) and skip the WS entirely. Browser tasks never populate
  // those buffers, so they keep working unchanged.
  const streamingForActive = useTaskStore((s) =>
    activeTaskId ? s.streamingByTask[activeTaskId] : undefined,
  );
  const progressForActive = useTaskStore((s) =>
    activeTaskId ? s.progressByTask[activeTaskId] : undefined,
  );
  const isNonPoolTask = Boolean(streamingForActive ?? progressForActive);
  // P3 — gate the panel on whether this task actually needs a browser.
  // Earlier code connected screencast for ANY active task, so a fresh
  // generate / intake task (no Brave allocated, never will be) showed
  // about:blank + URL bar + "第 1 帧" + Stop button — confusing. Now
  // we trust `activeTask.executionMode` first (set by the store from
  // tasks.detail's `result.executionMode` / `result.metadata.executionMode`,
  // or inferred from the first server.task.stream / progress event).
  // For the brief window before that lands, fall back to `!isNonPoolTask`
  // (i.e. no streaming buffer yet → could be browser, treat optimistic).
  const knownExecutionMode = activeTask?.executionMode;
  const isBrowserTask =
    knownExecutionMode != null
      ? knownExecutionMode === 'browser'
      : hasActiveTask && !isNonPoolTask;
  const shouldConnect = isBrowserTask;
  // Item 6 — short-lived stream token for screencast / VNC WS auth.
  // Refreshes every 45s; the WS URL gets rebuilt when token rotates,
  // which forces a benign reconnect (the connection itself doesn't
  // need re-auth, but the URL needs the latest token for the next
  // failed-connect retry). Skipped when neither path enabled the
  // panel — the hook drops its token and stops fetching.
  const { token: streamToken } = useStreamToken(shouldConnect);
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
    // Per-task pool: terminal tasks have no live Brave. Fall through
    // to the static frame fallback (last-frame JPEG) instead of
    // hammering the WS into 409s.
    if (activeTaskId && taskTerminal) return null;
    // RC audit fix — non-pool tasks (generate / scrape) never have
    // a /screencast-ws/<taskId> backend; skip the WS so the
    // disconnect banner doesn't flicker every 5 s.
    if (activeTaskId && isNonPoolTask) return null;
    return buildScreencastUrl(activeTaskId ?? null, poolUserId, streamToken);
  }, [activeTaskId, shouldConnect, poolUserId, usingCdp, taskTerminal, isNonPoolTask, streamToken]);
  // [HD-DEBUG] log every URL change (or change to/from null). Token
  // redacted so console dumps stay safe to share.
  React.useEffect(() => {
    hdDebug('screencast URL', {
      activeTaskId: activeTaskId ?? null,
      taskTerminal,
      isNonPoolTask,
      url: screencastUrlForCdp
        ? screencastUrlForCdp.replace(/token=[^&]+/, 'token=…')
        : null,
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
  // Phase 24: switching tasks must reset the attempt counter so a
  // prior task's stale failures don't pop the hibernation card on a
  // freshly-selected, freshly-running task.
  React.useEffect(() => {
    setVncAttemptFails(0);
    setVncStatus('idle');
  }, [activeTaskId]);
  const handleVncStatus = React.useCallback((status: VncStatus) => {
    setVncStatus(status);
    setVncAttemptFails((n) => {
      if (status === 'connected') return 0;
      if (status === 'disconnected' || status === 'error') return n + 1;
      return n;
    });
  }, []);
  // Codex Pack B2 — long-connecting reconnect affordance. The viewer
  // sits in `connecting` state when noVNC is still finishing its TLS
  // handshake / RFB protocol negotiation. Usually 1-3s; if it drags
  // past 5s, surface a "重新连接" button so the user can force a
  // fresh WS attempt instead of staring at the placeholder text.
  // Tracked separately from `vncAttemptFails` (which counts
  // disconnected/error, not slow-connect).
  const [showReconnect, setShowReconnect] = React.useState(false);
  const [reconnectEpoch, setReconnectEpoch] = React.useState(0);
  React.useEffect(() => {
    if (vncStatus === 'connected') {
      setShowReconnect(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReconnect(true), 5000);
    return () => window.clearTimeout(timer);
  }, [vncStatus, reconnectEpoch]);
  const handleManualReconnect = React.useCallback(() => {
    setShowReconnect(false);
    setVncStatus('idle');
    setVncAttemptFails(0);
    setReconnectEpoch((n) => n + 1);
    toast.show('正在重新连接实时画面', 'info');
  }, [toast]);
  const liveOverlayCopy = browserLiveOverlayCopy({
    status: vncStatus,
    showReconnect,
  });
  const showLiveOverlay =
    vncStatus === 'idle' ||
    vncStatus === 'connecting' ||
    ((vncStatus === 'disconnected' || vncStatus === 'error') && showReconnect);
  // RC audit fix — banner grace period. The "实时画面断开，正在自动重连"
  // banner used to flip ON instantly when the WS closed, and stay on
  // for the entire backoff window (up to 5 s). For transient closes
  // (network jitter, CDP frame stalls) the banner would flash on/off
  // a few times during a healthy stream. Defer the visible flag by
  // 1.5 s so a fast reconnect leaves no banner trail.
  const [showDisconnectBanner, setShowDisconnectBanner] = React.useState(false);
  React.useEffect(() => {
    if (vncStatus !== 'disconnected') {
      setShowDisconnectBanner(false);
      return;
    }
    const timer = setTimeout(() => setShowDisconnectBanner(true), 1500);
    return () => clearTimeout(timer);
  }, [vncStatus]);
  // Phase 24: hibernation is a userId-pool concept (idle GC after
  // 5min). Per-task pool has no hibernation — terminal task = static
  // frame, executing task = retry forever. Only fire the hibernation
  // card on the LEGACY userId-scoped panel state (no task selected).
  // This prevents the "浏览器已休眠" flicker BOSS reported on both
  // executing tasks (transient WS hiccups) and terminal tasks (Brave
  // released after task end).
  const hibernated = poolUserId != null && vncAttemptFails >= 3 && !activeTaskId;
  // P3 wake/check call. Per-task browsers cannot be resurrected once
  // released, so the endpoint may report "unavailable"; surface that
  // clearly instead of silently returning to the same card.
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
  // Round-3 #5 (legacy): completed / failed / cancelled tasks used
  // to switch to the static JPEG screencast — the rationale was
  // that the SHARED singleton Brave would have moved on to another
  // user's task, so the live VNC frame wouldn't match the task the
  // user was inspecting. With per-user pool browsers (poolUserId
  // set) that's no longer true: the user's Brave only renders THEIR
  // tasks, so a "completed task" frame on the live VNC IS still the
  // correct frame. Keeping VNC live also lets users use HOLA DAY's
  // browser as a remote desktop after the agent finishes — exactly
  // the China-edge product premise.
  // (taskTerminal hoisted above the screencast-URL memo so it can
  // short-circuit terminal-task connections at the URL layer.)
  // When CDP is the active transport, "useVnc" still gates the
  // canvas-vs-frame branch but the inner viewport renders
  // CdpScreencastViewport. The flag stays the same name to keep
  // the existing render-tree branching unchanged.
  const useVnc = usingCdp
    ? Boolean(screencastUrlForCdp) && (poolUserId != null || !taskTerminal)
    : Boolean(vncUrl) &&
      vncStatus !== 'error' &&
      (poolUserId != null || !taskTerminal);

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
    if (hostW <= 0 || hostH <= 0) return;
    const scale = Math.min(hostW / natW, hostH / natH);
    img.style.width = `${Math.round(natW * scale)}px`;
    img.style.height = `${Math.round(natH * scale)}px`;
  }, []);
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
  const interactiveActive = useVnc
    ? interactive && (vncStatus === 'connected' || vncStatus === 'connecting')
    : interactive && Boolean(frame) && !isBlankUrl(frame?.url);

  // BOSS-feedback follow-up — the blue "你正在直接操作浏览器" banner
  // was confusing average users because it appeared whenever the
  // agent parked on captcha / login (browserAwaiting auto-flipped
  // `interactive=true` in the effect below). Hide it unless the user
  // explicitly clicked the takeover toggle. The ref tracks intent
  // and resets when `interactive` flips back to false (next task).
  const userInteractedRef = React.useRef(false);
  const [showTakeoverBanner, setShowTakeoverBanner] = React.useState(false);
  React.useEffect(() => {
    userInteractedRef.current = false;
    setShowTakeoverBanner(false);
    setActivityVisible(true);
    setCjkFallbackOpen(false);
  }, [activeTaskId]);
  React.useEffect(() => {
    if (!interactive) {
      userInteractedRef.current = false;
      setShowTakeoverBanner(false);
    }
  }, [interactive]);
  const handleUserTakeoverClick = React.useCallback(() => {
    const next = !interactive;
    if (next) {
      // BUG-12 — per-task pool releases the Brave on completion /
      // failure / cancel. Flipping `interactive` true on a terminal
      // task drops the user into a red-bannered "live mode" over a
      // frozen static frame because `screencastUrlForCdp` is gated
      // null (line ~476) and there's no live Brave to attach to even
      // if it weren't. Refuse the takeover and direct the user to
      // start a fresh task — that's the only way to get a live
      // browser back under per-task pool semantics.
      if (taskTerminal) {
        toast.show(terminalBrowserTakeoverMessage(taskStatus), 'info');
        return;
      }
      userInteractedRef.current = true;
      setShowTakeoverBanner(true);
    } else {
      userInteractedRef.current = false;
      setShowTakeoverBanner(false);
    }
    setInteractive(next);
  }, [interactive, taskStatus, taskTerminal, setInteractive, toast]);

  // Codex P2 — hide the address bar / nav / takeover chrome when
  // the panel is open on a terminal task with no viewable evidence
  // (no live frame, no captured screenshot, no recent frame). The
  // toolbar's buttons can't do anything in that state; the panel
  // becomes a "no evidence saved" placeholder + re-execute prompt.
  // interactiveActive flips it back on if the user is mid-takeover
  // for some reason (shouldn't happen on terminal but defensive).
  const taskIsTerminalForHeader = taskStatus ? isTerminalStatus(taskStatus) : false;
  const showHeader = shouldShowBrowserHeader({
    taskIsTerminal: taskIsTerminalForHeader,
    hasCurrentFrame: Boolean(frame),
    hasFinalEvidence: Boolean(finalEvidenceFrame),
    interactiveActive,
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

  const isSheet = layout === 'sheet';
  const section = (
    <section
      ref={panelRootRef}
      data-narrow={isNarrow ? 'true' : 'false'}
      className={cn(
        'relative flex flex-col border-l border-[#DCDDDD] backdrop-blur-xl dark:border-white/10',
        isSheet
          ? 'fixed inset-x-0 bottom-0 z-[75] h-[75vh] rounded-t-lg border-t border-l-0 shadow-2xl animate-fade-in'
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
      {!isSheet && (
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
          className="absolute left-0 top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#DCDDDD] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.08)] hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-card"
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
          title="关闭浏览器抽屉"
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
          {/*
           * Fullscreen renders WITHOUT the header / footer / banners —
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
            // toggle, exit. Auto-hides 2.5s after the cursor leaves
            // so the canvas stays unobstructed while the user
            // watches the agent work; reappears on hover or focus.
            //
            // The bar sits at the TOP — covering the page title is
            // a smaller hit than covering action buttons at the
            // bottom of most sites.
            <FullscreenFloatingToolbar
              displayUrl={displayUrl}
              status={status}
              interactiveActive={interactiveActive}
              interactive={interactive}
              onToggleInteractive={handleUserTakeoverClick}
              navTaskId={activeTaskId ?? null}
              isExecuting={isExecuting}
              aborting={aborting}
              onStop={onStopClick}
              onExitFullscreen={onToggleFullscreen}
            />
          )}
          {!fullscreen && shouldConnect && showHeader && (
          <header className={cn('flex h-11 items-center gap-2 border-b px-3 pt-2', BROWSER_DIVIDER)}>
            <StatusDot status={status} />
            {/* BOSS bug fix — when the panel is narrow (< 500px),
                hide back/forward to keep the URL bar legible. The
                agent rarely needs them, and the user can take over
                + use Brave's own gestures if they really need to
                go back. Reload stays — it's the highest-utility
                button when a page hangs. */}
            {!isNarrow && (
              <>
                <NavButton direction="back" title="后退" navTaskId={activeTaskId ?? null} />
                <NavButton direction="forward" title="前进" navTaskId={activeTaskId ?? null} />
              </>
            )}
            <NavButton direction="reload" title="刷新" navTaskId={activeTaskId ?? null} />
            <UrlBar
              displayUrl={displayUrl}
              interactiveActive={interactiveActive}
              navTaskId={activeTaskId ?? null}
            />
            {isExecuting && activeTaskId && (
              <button
                type="button"
                onClick={onStopClick}
                disabled={aborting}
                title="停止当前任务"
                aria-label="停止当前任务"
                className={cn(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                  aborting
                    ? 'cursor-wait border-[#DCDDDD] bg-[#EFEFEF] text-muted-foreground dark:border-white/10 dark:bg-white/5'
                    : 'border-[#EA1F59]/35 bg-white text-[#EA1F59] hover:bg-[#EA1F59]/10 dark:border-[#EA1F59]/35 dark:bg-transparent dark:hover:bg-[#EA1F59]/10',
                )}
              >
                <Square className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
            <button
              type="button"
              onClick={handleUserTakeoverClick}
              title={
                interactive
                  ? '退出接管 — 让 AI 继续操作'
                  : '接管浏览器 — 你的鼠标键盘直接控制 Brave'
              }
              aria-label={interactive ? '退出浏览器接管' : '接管浏览器'}
              aria-pressed={interactive}
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors',
                interactive
                  ? 'border-[#EA1F59]/35 bg-[#EA1F59]/10 text-[#EA1F59]'
                  : 'border-transparent bg-transparent text-muted-foreground hover:bg-foreground/5',
              )}
            >
              {interactive ? (
                <MousePointerClick className="h-3.5 w-3.5" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
            </button>
            {/* Fullscreen toggle is a power-user feature; hide on
                narrow panels (BOSS bug — toolbar was crowded). The
                user can still open fullscreen from the keyboard
                shortcut or by widening the panel first. */}
            {onToggleFullscreen && !isNarrow && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                title={fullscreen ? '退出全屏 (Esc)' : '全屏浏览器模式'}
                aria-label={fullscreen ? '退出全屏' : '全屏浏览器模式'}
                aria-pressed={fullscreen}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors',
                  'hover:bg-foreground/5 hover:text-foreground',
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
          {browserAwaiting && (
            <div
              role="alert"
              className="mx-3 mt-3 flex animate-fade-in items-start gap-3 rounded-lg border border-[#FFC910]/60 bg-white px-4 py-3 text-[#595757] shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-[#FFC910]/35 dark:bg-card/85 dark:text-foreground"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFC910]/20 text-base font-bold text-[#57479C]">
                !
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {awaitingUserCopy(awaitingKind).panelTitle}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
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
          {interactiveActive && showTakeoverBanner && !fullscreen && (
            <div className="mx-3 mt-2 rounded-md border border-[#EA1F59]/25 bg-[#EA1F59]/10 px-3 py-1.5 text-center text-[11px] font-medium text-[#EA1F59] dark:border-[#EA1F59]/35">
              你正在直接操作浏览器 · 点工具栏的接管按钮可让 AI 继续
            </div>
          )}
          <div
            ref={screencastHostRef}
            className={cn(
              'flex flex-1 items-center justify-center overflow-hidden',
              fullscreen ? 'p-0' : 'p-3',
              interactiveActive
                ? 'bg-[#EA1F59]/5'
                : 'bg-[#EFEFEF]/50 dark:bg-white/[0.03]',
            )}
          >
            {hibernated ? (
              <HibernationCard
                lastFrame={displayFrame}
                onWake={onWake}
                waking={waking}
              />
            ) : useVnc ? (
              <div className="relative h-full w-full">
                {usingCdp ? (
                  <CdpScreencastViewport
                    // Codex Pack B2 — bumping reconnectEpoch forces a
                    // fresh CdpScreencastViewport mount, which closes
                    // the existing WS and opens a new one. Drives the
                    // "重新连接" button after 5s of connecting.
                    key={`cdp-${reconnectEpoch}`}
                    wsUrl={screencastUrlForCdp}
                    viewOnly={!interactiveActive}
                    onStatusChange={(s: CdpScreencastStatus) =>
                      // Reuse the VNC status state — the enum values
                      // overlap exactly so the existing
                      // "connecting…" / hibernation banners just work.
                      handleVncStatus(s as VncStatus)
                    }
                    onUrlChange={onCdpUrlChange}
                    className={cn(
                      'rounded-md border shadow-[0_1px_3px_rgba(17,24,39,0.06)]',
                      interactiveActive
                        ? 'border-[#EA1F59]/45 ring-2 ring-[#EA1F59]/15'
                        : 'border-black/[0.06]',
                    )}
                  />
                ) : (
                  <VncViewport
                    // Codex Pack B2 — same reconnect-via-remount key.
                    key={`vnc-${reconnectEpoch}`}
                    wsUrl={vncUrl}
                    viewOnly={!interactiveActive}
                    onStatusChange={handleVncStatus}
                    className={cn(
                      'rounded-md border shadow-[0_1px_3px_rgba(17,24,39,0.06)]',
                      interactiveActive
                        ? 'border-[#EA1F59]/45 ring-2 ring-[#EA1F59]/15'
                        : 'border-black/[0.06]',
                    )}
                  />
                )}
                {showLiveOverlay && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/35 text-xs text-muted-foreground backdrop-blur-[1px]"
                  >
                    <div className="pointer-events-none max-w-[260px] text-center">
                      <div className="font-medium text-foreground/80">{liveOverlayCopy.title}</div>
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
                        className="pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-[#DCDDDD] bg-white px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-card dark:hover:bg-white/10"
                      >
                        <RotateCw className="h-3 w-3" />
                        重新连接
                      </button>
                    )}
                  </div>
                )}
                {vncStatus === 'disconnected' && showDisconnectBanner && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none absolute right-2 top-2 rounded bg-[#FFC910]/95 px-2 py-0.5 text-[10px] font-semibold text-[#595757] shadow-sm"
                  >
                    实时画面断开，正在自动重连
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
                    className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
                    aria-label="显示操作日志"
                    title="显示操作日志"
                  >
                    <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                {interactiveActive && (
                  <CjkInputBar onSend={sendInsertText} fullscreen={fullscreen} />
                )}
              </div>
            ) : frame ? (
              isBlankUrl(frame.url) ? (
                <div className="text-center text-xs text-muted-foreground/80">
                  等待浏览器加载页面...
                </div>
              ) : (
                /* BUG-11 final-final — the JPEG-fallback path renders
                   an <img>, not the canvas branch. Without an
                   explicit-size wrapper, the img + relative div
                   sized each other circularly to the source's
                   intrinsic width (e.g. 1014), bypassing the panel's
                   real width. Wrapper now `h-full w-full min-w-0
                   min-h-0` so it fills the panel slot; img is
                   `absolute inset-0 w-full h-full object-contain`
                   so it letterboxes inside that bounded box. */
                <div className="relative">
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
                        ? 'cursor-pointer border-[#EA1F59]/45 ring-2 ring-[#EA1F59]/15'
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
                      onClose={() => setActivityVisible(false)}
                    />
                  )}
                  {!activityVisible && recentSteps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActivityVisible(true)}
                      className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
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
                        'absolute left-2 z-30 inline-flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60',
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
            ) : finalEvidenceFrame ? (
              // R7 — terminal task with captured evidence. The img
              // is static (no clicks reach Brave). Per-task Brave has
              // already been released, so this surface must stay an
              // evidence viewer and offer a fresh re-run instead of a
              // misleading live takeover.
              <div className="relative flex h-full w-full flex-col">
                <div className="relative flex flex-1 items-center justify-center min-h-0 min-w-0">
                  <img
                    ref={imgRef}
                    src={`data:image/jpeg;base64,${finalEvidenceFrame.imageBase64}`}
                    alt="任务完成时的浏览器截图"
                    draggable={false}
                    onLoad={fitScreencastImg}
                    className="block rounded-md border border-black/[0.06] shadow-[0_1px_3px_rgba(17,24,39,0.06)]"
                  />
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur">
                    <span className="truncate">{terminalEvidenceLabel} · 最终页面</span>
                    {finalEvidenceFrame.url && finalEvidenceFrame.url !== 'about:blank' && (
                      <span className="truncate font-mono opacity-80">{finalEvidenceFrame.url}</span>
                    )}
                  </div>
                </div>
                <div className={cn('flex shrink-0 items-center justify-center gap-2 border-t bg-background/70 px-3 py-2 text-[12px]', BROWSER_DIVIDER)}>
                  <span className="text-muted-foreground">想继续操作？新建任务或重新执行。</span>
                  {onReExecute && (
                    <button
                      type="button"
                      onClick={onReExecute}
                      disabled={reExecuting}
                      aria-label={reExecuting ? '正在重新执行任务' : '重新执行任务'}
                      title={reExecuting ? '正在重新执行' : '重新执行'}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#DCDDDD] bg-white px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
                    >
                      <RotateCw className={cn('h-3 w-3', reExecuting && 'animate-spin')} />
                      {reExecuting ? '提交中…' : '重新执行'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <EmptyBrowserState
                taskStatus={taskStatus}
                isBrowserTask={isBrowserTask}
                finalUrl={persistedFinalUrl}
                onReExecute={onReExecute}
                reExecuting={reExecuting}
              />
            )}
          </div>
          {!fullscreen && shouldConnect && showHeader && (
            <footer className={cn('flex h-7 items-center justify-between border-t px-3 text-[11px] text-muted-foreground', BROWSER_DIVIDER)}>
              <span>{frame ? `${frame.viewport.width}×${frame.viewport.height}` : '—'}</span>
              <span>{frame ? `第 ${frame.tickIndex + 1} 帧` : ''}</span>
            </footer>
          )}
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
          title="关闭浏览器抽屉"
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
          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-white/10"
          aria-label="收起操作日志"
          title="收起操作日志"
        >
          <X className="h-3 w-3" aria-hidden />
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
      style={{ minWidth: 280, maxWidth: '70%' }}
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
  finalUrl,
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
  /**
   * When a terminal browser task has NO finalScreenshot we still
   * usually have a persisted finalUrl. Surface it so the user can
   * verify the agent's claim on the live page instead of staring at
   * about:blank.
   */
  finalUrl?: string | null;
  /**
   * Click handler for the "重新执行" button shown on terminal
   * browser tasks with neither a screenshot nor a finalUrl saved.
   * The legacy task has no recoverable evidence — best we can do
   * is offer to re-run the same intent.
   */
  onReExecute?: () => void;
  reExecuting?: boolean;
}): JSX.Element {
  if (taskStatus === 'executing' && isBrowserTask) {
    return (
      <div className={cn('flex flex-col items-center gap-2.5 rounded-lg px-6 py-4 text-center', BROWSER_SURFACE)}>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EA1F59]/10 text-[#EA1F59]">
          <Globe className="h-4 w-4 animate-pulse-dot" aria-hidden />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">等待浏览器画面</div>
          <div className="mt-0.5 text-xs text-muted-foreground">正在连接当前任务的实时页面。</div>
        </div>
      </div>
    );
  }
  const terminal = taskStatus ? isTerminalStatus(taskStatus) : false;
  if (terminal && isBrowserTask) {
    const statusLabel = terminalEvidenceStatusLabel(taskStatus);
    const safeFinalUrl = safeExternalHttpHref(finalUrl);
    // Three branches: finalScreenshot is handled before reaching us
    // (the parent renders `finalEvidenceFrame` directly). Here we
    // only see "no screenshot" cases — either finalUrl exists (give
    // the user a link to verify) or nothing was saved at all (offer
    // to re-execute the intent).
    if (safeFinalUrl) {
      return (
        <div className={cn('flex flex-col items-center px-6 py-4 text-center text-muted-foreground', BROWSER_SURFACE, 'rounded-lg')}>
          <Globe className="h-10 w-10 text-[#42C0EF]/70" aria-hidden />
          <div className="mt-3 text-sm font-medium text-foreground/80">
            {statusLabel}，没有截图
          </div>
          <div className="mt-1 text-xs leading-relaxed">
            这次任务结束时没有捕获截图，可打开最终页面复核。
          </div>
          <SafeExternalLinkButton
            href={safeFinalUrl}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#DCDDDD] bg-white px-2.5 py-1 text-[12px] text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="max-w-[260px] truncate font-mono text-[11px]">
              {safeFinalUrl}
            </span>
          </SafeExternalLinkButton>
        </div>
      );
    }
    return (
      <div className={cn('flex flex-col items-center px-6 py-4 text-center text-muted-foreground', BROWSER_SURFACE, 'rounded-lg')}>
        <Globe className="h-10 w-10 text-[#42C0EF]/70" aria-hidden />
        <div className="mt-3 text-sm font-medium text-foreground/80">
          这条历史任务没有保存浏览器证据
        </div>
        <div className="mt-1 text-xs leading-relaxed">
          可能是上线前的旧任务。可以重新执行同样的意图来生成截图。
        </div>
        {onReExecute && (
          <button
            type="button"
            onClick={onReExecute}
            disabled={reExecuting}
            aria-label={reExecuting ? '正在重新执行任务' : '重新执行任务'}
            title={reExecuting ? '正在重新执行' : '重新执行'}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
          >
            <RotateCw className={cn('h-3 w-3', reExecuting && 'animate-spin')} />
            {reExecuting ? '提交中…' : '重新执行'}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-center px-6 py-4 text-center text-muted-foreground', BROWSER_SURFACE, 'rounded-lg')}>
      <Globe className="h-10 w-10 text-[#42C0EF]/70" aria-hidden />
      <div className="mt-3 text-sm font-medium text-foreground/80">浏览器将在这里显示</div>
      <div className="mt-1 text-xs leading-relaxed">
        创建一个任务后，HOLA DAY 的浏览器画面会实时出现在这里，
        <br />
        你可以观察或亲自接管。
      </div>
    </div>
  );
}

function SafeExternalLinkButton({
  href,
  className,
  children,
}: {
  href: string | null | undefined;
  className?: string;
  children: React.ReactNode;
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

function StatusDot({ status }: { status: DotStatus }): JSX.Element {
  const label = browserPanelDotLabel(status);
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

  const submit = async (): Promise<void> => {
    if (pending) return;
    const target = draft.trim();
    if (!target || target === displayUrl) {
      setEditing(false);
      return;
    }
    setPending(true);
    try {
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
    <input
      type="text"
      spellCheck={false}
      autoComplete="off"
      value={draft}
      title={draft}
      placeholder="输入 URL 回车跳转"
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
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
      aria-label="浏览器地址栏 (Enter 跳转, Esc 还原)"
      className={cn(
        'min-w-0 flex-1 truncate rounded-md border bg-transparent px-2 py-1 font-mono text-[11px] outline-none transition-colors',
        'border-transparent text-muted-foreground hover:border-[#DCDDDD] hover:bg-[#EFEFEF]/50 dark:hover:border-white/10 dark:hover:bg-white/5',
        'focus:border-foreground/20 focus:bg-background focus:text-foreground focus:ring-0',
        interactiveActive && 'border-[#EA1F59]/35',
        pending && 'cursor-wait opacity-60',
      )}
    />
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
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-[#EFEFEF]/60 hover:text-foreground dark:hover:bg-white/10',
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
 *   - takeover toggle (Hand icon, mirrors the header button)
 *   - stop button (when executing)
 *   - exit fullscreen
 */
function FullscreenFloatingToolbar({
  displayUrl,
  status,
  interactiveActive,
  interactive,
  onToggleInteractive,
  navTaskId,
  isExecuting,
  aborting,
  onStop,
  onExitFullscreen,
}: {
  displayUrl: string;
  status: DotStatus;
  interactiveActive: boolean;
  interactive: boolean;
  onToggleInteractive: () => void;
  navTaskId: string | null;
  isExecuting: boolean;
  aborting: boolean;
  onStop: () => Promise<void> | void;
  onExitFullscreen: () => void;
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
      <StatusDot status={status} />
      <NavButton direction="back" title="后退" navTaskId={navTaskId} />
      <NavButton direction="forward" title="前进" navTaskId={navTaskId} />
      <NavButton direction="reload" title="刷新" navTaskId={navTaskId} />
      <UrlBar
        displayUrl={displayUrl}
        interactiveActive={interactiveActive}
        navTaskId={navTaskId}
      />
      {isExecuting && navTaskId && (
        <button
          type="button"
          onClick={() => void onStop()}
          disabled={aborting}
          title="停止当前任务"
          aria-label="停止当前任务"
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
            aborting
              ? 'cursor-wait border-white/20 bg-white/10 text-white/60'
              : 'border-[#EA1F59]/35 bg-[#EA1F59]/15 text-white hover:bg-[#EA1F59]/25',
          )}
        >
          <Square className="h-3 w-3" strokeWidth={2.5} />
        </button>
      )}
      <button
        type="button"
        onClick={onToggleInteractive}
        title={interactive ? '退出接管 — 让 AI 继续操作' : '接管 — 你自己操作浏览器'}
        aria-label={interactive ? '退出接管' : '接管'}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10',
          interactive && 'bg-[#EA1F59]/35 text-white',
        )}
      >
        <Hand className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onExitFullscreen}
        title="退出全屏 (Cmd/Ctrl+Esc)"
        aria-label="退出全屏"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10"
      >
        <Minimize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

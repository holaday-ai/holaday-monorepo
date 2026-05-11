import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Power,
  RotateCw,
  Square,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  CdpScreencastViewport,
  type CdpScreencastStatus,
} from '@/components/CdpScreencastViewport';
import { VncViewport, type VncStatus } from '@/components/VncViewport';
import { hdDebug } from '@/lib/hd-debug';
import { trpc } from '@/lib/trpc';
import { useStreamToken } from '@/lib/use-stream-token';
import { send as wsSend } from '@/lib/ws';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';
import type { UiScreencast, UiStep, UiTaskStatus } from '@/types/task';
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
  const [collapsedLocal, setCollapsedLocal] = React.useState(false);
  const collapsed = collapsedProp ?? collapsedLocal;
  const toggleCollapsed = onToggleCollapse ?? (() => setCollapsedLocal((c) => !c));
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
  const taskIsTerminal =
    taskStatus === 'completed' ||
    taskStatus === 'failed' ||
    taskStatus === 'cancelled';
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
  const displayUrl =
    persistedFinalUrl ?? frameUrl ?? lastKnownUrl ?? 'about:blank';
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
  const taskTerminal =
    taskStatus === 'completed' ||
    taskStatus === 'failed' ||
    taskStatus === 'cancelled';
  // Idle gate. Two paths can flip it on:
  //   1. There's an active task — the panel shows that task's
  //      screencast / VNC.
  //   2. The user explicitly clicked the sidebar 浏览器 entry while
  //      no task was active. `browserLiveRequested` opts the panel
  //      into the per-user pool stream so the user sees their Brave.
  // Selecting a task or starting a new one clears the request flag
  // (handled in the store), so the stream binds back to task-scoped
  // automatically once the user moves on.
  const browserLiveRequested = useTaskStore((s) => s.browserLiveRequested);
  const hasActiveTask = Boolean(activeTaskId);
  // RC follow-up audit fix — generate / scrape tasks have NO pool
  // slot (no Brave allocated), so /screencast-ws/<taskId> 409s in a
  // loop and the user sees "画面已断开，重连中" cycling every ~5s
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
  const shouldConnect = isBrowserTask || browserLiveRequested;
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
  // RC audit fix — banner grace period. The "画面已断开，重连中"
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
  // P3 wake call — fire-and-forget allocate, then reset the attempt
  // counter so VncViewport's reconnect tries fresh. Server-side this
  // takes ~3-5s (cold spawn); the user sees the spinner during that
  // window before VNC reconnects.
  const [waking, setWaking] = React.useState(false);
  const onWake = React.useCallback(async () => {
    if (waking) return;
    setWaking(true);
    try {
      const res = await trpc.tasks.wakeBrowser.mutate();
      if (res.status === 'ready') {
        // Reset counter; VncViewport's auto-reconnect timer will fire
        // and the new connection should land on the freshly-allocated
        // instance.
        setVncAttemptFails(0);
      }
    } catch {
      // Non-fatal — user can click again.
    } finally {
      setWaking(false);
    }
  }, [waking]);
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
          {/*
           * Fullscreen renders WITHOUT the header / footer / banners —
           * BOSS reported the chrome was eating the top of the page
           * (Google logo blocked). In fullscreen, only a small floating
           * exit button + the canvas itself. Everything else falls back
           * to the usual stacked layout.
           */}
          {fullscreen && onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              title="退出全屏 (Esc)"
              aria-label="exit fullscreen"
              className="absolute right-3 top-3 z-50 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-black/50 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/70"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          )}
          {!fullscreen && shouldConnect && (
          <header className="flex h-11 items-center gap-2 border-b border-border px-3 pt-2">
            <StatusDot status={status} />
            <NavButton direction="back" title="后退" navTaskId={activeTaskId ?? null} />
            <NavButton direction="forward" title="前进" navTaskId={activeTaskId ?? null} />
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
                  ? '退出接管 — 让 AI 继续操作'
                  : '接管浏览器 — 你的鼠标键盘直接控制 Brave'
              }
              aria-label="toggle browser takeover"
              aria-pressed={interactive}
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors',
                interactive
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-transparent bg-transparent text-muted-foreground hover:bg-foreground/5',
              )}
            >
              {interactive ? (
                <MousePointerClick className="h-3.5 w-3.5" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
            </button>
            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                title={fullscreen ? '退出全屏 (Esc)' : '全屏浏览器模式'}
                aria-label="toggle fullscreen panel"
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
              className="flex animate-pulse-dot items-center gap-3 border-b-2 border-amber-400 bg-amber-100 px-4 py-3 text-amber-900 shadow-inner dark:border-amber-500 dark:bg-amber-500/20 dark:text-amber-100"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-base font-bold text-white">
                !
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {awaitingKindBannerTitle(awaitingKind)}
                </div>
                <div className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-100/80">
                  {awaitingKindBannerBody(awaitingKind)}
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
                    The button opens the login URL in a new tab so
                    the user can complete the login flow on the live
                    site, then come back and reply to the task. */}
                {awaitingKind === 'login' &&
                  !frame &&
                  persistedFinalUrl && (
                    <a
                      href={persistedFinalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/20"
                    >
                      <ExternalLink className="h-3 w-3" />
                      在新标签打开登录页
                    </a>
                  )}
              </div>
            </div>
          )}
          {interactiveActive && !fullscreen && (
            <div className="border-b border-primary/40 bg-primary/10 px-3 py-1.5 text-center text-[11px] font-medium text-primary dark:border-primary/50 dark:bg-primary/20">
              你正在直接操作浏览器 · 点工具栏的接管按钮可让 AI 继续
            </div>
          )}
          <div
            className={cn(
              'flex flex-1 items-center justify-center overflow-hidden',
              fullscreen ? 'p-0' : 'p-3',
              interactiveActive ? 'bg-primary/5' : 'bg-muted/40',
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
                    wsUrl={screencastUrlForCdp}
                    viewOnly={!interactiveActive}
                    onStatusChange={(s: CdpScreencastStatus) =>
                      // Reuse the VNC status state — the enum values
                      // overlap exactly so the existing
                      // "connecting…" / hibernation banners just work.
                      handleVncStatus(s as VncStatus)
                    }
                    className={cn(
                      'rounded-md border shadow-sm',
                      interactiveActive
                        ? 'border-sky-400 ring-2 ring-sky-300'
                        : 'border-black/[0.06]',
                    )}
                  />
                ) : (
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
                )}
                {(vncStatus === 'idle' || vncStatus === 'connecting') && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/30 text-xs text-muted-foreground">
                    连接实时画面…
                  </div>
                )}
                {vncStatus === 'disconnected' && showDisconnectBanner && (
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
                  {interactiveActive && (
                    <CjkInputBar onSend={sendInsertText} fullscreen={fullscreen} />
                  )}
                </div>
              )
            ) : finalEvidenceFrame ? (
              // R7 — terminal task with captured evidence. Static
              // image of the agent's last visible state, plus the
              // URL it was on. No interactive overlay (live Brave is
              // gone), no activity log, no CJK input.
              <div className="relative flex h-full w-full flex-col">
                <img
                  src={`data:image/jpeg;base64,${finalEvidenceFrame.imageBase64}`}
                  alt="任务完成时的浏览器截图"
                  draggable={false}
                  className="max-h-full max-w-full rounded-md border border-black/[0.06] object-contain shadow-sm"
                />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur">
                  <span className="truncate">任务已完成 · 最终页面</span>
                  {finalEvidenceFrame.url && finalEvidenceFrame.url !== 'about:blank' && (
                    <span className="truncate font-mono opacity-80">{finalEvidenceFrame.url}</span>
                  )}
                </div>
              </div>
            ) : (
              <EmptyBrowserState
                taskStatus={taskStatus}
                isBrowserTask={isBrowserTask}
              />
            )}
          </div>
          {!fullscreen && shouldConnect && (
            <footer className="flex h-7 items-center justify-between border-t border-border px-3 text-[11px] text-muted-foreground">
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
function CjkInputBar({
  onSend,
  fullscreen,
}: {
  onSend: (text: string) => void;
  fullscreen: boolean;
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
    </div>
  );
}

/**
 * P3 hibernation card. Shown when the user's pool browser has been
 * reaped by idle GC and VNC has failed to reconnect ≥3 times. The
 * last screencast frame fades into the background so users see what
 * was on screen ("oh yeah, that's the page I was on") and a single
 * 唤醒 button respawns Brave + reconnects VNC. Cookies persist in
 * the user-data-dir so logged-in sessions survive the hibernation.
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
      <div className="relative flex flex-col items-center gap-3 rounded-lg border border-border bg-background/95 px-6 py-5 shadow-lg backdrop-blur">
        <div className="text-3xl" aria-hidden>
          ⏾
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-foreground">浏览器已休眠</div>
          <div className="mt-1 text-xs text-muted-foreground">
            上次访问的页面和登录状态已保存
          </div>
        </div>
        <button
          type="button"
          onClick={onWake}
          disabled={waking}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-medium transition-colors',
            waking
              ? 'cursor-wait bg-muted text-muted-foreground'
              : 'bg-foreground text-background hover:bg-foreground/85',
          )}
        >
          {waking ? '唤醒中…' : '唤醒浏览器'}
        </button>
      </div>
    </div>
  );
}

function EmptyBrowserState({
  taskStatus,
  isBrowserTask = true,
}: {
  taskStatus: UiTaskStatus | null | undefined;
  /**
   * P3 — when the active task does NOT need a browser (generate /
   * scrape / intake clarification), render the generic idle copy
   * instead of "等待第一帧…". The latter implies a Brave is about
   * to show a frame, but for a non-browser task no frame will ever
   * arrive. Default true preserves prior behaviour for callers
   * without active-task context (e.g. browserLiveRequested mode).
   */
  isBrowserTask?: boolean;
}): JSX.Element {
  if (taskStatus === 'executing' && isBrowserTask) {
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

function awaitingKindBannerTitle(
  kind:
    | 'clarification'
    | 'login'
    | 'captcha'
    | 'permission'
    | 'browser_action'
    | undefined,
): string {
  switch (kind) {
    case 'login':
      return '需要您完成登录';
    case 'browser_action':
      return '需要您在浏览器中操作';
    case 'permission':
      // Phase 3 R1 — permission walls (HTTP 403, geo-restricted pages,
      // chrome-error pages). Different from a login: there's nothing
      // to log into, the page is just refusing access.
      return '页面拒绝了访问';
    case 'captcha':
    default:
      return '需要您手动完成验证';
  }
}

function awaitingKindBannerBody(
  kind:
    | 'clarification'
    | 'login'
    | 'captcha'
    | 'permission'
    | 'browser_action'
    | undefined,
): string {
  switch (kind) {
    case 'login':
      return '交互模式已开启，直接在下方画面里完成登录 / 扫码。完成后 agent 会继续。';
    case 'browser_action':
      return '交互模式已开启，按提示在下方画面里点击 / 选择即可。完成后 agent 会继续。';
    case 'permission':
      return '当前页面对未授权访问返回 403 / 拒绝。请确认你有权限，或换一个公开来源后回复继续。';
    case 'captcha':
    default:
      return '交互模式已开启，直接在下方画面里点击验证码 / 滑动滑块即可。完成后 agent 会继续。';
  }
}

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
        status === 'live' && 'animate-pulse-dot bg-primary',
        status === 'error' && 'bg-red-500',
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
  // Local editing state. Resync to the prop whenever the agent
  // navigates (or the user clicks back/forward) so the bar always
  // reflects the live page url unless the user is mid-edit.
  const [draft, setDraft] = React.useState(displayUrl);
  const [editing, setEditing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    if (!editing) setDraft(displayUrl);
  }, [displayUrl, editing]);

  const submit = async (): Promise<void> => {
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
      if (!res.ok) {
        // Soft failure: snap back. The most likely reason is
        // `no_executor` (browser hibernated) — the panel's
        // hibernation card / wake button is the recovery surface.
        setDraft(displayUrl);
      }
    } catch {
      setDraft(displayUrl);
    } finally {
      setPending(false);
      setEditing(false);
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
        'border-transparent text-muted-foreground hover:border-border hover:bg-muted/40',
        'focus:border-foreground/20 focus:bg-background focus:text-foreground focus:ring-0',
        interactiveActive && 'border-sky-300/40',
        pending && 'cursor-wait opacity-60',
      )}
    />
  );
}

/**
 * Small 20x20 icon button that fires `tasks.browserNav` on the shared
 * Brave instance. Fire-and-forget — the VNC stream updates within a
 * tick so we don't need to block the UI or show a result toast. A
 * silent failure on no_executor / nav_failed is fine; the user just
 * clicks again.
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
  const [pending, setPending] = React.useState(false);
  const Icon = direction === 'back' ? ArrowLeft : direction === 'forward' ? ArrowRight : RotateCw;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await trpc.tasks.browserNav.mutate({
            direction,
            ...(navTaskId ? { taskId: navTaskId } : {}),
          });
        } catch {
          /* silent — see docstring */
        } finally {
          setPending(false);
        }
      }}
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-foreground/5 hover:text-foreground',
        pending && 'opacity-50',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

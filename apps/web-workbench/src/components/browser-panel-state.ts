import type { UiScreencast, UiTask, UiTaskStatus } from '@/types/task';

export type BrowserLiveStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type BrowserPanelHeaderTone =
  | 'idle'
  | 'live'
  | 'recovering'
  | 'attention'
  | 'takeover'
  | 'error';

export interface BrowserPanelHeaderStatus {
  label: string;
  tooltip: string;
  tone: BrowserPanelHeaderTone;
  dotStatus: 'idle' | 'live' | 'error';
  showLabel: boolean;
}

export interface BrowserControlAction {
  nextInteractive: boolean;
  focusFollowUp: boolean;
  label: '接管' | '交给 AI';
  ariaLabel: string;
  title: string;
}

/**
 * Resolves the browser ownership toggle into an honest user action. A running
 * task can resume immediately when takeover ends. A terminal task has no
 * active agent, so handing it back must focus a follow-up instruction instead
 * of pretending that AI work restarted on its own.
 */
export function browserControlAction(inputs: {
  interactive: boolean;
  taskIsTerminal: boolean;
}): BrowserControlAction {
  if (!inputs.interactive) {
    return {
      nextInteractive: true,
      focusFollowUp: false,
      label: '接管',
      ariaLabel: '接管浏览器',
      title: '接管浏览器 — 你的鼠标键盘直接控制浏览器',
    };
  }
  if (inputs.taskIsTerminal) {
    return {
      nextInteractive: false,
      focusFollowUp: true,
      label: '交给 AI',
      ariaLabel: '交给 AI 继续',
      title: '交给 AI — 输入下一步指令后从当前页面继续',
    };
  }
  return {
    nextInteractive: false,
    focusFollowUp: false,
    label: '交给 AI',
    ariaLabel: '退出浏览器接管',
    title: '退出接管 — AI 继续当前执行',
  };
}

export function browserInputFallbackMode(inputs: {
  interactiveActive: boolean;
  usingCdp: boolean;
  fallbackOpen: boolean;
}): 'hidden' | 'toggle' | 'bar' {
  if (!inputs.interactiveActive) return 'hidden';
  if (!inputs.usingCdp || inputs.fallbackOpen) return 'bar';
  return 'toggle';
}

export function shouldConnectBrowserStream(inputs: {
  isBrowserTask: boolean;
  taskIsTerminal: boolean;
}): boolean {
  return inputs.isBrowserTask;
}

export function shouldUseTerminalEvidence(inputs: {
  taskIsTerminal: boolean;
  hasFinalEvidence: boolean;
  liveSessionUnavailable: boolean;
}): boolean {
  return (
    inputs.taskIsTerminal &&
    inputs.hasFinalEvidence &&
    inputs.liveSessionUnavailable
  );
}

/**
 * Silent retry cadence for a terminal browser whose backend process is still
 * restarting. The cap keeps a long outage quiet while allowing the workspace
 * to recover by itself when the service returns.
 */
export function terminalBrowserRecoveryRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(15_000, 2_000 * 2 ** (safeAttempt - 1));
}

/**
 * Once a terminal page has painted, brief socket churn should be invisible:
 * the canvas remains useful and takeover ownership is preserved. Surface the
 * compact reconnect affordance only after recovery has had time to complete.
 */
export function browserReconnectAffordanceDelay(inputs: {
  taskIsTerminal: boolean;
  hasPresentedFrame: boolean;
}): number {
  return inputs.taskIsTerminal && inputs.hasPresentedFrame ? 15_000 : 5_000;
}

export function terminalBrowserRecoveryWindow(inputs: {
  disconnected: boolean;
  disconnectedAt: number | null;
  now: number;
  hasPresentedFrame: boolean;
}): {
  disconnectedAt: number | null;
  remainingMs: number;
  timedOut: boolean;
} {
  if (!inputs.disconnected) {
    return { disconnectedAt: null, remainingMs: 0, timedOut: false };
  }
  const disconnectedAt = inputs.disconnectedAt ?? inputs.now;
  const graceMs = inputs.hasPresentedFrame ? 12_000 : 6_000;
  const remainingMs = Math.max(0, disconnectedAt + graceMs - inputs.now);
  return {
    disconnectedAt,
    remainingMs,
    timedOut: remainingMs === 0,
  };
}

/**
 * A retained terminal browser gets a quiet grace period after it has already
 * painted a usable frame. Repeated socket closes alone are not enough to
 * restart that live process; recovery starts only after the grace timer also
 * expires. A browser that never produced a frame can recover sooner.
 */
export function shouldSuspectTerminalBrowserSession(inputs: {
  taskIsTerminal: boolean;
  liveStatus: BrowserLiveStatus;
  failedAttempts: number;
  connectTimedOut: boolean;
  hasPresentedFrame: boolean;
}): boolean {
  if (!inputs.taskIsTerminal || inputs.liveStatus === 'connected') return false;
  if (inputs.hasPresentedFrame) {
    return inputs.failedAttempts >= 2 && inputs.connectTimedOut;
  }
  return inputs.failedAttempts >= 2 || inputs.connectTimedOut;
}

export type TerminalBrowserRecoveryState =
  | 'idle'
  | 'restoring'
  | 'ready'
  | 'connected'
  | 'failed';

/**
 * A recoverable terminal browser keeps its live viewport mounted while the
 * socket and backend session retry. Unmounting it on each failed attempt turns
 * the last useful frame into a static screenshot and also drops user takeover.
 * Evidence-only mode is reserved for tasks with no trusted URL to restore.
 */
export function terminalBrowserSessionUnavailable(inputs: {
  sessionSuspected: boolean;
  canRestore: boolean;
  hasPresentedFrame?: boolean;
  recoveryState: TerminalBrowserRecoveryState;
  recoveryAttempt: number;
}): boolean {
  return (
    inputs.sessionSuspected &&
    !inputs.canRestore &&
    !inputs.hasPresentedFrame
  );
}

export function isBrowserInteractionActive(inputs: {
  interactive: boolean;
  taskIsTerminal: boolean;
  useLiveStream: boolean;
  liveStatus: BrowserLiveStatus;
  hasLiveFrame: boolean;
  liveSessionUnavailable: boolean;
}): boolean {
  if (!inputs.interactive || inputs.liveSessionUnavailable) return false;
  if (inputs.useLiveStream) {
    // `interactive` preserves takeover ownership through a reconnect. Active
    // forwarding still waits for an open transport so input is never accepted
    // and then silently discarded.
    return inputs.liveStatus === 'connected';
  }
  return !inputs.taskIsTerminal && inputs.hasLiveFrame;
}

export function shouldShowBrowserHeader(inputs: {
  taskIsTerminal: boolean;
  hasCurrentFrame: boolean;
  hasFinalEvidence: boolean;
  interactiveActive: boolean;
  hasLiveStream?: boolean;
}): boolean {
  if (!inputs.taskIsTerminal) return true;
  return (
    inputs.hasCurrentFrame ||
    inputs.hasFinalEvidence ||
    inputs.interactiveActive ||
    inputs.hasLiveStream === true
  );
}

export function shouldShowBrowserFullscreen(inputs: {
  available: boolean;
  workspaceIdle: boolean;
  isNarrow: boolean;
  isSheet: boolean;
  evidenceHeaderActive: boolean;
}): boolean {
  if (!inputs.available || inputs.workspaceIdle || inputs.isSheet) return false;
  return true;
}

export function shouldShowTerminalEvidenceLedger(fullscreen: boolean): boolean {
  return !fullscreen;
}

export type TerminalEvidenceLayout = 'canvas' | 'compact-preview';

export function terminalEvidenceLayout(inputs: {
  isNarrow: boolean;
  isSheet: boolean;
  fullscreen: boolean;
  sourceAspect: number | null;
  viewMode: 'contain' | 'readable';
}): TerminalEvidenceLayout {
  if (
    inputs.fullscreen ||
    inputs.viewMode === 'readable' ||
    (!inputs.isNarrow && !inputs.isSheet)
  ) {
    return 'canvas';
  }
  if (inputs.sourceAspect == null || !Number.isFinite(inputs.sourceAspect)) {
    return 'canvas';
  }
  return inputs.sourceAspect > 1.12 ? 'compact-preview' : 'canvas';
}

export function terminalEvidenceStatusLabel(
  status: UiTaskStatus | null | undefined,
): string {
  switch (status) {
    case 'completed':
      return '任务已完成';
    case 'partial_success':
      return '任务需复核';
    case 'failed':
      return '任务未完成';
    case 'cancelled':
      return '任务已取消';
    default:
      return '任务已结束';
  }
}

export function isBrowserErrorUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith('chrome-error://') ||
    normalized.startsWith('edge-error://') ||
    normalized.startsWith('about:neterror')
  );
}

/**
 * Converts the global browser address-bar value into the existing task
 * creation contract. Browser instances are task-owned, so the shell starts a
 * normal browser task instead of pretending an unallocated browser can
 * navigate. Plain domains become HTTPS URLs; other text becomes a web search.
 * Scheme-looking non-web values are rejected before they enter the task log.
 */
export function browserWorkspaceTaskIntent(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return null;

  const explicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (explicitScheme && !/^https?:\/\//i.test(value)) return null;
  if (/^https?:\/\//i.test(value)) return `打开 ${value}`;

  const domainLike = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63})(?::\d{1,5})?(?:[/?#]\S*)?$/i;
  if (domainLike.test(value)) return `打开 https://${value}`;

  return `打开浏览器并搜索：${value}`;
}

export interface TerminalEvidenceContinuation {
  intent: string;
  label: string;
  pendingLabel: string;
  description: string;
}

/**
 * Builds the honest recovery action for a released terminal browser. The
 * screenshot remains read-only; the action restores a managed browser under
 * the same task at the last verified HTTP(S) URL.
 */
export function terminalEvidenceContinuation(
  finalUrl: string | null | undefined,
): TerminalEvidenceContinuation | null {
  const value = finalUrl?.trim();
  if (!value || !/^https?:\/\//i.test(value) || isBrowserErrorUrl(value)) {
    return null;
  }
  const intent = browserWorkspaceTaskIntent(value);
  if (!intent) return null;
  return {
    intent,
    label: '恢复可操作浏览器',
    pendingLabel: '正在恢复浏览器…',
    description: '在当前任务恢复到最后页面，继续点击、输入或交给 AI。',
  };
}

/**
 * Recovers the explicit target URL from a browser task created by the global
 * workspace. This is only a requested destination, not evidence that the page
 * was reached, so callers must keep it visually marked as a pending target.
 */
export function browserStartupTargetUrl(
  intent: string | null | undefined,
): string | null {
  if (!intent) return null;
  const match = intent.trim().match(/^打开\s+(https?:\/\/\S+)$/i);
  return match?.[1] ?? null;
}

/**
 * Selects only evidence owned by the active task. Callers must pass the
 * active task's live frame rather than a workspace-wide latest frame.
 */
export function taskOwnedBrowserFrame(inputs: {
  taskIsTerminal: boolean;
  liveFrame: UiScreencast | null;
  finalEvidenceFrame: UiScreencast | null;
  preferLiveTerminalSession?: boolean;
}): UiScreencast | null {
  if (inputs.taskIsTerminal && !inputs.preferLiveTerminalSession) {
    return inputs.finalEvidenceFrame;
  }
  return inputs.liveFrame ?? inputs.finalEvidenceFrame;
}

export type TerminalEvidenceScreenshotSource =
  | 'saved-screenshot'
  | 'last-frame';

export interface TerminalEvidenceFrame {
  frame: UiScreencast;
  source: TerminalEvidenceScreenshotSource;
}

/**
 * Rebuilds the selected task's read-only terminal browser evidence after a
 * refresh. Persisted screenshots always win over an in-memory live frame so a
 * stale frame can never be presented as the task's final page.
 */
export function terminalEvidenceFrameForTask(inputs: {
  taskIsTerminal: boolean;
  task: Pick<
    UiTask,
    'finalScreenshot' | 'finalUrl' | 'finalViewport' | 'createdAt'
  > | null;
  liveFrame: UiScreencast | null;
}): TerminalEvidenceFrame | null {
  if (!inputs.taskIsTerminal) return null;

  const { task, liveFrame } = inputs;
  if (task?.finalScreenshot) {
    return {
      frame: {
        tickIndex: -1,
        imageBase64: task.finalScreenshot,
        url: task.finalUrl?.trim() || 'about:blank',
        viewport: task.finalViewport ?? { width: 0, height: 0 },
        timestamp: task.createdAt.toISOString(),
      },
      source: 'saved-screenshot',
    };
  }

  if (!liveFrame || !liveFrame.imageBase64 || isBlankBrowserUrl(liveFrame.url)) {
    return null;
  }
  return {
    frame: {
      ...liveFrame,
      url: task?.finalUrl?.trim() || liveFrame.url,
      viewport: task?.finalViewport ?? liveFrame.viewport,
    },
    source: 'last-frame',
  };
}

function isBlankBrowserUrl(url: string | null | undefined): boolean {
  const normalized = url?.trim().toLowerCase();
  return !normalized || normalized === 'about:blank';
}

export interface TaskOwnedBrowserUrl {
  taskId: string;
  url: string;
}

/** Prevents a state update effect from leaking the previous task's URL for one render. */
export function taskOwnedBrowserUrl(
  activeTaskId: string | null,
  cached: TaskOwnedBrowserUrl | null,
): string | null {
  return activeTaskId && cached?.taskId === activeTaskId ? cached.url : null;
}

export function terminalEvidenceFrameLabel(inputs: {
  status: UiTaskStatus | null | undefined;
  url?: string | null;
}): string {
  const statusLabel = terminalEvidenceStatusLabel(inputs.status);
  return isBrowserErrorUrl(inputs.url)
    ? '页面无法打开 · 浏览器页面'
    : `${statusLabel} · 浏览器页面`;
}

export function browserLiveStatusLabel(status: BrowserLiveStatus): string {
  switch (status) {
    case 'connected':
      return '浏览器画面已连接';
    case 'connecting':
      return '浏览器画面连接中';
    case 'disconnected':
      return '浏览器画面已断开';
    case 'error':
      return '浏览器画面连接失败';
    case 'idle':
    default:
      return '等待浏览器画面';
  }
}

export function browserPanelDotLabel(status: 'idle' | 'live' | 'error'): string {
  switch (status) {
    case 'live':
      return browserLiveStatusLabel('connected');
    case 'error':
      return '需要处理';
    case 'idle':
    default:
      return browserLiveStatusLabel('idle');
  }
}

export function browserPanelHeaderStatus(inputs: {
  dotStatus: 'idle' | 'live' | 'error';
  liveStatus: BrowserLiveStatus;
  browserAwaiting: boolean;
  interactiveActive: boolean;
  interactiveOwned?: boolean;
  showReconnect: boolean;
  hasPresentedFrame?: boolean;
  taskIsTerminal?: boolean;
}): BrowserPanelHeaderStatus {
  if (inputs.browserAwaiting) {
    return {
      label: '待操作',
      tooltip: '等待你在浏览器里完成登录、验证或授权',
      tone: 'attention',
      dotStatus: 'error',
      showLabel: true,
    };
  }
  const interactiveOwned =
    inputs.interactiveOwned ?? inputs.interactiveActive;
  if (interactiveOwned && !inputs.interactiveActive) {
    return {
      label: '接管保留',
      tooltip: '浏览器连接恢复后可直接继续输入，无需再次接管',
      tone: 'recovering',
      dotStatus: inputs.showReconnect ? 'error' : 'live',
      showLabel: true,
    };
  }
  if (inputs.interactiveActive) {
    return {
      label: '接管中',
      tooltip: inputs.taskIsTerminal
        ? '你正在直接操作浏览器；需要 AI 时点“交给 AI”并输入下一步指令'
        : '你正在直接操作浏览器，点“交给 AI”可继续当前执行',
      tone: 'takeover',
      dotStatus: 'live',
      showLabel: true,
    };
  }
  if (
    inputs.hasPresentedFrame &&
    !inputs.showReconnect &&
    (inputs.liveStatus === 'connecting' ||
      inputs.liveStatus === 'disconnected' ||
      inputs.liveStatus === 'error')
  ) {
    return {
      label: '已连接',
      tooltip: '连接短暂中断，最后画面已保留，正在自动续接',
      tone: 'recovering',
      dotStatus: 'live',
      showLabel: false,
    };
  }
  if (inputs.liveStatus === 'connected') {
    return {
      label: '已连接',
      tooltip: browserLiveStatusLabel('connected'),
      tone: 'live',
      dotStatus: 'live',
      showLabel: false,
    };
  }
  if (inputs.liveStatus === 'connecting') {
    return {
      label: '连接中',
      tooltip: '正在连接浏览器画面',
      tone: 'live',
      dotStatus: 'live',
      showLabel: true,
    };
  }
  if (inputs.liveStatus === 'disconnected') {
    return {
      label: inputs.showReconnect ? '已断开' : '恢复中',
      tooltip: inputs.showReconnect
        ? '浏览器画面已断开，可手动刷新画面'
        : '浏览器画面短暂断开，正在自动恢复',
      tone: 'recovering',
      dotStatus: inputs.showReconnect ? 'error' : 'live',
      showLabel: true,
    };
  }
  if (inputs.liveStatus === 'error') {
    return {
      label: '连接失败',
      tooltip: '浏览器画面连接失败，可刷新画面',
      tone: 'error',
      dotStatus: 'error',
      showLabel: true,
    };
  }
  return {
    label: inputs.dotStatus === 'live' ? '准备中' : '待启动',
    tooltip:
      inputs.dotStatus === 'live'
        ? '浏览器正在启动，画面准备好后会自动出现'
        : browserPanelDotLabel(inputs.dotStatus),
    tone: inputs.dotStatus === 'live' ? 'live' : 'idle',
    dotStatus: inputs.dotStatus,
    showLabel: inputs.dotStatus === 'live',
  };
}

/**
 * A live canvas is a working surface, not a loading placeholder. Once a frame
 * has been presented, preserve it through transport retries and report a long
 * outage with a compact recovery affordance instead of covering the page.
 */
export function shouldShowBrowserLiveOverlay(inputs: {
  liveStatus: BrowserLiveStatus;
  showReconnect: boolean;
  hasPresentedFrame: boolean;
}): boolean {
  return !inputs.hasPresentedFrame;
}

/**
 * The CDP viewport owns an indefinite reconnect loop and keeps its canvas
 * between socket attempts. Let it reconnect in place after backend recovery;
 * the legacy VNC viewer still needs a remount to restart its transport.
 */
export function shouldRemountBrowserStreamAfterRestore(inputs: {
  usingCdp: boolean;
}): boolean {
  return !inputs.usingCdp;
}

export function shouldPreserveBrowserCanvasOnTaskSwitch(inputs: {
  previousTaskId: string | null;
  nextTaskId: string | null;
  nextReplyToTaskId: string | null;
  nextExecutionMode: UiTask['executionMode'];
}): boolean {
  return Boolean(
    inputs.previousTaskId &&
      inputs.nextTaskId &&
      inputs.previousTaskId !== inputs.nextTaskId &&
      inputs.nextReplyToTaskId === inputs.previousTaskId &&
      inputs.nextExecutionMode === 'browser',
  );
}

export function browserPanelEvidenceHeaderStatus(
  status: UiTaskStatus | null | undefined,
  finalUrl?: string | null,
): BrowserPanelHeaderStatus {
  const label = '只读记录';
  const statusLabel = terminalEvidenceStatusLabel(status);
  const errorPage = isBrowserErrorUrl(finalUrl);
  return {
    label,
    tooltip: errorPage
      ? `${statusLabel}；当前为浏览器错误页截图，不能点击或输入`
      : `${statusLabel}；当前为结束时保存的截图，不能点击或输入`,
    tone: errorPage ? 'attention' : 'idle',
    dotStatus: errorPage ? 'error' : 'idle',
    showLabel: true,
  };
}

export function browserViewportFrameLabel(
  viewport: { width: number; height: number } | null | undefined,
): string {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return '视口未知';
  const size = `${viewport.width}×${viewport.height}`;
  const aspect = viewport.width / viewport.height;
  if (viewport.width <= 480 && aspect < 0.75) return `${size} · 竖屏视口`;
  if (viewport.width <= 720 && aspect < 0.9) return `${size} · 窄屏视口`;
  if (viewport.width >= 1200 && aspect > 1.3) return `${size} · 桌面帧`;
  return size;
}

export function browserViewportFooterLabel(inputs: {
  usingCdp: boolean;
  viewport: { width: number; height: number } | null | undefined;
}): string {
  return inputs.usingCdp
    ? '自适应视口'
    : browserViewportFrameLabel(inputs.viewport);
}

export function browserFrameCanPanInPortraitSheet(inputs: {
  isSheet: boolean;
  viewport: { width: number; height: number } | null | undefined;
  assumeScrollableWhenUnknown?: boolean;
}): boolean {
  if (!inputs.isSheet) return false;
  const { viewport } = inputs;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    return Boolean(inputs.assumeScrollableWhenUnknown);
  }
  return viewport.width / viewport.height > 1.12;
}

export function browserLiveOverlayCopy(inputs: {
  status: BrowserLiveStatus;
  showReconnect: boolean;
  taskIsTerminal?: boolean;
}): { title: string; detail: string; reconnectLabel: string } {
  if (inputs.taskIsTerminal) {
    if (inputs.showReconnect) {
      return {
        title: '浏览器工作区连接较慢',
        detail: '正在恢复当前任务的浏览器；成功后可以继续点击、输入或交给 AI。',
        reconnectLabel: '重连浏览器',
      };
    }
    return {
      title: '正在连接浏览器工作区',
      detail: '任务已结束，浏览器仍可接管操作，也可以继续交给 AI。',
      reconnectLabel: '重连浏览器',
    };
  }
  if (inputs.showReconnect) {
    if (inputs.status === 'disconnected') {
      return {
        title: '画面连接已断开',
        detail: '任务可能仍在后台执行。刷新只会重连画面，不会重新提交任务。',
        reconnectLabel: '重连画面',
      };
    }
    if (inputs.status === 'error') {
      return {
        title: '无法连接浏览器画面',
        detail: '画面连接没有建立成功。任务本身可能仍在处理，可以先重连画面。',
        reconnectLabel: '重连画面',
      };
    }
    return {
      title: '浏览器启动时间较久',
      detail: '浏览器可能还在打开网页。可以继续等待，或手动重连画面。',
      reconnectLabel: '重连画面',
    };
  }
  if (inputs.status === 'idle') {
    return {
      title: '正在准备浏览器',
      detail: 'HOLA DAY 会在任务需要网页操作时自动打开浏览器。',
      reconnectLabel: '重连画面',
    };
  }
  if (inputs.status === 'disconnected') {
    return {
      title: '正在恢复浏览器画面',
      detail: 'HOLA DAY 正在自动重连。你可以继续等待，任务不会重新提交。',
      reconnectLabel: '重连画面',
    };
  }
  if (inputs.status === 'error') {
    return {
      title: '浏览器画面暂时不可用',
      detail: '浏览器画面连接失败，任务可能仍在后台继续。',
      reconnectLabel: '重连画面',
    };
  }
  return {
    title: '正在连接浏览器',
    detail: '浏览器正在启动或恢复连接，任务会继续执行。',
    reconnectLabel: '重连画面',
  };
}

export function terminalBrowserTakeoverMessage(status: UiTaskStatus | null | undefined): string {
  return `${terminalEvidenceStatusLabel(status)}，正在恢复当前任务的浏览器。`;
}

export function browserReleasedCardCopy(): {
  title: string;
  detail: string;
  checkLabel: string;
  checkingLabel: string;
} {
  return {
    title: '浏览器会话已结束',
    detail: '当前任务的浏览器已关闭。新任务会自动打开新的浏览器。',
    checkLabel: '检查状态',
    checkingLabel: '检查中',
  };
}

export function browserWakeFeedback(
  status: string | null | undefined,
): { message: string; tone: 'info' | 'error' } {
  switch (status) {
    case 'ready':
      return { message: '已有任务浏览器可连接，正在刷新画面', tone: 'info' };
    case 'spawning':
      return { message: '浏览器正在启动，画面会自动连接', tone: 'info' };
    case 'unavailable':
      return {
        message: '当前没有正在运行的浏览器。新任务会自动打开浏览器。',
        tone: 'info',
      };
    default:
      return { message: '浏览器状态检查失败，请稍后重试', tone: 'error' };
  }
}

export function terminalBrowserMissingFrameCopy(inputs: {
  status: UiTaskStatus | null | undefined;
  hasFinalUrl: boolean;
  finalUrlIsError: boolean;
}): { title: string; body: string; actionLabel?: string } {
  const statusLabel = terminalEvidenceStatusLabel(inputs.status);
  if (inputs.finalUrlIsError) {
    return {
      title: `${statusLabel}，页面无法打开`,
      body: '任务结束在浏览器错误页。请检查网址是否正确，或换一个能直接访问的页面后重新执行。',
      actionLabel: '重新执行',
    };
  }
  if (inputs.hasFinalUrl) {
    return {
      title: `${statusLabel}，可打开最终页面复核`,
      body: '这次任务没有保存浏览器截图，但保留了最终地址。你可以打开页面核对结果。',
      actionLabel: '打开最终地址',
    };
  }
  return {
    title: '这条任务没有保存浏览器画面',
    body: '可以重新执行同样的意图，HOLA DAY 会打开新的浏览器并保留新的浏览器画面。',
    actionLabel: '重新执行',
  };
}

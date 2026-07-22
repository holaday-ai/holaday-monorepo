import { describe, expect, it } from 'vitest';
import {
  browserFrameCanPanInPortraitSheet,
  browserLiveOverlayCopy,
  browserStartupTargetUrl,
  browserWorkspaceTaskIntent,
  browserPanelHeaderStatus,
  browserControlAction,
  browserInputFallbackMode,
  browserPanelEvidenceHeaderStatus,
  browserReleasedCardCopy,
  taskOwnedBrowserFrame,
  taskOwnedBrowserUrl,
  terminalEvidenceFrameForTask,
  terminalEvidenceContinuation,
  browserViewportFooterLabel,
  browserViewportFrameLabel,
  browserWakeFeedback,
  isBrowserErrorUrl,
  browserPanelDotLabel,
  browserLiveStatusLabel,
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
  terminalEvidenceLayout,
  terminalBrowserMissingFrameCopy,
  terminalBrowserSessionUnavailable,
  terminalBrowserTakeoverMessage,
  terminalBrowserRecoveryRetryDelay,
  terminalBrowserRecoveryWindow,
  terminalEvidenceFrameLabel,
  terminalEvidenceStatusLabel,
} from './browser-panel-state';

describe('BrowserPanel state helpers', () => {
  it('turns a terminal takeover handoff into a focused AI follow-up', () => {
    expect(
      browserControlAction({ interactive: true, taskIsTerminal: true }),
    ).toEqual({
      nextInteractive: false,
      focusFollowUp: true,
      label: '交给 AI',
      ariaLabel: '交给 AI 继续',
      title: '交给 AI — 输入下一步指令后从当前页面继续',
    });
    expect(
      browserControlAction({ interactive: true, taskIsTerminal: false }),
    ).toEqual({
      nextInteractive: false,
      focusFollowUp: false,
      label: '交给 AI',
      ariaLabel: '退出浏览器接管',
      title: '退出接管 — AI 继续当前执行',
    });
    expect(
      browserControlAction({ interactive: false, taskIsTerminal: true }),
    ).toEqual({
      nextInteractive: true,
      focusFollowUp: false,
      label: '接管',
      ariaLabel: '接管浏览器',
      title: '接管浏览器 — 你的鼠标键盘直接控制浏览器',
    });
  });

  it('explains that a terminal browser needs a follow-up before AI resumes', () => {
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'connected',
        browserAwaiting: false,
        interactiveActive: true,
        showReconnect: false,
        taskIsTerminal: true,
      }),
    ).toMatchObject({
      label: '接管中',
      tooltip: '你正在直接操作浏览器；需要 AI 时点“交给 AI”并输入下一步指令',
    });
  });

  it('keeps the CDP text fallback compact until the user asks for it', () => {
    expect(
      browserInputFallbackMode({
        interactiveActive: false,
        usingCdp: true,
        fallbackOpen: false,
      }),
    ).toBe('hidden');
    expect(
      browserInputFallbackMode({
        interactiveActive: true,
        usingCdp: true,
        fallbackOpen: false,
      }),
    ).toBe('toggle');
    expect(
      browserInputFallbackMode({
        interactiveActive: true,
        usingCdp: true,
        fallbackOpen: true,
      }),
    ).toBe('bar');
    expect(
      browserInputFallbackMode({
        interactiveActive: true,
        usingCdp: false,
        fallbackOpen: false,
      }),
    ).toBe('bar');
  });

  it('retries a terminal browser restore quickly, then caps the quiet backoff', () => {
    expect(terminalBrowserRecoveryRetryDelay(1)).toBe(2_000);
    expect(terminalBrowserRecoveryRetryDelay(2)).toBe(4_000);
    expect(terminalBrowserRecoveryRetryDelay(3)).toBe(8_000);
    expect(terminalBrowserRecoveryRetryDelay(4)).toBe(15_000);
    expect(terminalBrowserRecoveryRetryDelay(9)).toBe(15_000);
  });

  it('keeps a painted terminal browser quiet through a brief reconnect', () => {
    expect(
      shouldSuspectTerminalBrowserSession({
        taskIsTerminal: true,
        liveStatus: 'disconnected',
        failedAttempts: 3,
        connectTimedOut: false,
        hasPresentedFrame: true,
      }),
    ).toBe(false);
    expect(
      shouldSuspectTerminalBrowserSession({
        taskIsTerminal: true,
        liveStatus: 'disconnected',
        failedAttempts: 3,
        connectTimedOut: true,
        hasPresentedFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldSuspectTerminalBrowserSession({
        taskIsTerminal: true,
        liveStatus: 'disconnected',
        failedAttempts: 2,
        connectTimedOut: false,
        hasPresentedFrame: false,
      }),
    ).toBe(true);
  });

  it('measures terminal recovery from the first disconnect, not each retry state', () => {
    const started = terminalBrowserRecoveryWindow({
      disconnected: true,
      disconnectedAt: null,
      now: 1_000,
      hasPresentedFrame: true,
    });
    expect(started).toEqual({
      disconnectedAt: 1_000,
      remainingMs: 12_000,
      timedOut: false,
    });

    expect(
      terminalBrowserRecoveryWindow({
        disconnected: true,
        disconnectedAt: started.disconnectedAt,
        now: 8_000,
        hasPresentedFrame: true,
      }),
    ).toEqual({
      disconnectedAt: 1_000,
      remainingMs: 5_000,
      timedOut: false,
    });
    expect(
      terminalBrowserRecoveryWindow({
        disconnected: true,
        disconnectedAt: started.disconnectedAt,
        now: 13_000,
        hasPresentedFrame: true,
      }),
    ).toEqual({
      disconnectedAt: 1_000,
      remainingMs: 0,
      timedOut: true,
    });
  });

  it('keeps the live surface mounted while a restorable terminal browser retries', () => {
    expect(
      terminalBrowserSessionUnavailable({
        sessionSuspected: true,
        canRestore: true,
        recoveryState: 'restoring',
        recoveryAttempt: 1,
      }),
    ).toBe(false);
    expect(
      terminalBrowserSessionUnavailable({
        sessionSuspected: true,
        canRestore: true,
        recoveryState: 'failed',
        recoveryAttempt: 3,
      }),
    ).toBe(false);
    expect(
      terminalBrowserSessionUnavailable({
        sessionSuspected: true,
        canRestore: true,
        recoveryState: 'ready',
        recoveryAttempt: 0,
      }),
    ).toBe(false);
    expect(
      terminalBrowserSessionUnavailable({
        sessionSuspected: true,
        canRestore: true,
        recoveryState: 'connected',
        recoveryAttempt: 2,
      }),
    ).toBe(false);
    expect(
      terminalBrowserSessionUnavailable({
        sessionSuspected: true,
        canRestore: false,
        hasPresentedFrame: true,
        recoveryState: 'failed',
        recoveryAttempt: 3,
      }),
    ).toBe(false);
    expect(
      terminalBrowserSessionUnavailable({
        sessionSuspected: true,
        canRestore: false,
        hasPresentedFrame: false,
        recoveryState: 'failed',
        recoveryAttempt: 3,
      }),
    ).toBe(true);
  });

  it('reconnects CDP in place after backend restore so the painted frame survives', () => {
    expect(
      shouldRemountBrowserStreamAfterRestore({ usingCdp: true }),
    ).toBe(false);
    expect(
      shouldRemountBrowserStreamAfterRestore({ usingCdp: false }),
    ).toBe(true);
  });

  it('preserves the painted canvas only for a browser follow-up of the visible task', () => {
    expect(
      shouldPreserveBrowserCanvasOnTaskSwitch({
        previousTaskId: 'tsk_parent',
        nextTaskId: 'tsk_child',
        nextReplyToTaskId: 'tsk_parent',
        nextExecutionMode: 'browser',
      }),
    ).toBe(true);
    expect(
      shouldPreserveBrowserCanvasOnTaskSwitch({
        previousTaskId: 'tsk_parent',
        nextTaskId: 'tsk_other',
        nextReplyToTaskId: null,
        nextExecutionMode: 'browser',
      }),
    ).toBe(false);
  });

  it('keeps fullscreen available for every inline browser workspace without crowding phone sheets', () => {
    expect(
      shouldShowBrowserFullscreen({
        available: true,
        workspaceIdle: false,
        isNarrow: true,
        isSheet: false,
        evidenceHeaderActive: true,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserFullscreen({
        available: true,
        workspaceIdle: false,
        isNarrow: true,
        isSheet: true,
        evidenceHeaderActive: true,
      }),
    ).toBe(false);
    expect(
      shouldShowBrowserFullscreen({
        available: true,
        workspaceIdle: false,
        isNarrow: true,
        isSheet: false,
        evidenceHeaderActive: false,
      }),
    ).toBe(true);
  });

  it('removes the evidence ledger from the fullscreen canvas', () => {
    expect(shouldShowTerminalEvidenceLedger(false)).toBe(true);
    expect(shouldShowTerminalEvidenceLedger(true)).toBe(false);
  });

  it('treats legacy desktop screenshots as compact previews in a narrow inline rail', () => {
    expect(
      terminalEvidenceLayout({
        isNarrow: true,
        isSheet: false,
        fullscreen: false,
        sourceAspect: 16 / 9,
        viewMode: 'contain',
      }),
    ).toBe('compact-preview');
    expect(
      terminalEvidenceLayout({
        isNarrow: true,
        isSheet: false,
        fullscreen: false,
        sourceAspect: 430 / 760,
        viewMode: 'contain',
      }),
    ).toBe('canvas');
    expect(
      terminalEvidenceLayout({
        isNarrow: true,
        isSheet: false,
        fullscreen: true,
        sourceAspect: 16 / 9,
        viewMode: 'contain',
      }),
    ).toBe('canvas');
    expect(
      terminalEvidenceLayout({
        isNarrow: false,
        isSheet: true,
        fullscreen: false,
        sourceAspect: 16 / 9,
        viewMode: 'contain',
      }),
    ).toBe('compact-preview');
    expect(
      terminalEvidenceLayout({
        isNarrow: false,
        isSheet: true,
        fullscreen: false,
        sourceAspect: 16 / 9,
        viewMode: 'readable',
      }),
    ).toBe('canvas');
  });

  it('attempts the live stream for browser records, including retained terminal sessions', () => {
    expect(
      shouldConnectBrowserStream({ isBrowserTask: true, taskIsTerminal: false }),
    ).toBe(true);
    expect(
      shouldConnectBrowserStream({ isBrowserTask: true, taskIsTerminal: true }),
    ).toBe(true);
    expect(
      shouldConnectBrowserStream({ isBrowserTask: false, taskIsTerminal: false }),
    ).toBe(false);
  });

  it('uses terminal evidence only after the retained browser becomes unavailable', () => {
    expect(
      shouldUseTerminalEvidence({
        taskIsTerminal: true,
        hasFinalEvidence: true,
        liveSessionUnavailable: false,
      }),
    ).toBe(false);
    expect(
      shouldUseTerminalEvidence({
        taskIsTerminal: true,
        hasFinalEvidence: true,
        liveSessionUnavailable: true,
      }),
    ).toBe(true);
    expect(
      shouldUseTerminalEvidence({
        taskIsTerminal: false,
        hasFinalEvidence: true,
        liveSessionUnavailable: true,
      }),
    ).toBe(false);
  });

  it('allows takeover on a retained terminal stream but never on its screenshot fallback', () => {
    expect(
      isBrowserInteractionActive({
        interactive: true,
        taskIsTerminal: true,
        useLiveStream: true,
        liveStatus: 'connected',
        hasLiveFrame: false,
        liveSessionUnavailable: false,
      }),
    ).toBe(true);
    expect(
      isBrowserInteractionActive({
        interactive: true,
        taskIsTerminal: true,
        useLiveStream: true,
        liveStatus: 'disconnected',
        hasLiveFrame: false,
        liveSessionUnavailable: false,
      }),
    ).toBe(false);
    expect(
      isBrowserInteractionActive({
        interactive: true,
        taskIsTerminal: true,
        useLiveStream: false,
        liveStatus: 'disconnected',
        hasLiveFrame: true,
        liveSessionUnavailable: true,
      }),
    ).toBe(false);
    expect(
      isBrowserInteractionActive({
        interactive: true,
        taskIsTerminal: false,
        useLiveStream: false,
        liveStatus: 'idle',
        hasLiveFrame: true,
        liveSessionUnavailable: false,
      }),
    ).toBe(true);
  });

  it('keeps a rendered browser visible while its live transport reconnects', () => {
    expect(
      shouldShowBrowserLiveOverlay({
        liveStatus: 'connecting',
        showReconnect: false,
        hasPresentedFrame: false,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserLiveOverlay({
        liveStatus: 'connected',
        showReconnect: false,
        hasPresentedFrame: false,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserLiveOverlay({
        liveStatus: 'connecting',
        showReconnect: false,
        hasPresentedFrame: true,
      }),
    ).toBe(false);
    expect(
      shouldShowBrowserLiveOverlay({
        liveStatus: 'disconnected',
        showReconnect: true,
        hasPresentedFrame: true,
      }),
    ).toBe(false);
  });

  it('never exposes a cached URL owned by the previously selected task', () => {
    const cachedUrl = {
      taskId: 'tsk_previous',
      url: 'https://previous.example',
    };

    expect(taskOwnedBrowserUrl('tsk_current', cachedUrl)).toBeNull();
    expect(taskOwnedBrowserUrl('tsk_previous', cachedUrl)).toBe(
      'https://previous.example',
    );
    expect(taskOwnedBrowserUrl(null, cachedUrl)).toBeNull();
  });

  it('never substitutes another task frame when the active task has no frame', () => {
    const otherTaskFrame = {
      tickIndex: 8,
      imageBase64: 'other-task-frame',
      url: 'https://other.example',
      viewport: { width: 1280, height: 720 },
      timestamp: '2026-07-17T00:00:00.000Z',
    };

    expect(
      taskOwnedBrowserFrame({
        taskIsTerminal: false,
        liveFrame: null,
        finalEvidenceFrame: null,
      }),
    ).toBeNull();
    expect(
      taskOwnedBrowserFrame({
        taskIsTerminal: false,
        liveFrame: otherTaskFrame,
        finalEvidenceFrame: null,
      }),
    ).toBe(otherTaskFrame);
  });

  it('keeps a retained terminal browser live until the review session is unavailable', () => {
    const retainedLiveFrame = {
      tickIndex: 9,
      imageBase64: 'retained-live-frame',
      url: 'https://example.com/continued',
      viewport: { width: 1280, height: 720 },
      timestamp: '2026-07-20T00:00:00.000Z',
    };
    const savedEvidenceFrame = {
      tickIndex: -1,
      imageBase64: 'saved-terminal-evidence',
      url: 'https://example.com/result',
      viewport: { width: 1280, height: 720 },
      timestamp: '2026-07-20T00:00:00.000Z',
    };

    expect(
      taskOwnedBrowserFrame({
        taskIsTerminal: true,
        liveFrame: retainedLiveFrame,
        finalEvidenceFrame: savedEvidenceFrame,
        preferLiveTerminalSession: true,
      }),
    ).toBe(retainedLiveFrame);
    expect(
      taskOwnedBrowserFrame({
        taskIsTerminal: true,
        liveFrame: retainedLiveFrame,
        finalEvidenceFrame: savedEvidenceFrame,
        preferLiveTerminalSession: false,
      }),
    ).toBe(savedEvidenceFrame);
  });

  it('rehydrates persisted terminal screenshots as task-owned browser evidence', () => {
    const liveFrame = {
      tickIndex: 8,
      imageBase64: 'stale-live-frame',
      url: 'https://stale.example',
      viewport: { width: 1280, height: 720 },
      timestamp: '2026-07-17T00:00:00.000Z',
    };

    expect(
      terminalEvidenceFrameForTask({
        taskIsTerminal: true,
        task: {
          finalScreenshot: 'persisted-terminal-frame',
          finalUrl: 'https://example.com/result',
          finalViewport: { width: 1550, height: 650 },
          createdAt: new Date('2026-07-18T00:00:00.000Z'),
        },
        liveFrame,
      }),
    ).toEqual({
      frame: {
        tickIndex: -1,
        imageBase64: 'persisted-terminal-frame',
        url: 'https://example.com/result',
        viewport: { width: 1550, height: 650 },
        timestamp: '2026-07-18T00:00:00.000Z',
      },
      source: 'saved-screenshot',
    });
  });

  it('turns a bare domain into a browser task with a secure URL', () => {
    expect(browserWorkspaceTaskIntent(' example.com/products ')).toBe(
      '打开 https://example.com/products',
    );
  });

  it('keeps explicit web URLs and converts plain text into a browser search task', () => {
    expect(browserWorkspaceTaskIntent('http://localhost:3000/docs')).toBe(
      '打开 http://localhost:3000/docs',
    );
    expect(browserWorkspaceTaskIntent('今天的 AI 新闻')).toBe(
      '打开浏览器并搜索：今天的 AI 新闻',
    );
  });

  it('refuses empty input and unsafe URL schemes', () => {
    expect(browserWorkspaceTaskIntent('   ')).toBeNull();
    expect(browserWorkspaceTaskIntent('javascript:alert(1)')).toBeNull();
    expect(browserWorkspaceTaskIntent('file:///etc/passwd')).toBeNull();
  });

  it('recovers the requested URL while a browser task is still starting', () => {
    expect(browserStartupTargetUrl('打开 https://example.com/products')).toBe(
      'https://example.com/products',
    );
    expect(browserStartupTargetUrl('打开 http://localhost:3000/docs')).toBe(
      'http://localhost:3000/docs',
    );
  });

  it('does not present search prompts or arbitrary task text as a reached URL', () => {
    expect(browserStartupTargetUrl('打开浏览器并搜索：今天的 AI 新闻')).toBeNull();
    expect(browserStartupTargetUrl('分析 example.com 的首页')).toBeNull();
    expect(browserStartupTargetUrl(null)).toBeNull();
  });

  it('does not show browser chrome for a terminal task with no task-owned evidence', () => {
    expect(
      shouldShowBrowserHeader({
        taskIsTerminal: true,
        hasCurrentFrame: false,
        hasFinalEvidence: false,
        interactiveActive: false,
        hasLiveStream: false,
      }),
    ).toBe(false);
  });

  it('shows browser chrome for live tasks and terminal tasks with their own evidence', () => {
    expect(
      shouldShowBrowserHeader({
        taskIsTerminal: false,
        hasCurrentFrame: false,
        hasFinalEvidence: false,
        interactiveActive: false,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserHeader({
        taskIsTerminal: true,
        hasCurrentFrame: false,
        hasFinalEvidence: true,
        interactiveActive: false,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserHeader({
        taskIsTerminal: true,
        hasCurrentFrame: false,
        hasFinalEvidence: false,
        interactiveActive: false,
        hasLiveStream: true,
      }),
    ).toBe(true);
  });

  it('labels terminal browser evidence by the actual task status', () => {
    expect(terminalEvidenceStatusLabel('completed')).toBe('任务已完成');
    expect(terminalEvidenceStatusLabel('partial_success')).toBe('任务需复核');
    expect(terminalEvidenceStatusLabel('failed')).toBe('任务未完成');
    expect(terminalEvidenceStatusLabel('cancelled')).toBe('任务已取消');
    expect(terminalEvidenceStatusLabel('executing')).toBe('任务已结束');
    expect(terminalEvidenceStatusLabel(null)).toBe('任务已结束');
    expect(
      terminalEvidenceFrameLabel({ status: 'completed', url: 'https://example.com/' }),
    ).toBe('任务已完成 · 浏览器页面');
  });

  it('labels live browser connection states for icon-only status dots', () => {
    expect(browserLiveStatusLabel('idle')).toBe('等待浏览器画面');
    expect(browserLiveStatusLabel('connecting')).toBe('浏览器画面连接中');
    expect(browserLiveStatusLabel('connected')).toBe('浏览器画面已连接');
    expect(browserLiveStatusLabel('disconnected')).toBe('浏览器画面已断开');
    expect(browserLiveStatusLabel('error')).toBe('浏览器画面连接失败');
  });

  it('keeps the browser status dot label neutral for action-needed states', () => {
    expect(browserPanelDotLabel('idle')).toBe('等待浏览器画面');
    expect(browserPanelDotLabel('live')).toBe('浏览器画面已连接');
    expect(browserPanelDotLabel('error')).toBe('需要处理');
  });

  it('derives compact header labels from the browser live state', () => {
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'disconnected',
        browserAwaiting: false,
        interactiveActive: false,
        showReconnect: false,
        hasPresentedFrame: true,
      }),
    ).toMatchObject({
      label: '续接中',
      tone: 'recovering',
      dotStatus: 'live',
      showLabel: true,
    });
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'connecting',
        browserAwaiting: false,
        interactiveActive: false,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '连接中',
      tone: 'live',
      dotStatus: 'live',
      showLabel: true,
    });
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'disconnected',
        browserAwaiting: false,
        interactiveActive: false,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '恢复中',
      tone: 'recovering',
      dotStatus: 'live',
      showLabel: true,
    });
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'disconnected',
        browserAwaiting: false,
        interactiveActive: false,
        showReconnect: true,
      }),
    ).toMatchObject({
      label: '已断开',
      tone: 'recovering',
      dotStatus: 'error',
      showLabel: true,
    });
  });

  it('labels expired terminal sessions without implying a live browser', () => {
    expect(browserPanelEvidenceHeaderStatus('completed')).toEqual({
      label: '只读记录',
      tooltip: '任务已完成；当前为结束时保存的截图，不能点击或输入',
      tone: 'idle',
      dotStatus: 'idle',
      showLabel: true,
    });
  });

  it('restores terminal evidence into the current task browser session', () => {
    expect(
      terminalEvidenceContinuation('https://example.com/final?from=task'),
    ).toEqual({
      intent: '打开 https://example.com/final?from=task',
      label: '恢复可操作浏览器',
      pendingLabel: '正在恢复浏览器…',
      description: '在当前任务恢复到最后页面，继续点击、输入或交给 AI。',
    });
    expect(terminalEvidenceContinuation('chrome-error://chromewebdata/')).toBeNull();
    expect(terminalEvidenceContinuation('javascript:alert(1)')).toBeNull();
    expect(terminalEvidenceContinuation(null)).toBeNull();
  });

  it('marks browser error pages as unsuccessful final browser evidence', () => {
    expect(isBrowserErrorUrl('chrome-error://chromewebdata/')).toBe(true);
    expect(isBrowserErrorUrl('edge-error://edgewebdata/')).toBe(true);
    expect(isBrowserErrorUrl('about:neterror?e=dnsNotFound')).toBe(true);
    expect(isBrowserErrorUrl('https://example.com/')).toBe(false);
    expect(
      terminalEvidenceFrameLabel({
        status: 'completed',
        url: 'chrome-error://chromewebdata/',
      }),
    ).toBe('页面无法打开 · 浏览器页面');
    expect(
      browserPanelEvidenceHeaderStatus(
        'completed',
        'chrome-error://chromewebdata/',
      ),
    ).toEqual({
      label: '只读记录',
      tooltip: '任务已完成；当前为浏览器错误页截图，不能点击或输入',
      tone: 'attention',
      dotStatus: 'error',
      showLabel: true,
    });
  });

  it('labels screencast frame geometry so narrow panels are easy to verify', () => {
    expect(browserViewportFrameLabel(null)).toBe('视口未知');
    expect(browserViewportFrameLabel({ width: 430, height: 760 })).toBe(
      '430×760 · 竖屏视口',
    );
    expect(browserViewportFrameLabel({ width: 560, height: 720 })).toBe(
      '560×720 · 窄屏视口',
    );
    expect(browserViewportFrameLabel({ width: 1280, height: 800 })).toBe(
      '1280×800 · 桌面帧',
    );
  });

  it('does not present the saved task viewport as the live adaptive CDP size', () => {
    expect(
      browserViewportFooterLabel({
        usingCdp: true,
        viewport: { width: 430, height: 760 },
      }),
    ).toBe('自适应视口');
    expect(
      browserViewportFooterLabel({
        usingCdp: false,
        viewport: { width: 430, height: 760 },
      }),
    ).toBe('430×760 · 竖屏视口');
  });

  it('only hints horizontal panning for wide browser frames in portrait sheets', () => {
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: true,
        viewport: { width: 1280, height: 800 },
      }),
    ).toBe(true);
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: true,
        viewport: { width: 430, height: 760 },
      }),
    ).toBe(false);
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: false,
        viewport: { width: 1280, height: 800 },
      }),
    ).toBe(false);
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: true,
        viewport: null,
        assumeScrollableWhenUnknown: true,
      }),
    ).toBe(true);
  });

  it('prioritises awaiting-user and takeover states over transport labels', () => {
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'connected',
        browserAwaiting: true,
        interactiveActive: true,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '待操作',
      tone: 'attention',
      dotStatus: 'error',
    });
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'disconnected',
        browserAwaiting: false,
        interactiveActive: false,
        interactiveOwned: true,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '接管保留',
      tone: 'recovering',
      dotStatus: 'live',
    });
  });

  it('explains slow browser live-view connections before offering reconnect', () => {
    expect(
      browserLiveOverlayCopy({ status: 'connecting', showReconnect: false }),
    ).toEqual({
      title: '正在连接浏览器',
      detail: '浏览器正在启动或恢复连接，任务会继续执行。',
      reconnectLabel: '重连画面',
    });
    expect(
      browserLiveOverlayCopy({ status: 'connecting', showReconnect: true }),
    ).toEqual({
      title: '浏览器启动时间较久',
      detail: '浏览器可能还在打开网页。可以继续等待，或手动重连画面。',
      reconnectLabel: '重连画面',
    });
  });

  it('describes terminal review reconnection without claiming the task is still running', () => {
    expect(
      browserLiveOverlayCopy({
        status: 'connecting',
        showReconnect: false,
        taskIsTerminal: true,
      }),
    ).toEqual({
      title: '正在连接浏览器工作区',
      detail: '任务已结束，浏览器仍可接管操作，也可以继续交给 AI。',
      reconnectLabel: '重连浏览器',
    });
  });

  it('keeps persistent disconnected live views recoverable without implying a rerun', () => {
    expect(
      browserLiveOverlayCopy({ status: 'disconnected', showReconnect: false }),
    ).toEqual({
      title: '正在恢复浏览器画面',
      detail: 'HOLA DAY 正在自动重连。你可以继续等待，任务不会重新提交。',
      reconnectLabel: '重连画面',
    });
    expect(
      browserLiveOverlayCopy({ status: 'disconnected', showReconnect: true }),
    ).toEqual({
      title: '画面连接已断开',
      detail: '任务可能仍在后台执行。刷新只会重连画面，不会重新提交任务。',
      reconnectLabel: '重连画面',
    });
  });

  it('explains persistent live-view errors as view-only recovery', () => {
    expect(
      browserLiveOverlayCopy({ status: 'error', showReconnect: true }),
    ).toEqual({
      title: '无法连接浏览器画面',
      detail: '画面连接没有建立成功。任务本身可能仍在处理，可以先重连画面。',
      reconnectLabel: '重连画面',
    });
  });

  it('keeps terminal takeover refusal tied to task state', () => {
    expect(terminalBrowserTakeoverMessage('failed')).toBe(
      '任务未完成，正在恢复当前任务的浏览器。',
    );
  });

  it('frames missing terminal browser frames as a next action, not lost evidence', () => {
    expect(
      terminalBrowserMissingFrameCopy({
        status: 'completed',
        hasFinalUrl: true,
        finalUrlIsError: false,
      }),
    ).toEqual({
      title: '任务已完成，可打开最终页面复核',
      body: '这次任务没有保存浏览器截图，但保留了最终地址。你可以打开页面核对结果。',
      actionLabel: '打开最终地址',
    });
    expect(
      terminalBrowserMissingFrameCopy({
        status: 'failed',
        hasFinalUrl: false,
        finalUrlIsError: true,
      }),
    ).toEqual({
      title: '任务未完成，页面无法打开',
      body: '任务结束在浏览器错误页。请检查网址是否正确，或换一个能直接访问的页面后重新执行。',
      actionLabel: '重新执行',
    });
    expect(
      terminalBrowserMissingFrameCopy({
        status: 'cancelled',
        hasFinalUrl: false,
        finalUrlIsError: false,
      }),
    ).toEqual({
      title: '这条任务没有保存浏览器画面',
      body: '可以重新执行同样的意图，HOLA DAY 会打开新的浏览器并保留新的浏览器画面。',
      actionLabel: '重新执行',
    });
  });

  it('keeps the released-browser card about the browser, not task outcome', () => {
    expect(browserReleasedCardCopy()).toEqual({
      title: '浏览器会话已结束',
      detail: '当前任务的浏览器已关闭。新任务会自动打开新的浏览器。',
      checkLabel: '检查状态',
      checkingLabel: '检查中',
    });
  });

  it('explains wake-browser results without promising a stale browser', () => {
    expect(browserWakeFeedback('ready')).toEqual({
      message: '已有任务浏览器可连接，正在刷新画面',
      tone: 'info',
    });
    expect(browserWakeFeedback('spawning')).toEqual({
      message: '浏览器正在启动，画面会自动连接',
      tone: 'info',
    });
    expect(browserWakeFeedback('unavailable')).toEqual({
      message: '当前没有正在运行的浏览器。新任务会自动打开浏览器。',
      tone: 'info',
    });
    expect(browserWakeFeedback('weird')).toEqual({
      message: '浏览器状态检查失败，请稍后重试',
      tone: 'error',
    });
  });
});

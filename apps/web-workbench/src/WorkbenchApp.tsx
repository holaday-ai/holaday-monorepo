import * as React from 'react';
import { type PlanId } from '@holaday/shared-types';
import { useAppShellContext } from '@/components/AppShell';
import { BrowserPanel } from '@/components/BrowserPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MainPanel } from '@/components/MainPanel';
import { ModelDataRegionDialog } from '@/components/ModelDataRegionDialog';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  clearComposerOnSubmitSuccess,
  keepComposerOnSubmitFailure,
  type ComposerSubmitResult,
} from '@/components/composer-submit';
import { useToast } from '@/components/ui/toast';
import { useSidebar } from '@/components/ui/sidebar';
import { hdDebug } from '@/lib/hd-debug';
import { taskActionError } from '@/lib/error-copy';
import { useRegionGatedTaskSubmit } from '@/hooks/useRegionGatedTaskSubmit';
import type { ModelDataRegion } from '@/lib/model-data-region-state';
import { trpc } from '@/lib/trpc';
import {
  clampInlineBrowserPanelWidth,
  estimateInlineBrowserPanelWidth,
  pickWorkbenchBrowserViewportProfile,
} from '@/lib/browser-viewport-profile';
import {
  enterBrowserFullscreen,
  exitBrowserFullscreen,
  isBrowserFullscreenActive,
} from '@/lib/browser-fullscreen';
import {
  isWorkbenchDesktopWidth,
  isWorkbenchMobileWidth,
  isWorkbenchWideWidth,
  workbenchInlineColumnMinimums,
  WORKBENCH_DESKTOP_BREAKPOINT_PX,
  WORKBENCH_MOBILE_BREAKPOINT_PX,
  WORKBENCH_WIDE_BREAKPOINT_PX,
} from '@/lib/workbench-breakpoints';
import {
  followUpTargetForTask,
  hasBrowserRecordForWorkbench,
  isLiveBrowserTaskForWorkbench,
  isWorkbenchTerminalTask,
  mobileBrowserSheetAutoOpenState,
  preserveBrowserRecordAfterLive,
  taskFrameForWorkbench,
} from '@/lib/workbench-state';
import { useTaskStore } from '@/stores/task-store';
import { isQuotaExhausted, useQuotaStatus } from '@/lib/use-quota-status';
import {
  computeSidePanelMode,
  needsBrowserViewport,
  sidePanelModeForToolbar,
  type SidePanelMode,
  type SidePanelOverride,
} from '@/types/side-panel';
import type { UiSkillSelection, UiTask } from '@/types/task';

type UiTaskAwaitingKind = NonNullable<UiTask['awaitingKind']> | undefined;

interface FreshTaskSubmitPayload {
  readonly intent: string;
  readonly fileIds: string[];
  readonly mode?: 'auto' | 'plan';
  readonly expertMode?: 'normal' | 'expert' | 'auto';
  readonly skillSelection?: UiSkillSelection;
}

/**
 * Inner workbench content. Mounted as the `/` outlet of AppShell so
 * it inherits the unified Sidebar + shared modals + bootstrap +
 * keyboard shortcuts from the shell. WorkbenchApp itself only owns:
 *
 *   - the BrowserPanel layout state (px width, fullscreen, collapse,
 *     manual-override)
 *   - the reply-flow rebuild-task confirm (specific to tasks.reply)
 *   - the follow-up-dismissed flag for the chip suppression on the
 *     selected terminal task
 *   - the onSubmit routing that splits between tasks.reply / follow-up
 *     create / fresh create
 *
 * Auth, bootstrap, Sidebar, search overlay, settings modal, feedback
 * modal, single+bulk task delete confirms, online/offline toasts and
 * the shell keyboard shortcuts all live in AppShell.
 */
export function WorkbenchApp(): JSX.Element {
  const toast = useToast();
  const {
    me,
    refreshMe,
    browserWorkbenchOpen,
    openBrowserWorkbench,
    closeBrowserWorkbench,
    setBrowserAdaptiveSidebarCollapsed,
  } = useAppShellContext();
  const { setOpenMobile } = useSidebar();
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Inner-workbench state.
  const [panelFullscreen, setPanelFullscreen] = React.useState(false);
  const [browserSheetOpen, setBrowserSheetOpen] = React.useState(false);
  const mobileBrowserSheetAutoOpenedKeyRef = React.useRef<string | null>(null);
  /**
   * BUG-11 follow-up — viewport breakpoint flag. The inline desktop
   * panel used to stay mounted behind CSS breakpoints, so hidden
   * and visible browser surfaces could both keep a screencast socket
   * alive. Now the render tree has one lane per viewport: inline from
   * tablet width upward, and a mobile sheet below that.
   *
   * Track the breakpoint in state (not just a ref) so the render
   * tree updates on resize. matchMedia keeps the listener cheap.
   */
  /**
   * Codex-style same-plane responsive breakpoint:
   *   - tablet / desktop >= 768px → inline split panel
   *   - compact < 768px → bottom workspace
   *   - wide desktop >= 1360px → user-resizable split
   *
   * Compact inline widths also collapse the app sidebar, leaving the
   * task and browser as true flex siblings instead of floating the
   * browser above task content. Only phone widths use a focused sheet.
   */
  const [isDesktop, setIsDesktop] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return isWorkbenchDesktopWidth(window.innerWidth);
  });
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isWorkbenchMobileWidth(window.innerWidth);
  });
  const [isWideDesktop, setIsWideDesktop] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return isWorkbenchWideWidth(window.innerWidth);
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const desktopMq = window.matchMedia(
      `(min-width: ${WORKBENCH_DESKTOP_BREAKPOINT_PX}px)`,
    );
    const mobileMq = window.matchMedia(
      `(min-width: ${WORKBENCH_MOBILE_BREAKPOINT_PX}px)`,
    );
    const wideMq = window.matchMedia(
      `(min-width: ${WORKBENCH_WIDE_BREAKPOINT_PX}px)`,
    );
    const onDesktop = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    const onMobile = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    const onWide = (e: MediaQueryListEvent) => setIsWideDesktop(e.matches);
    desktopMq.addEventListener('change', onDesktop);
    mobileMq.addEventListener('change', onMobile);
    wideMq.addEventListener('change', onWide);
    return () => {
      desktopMq.removeEventListener('change', onDesktop);
      mobileMq.removeEventListener('change', onMobile);
      wideMq.removeEventListener('change', onWide);
    };
  }, []);
  const isCompactInlineViewport = isDesktop && !isWideDesktop;
  const inlineColumnMinimums = React.useMemo(
    () => workbenchInlineColumnMinimums({ isWideDesktop }),
    [isWideDesktop],
  );
  // Pre-B2 callers that branched on `isLg` (inline-vs-sheet) keep this
  // alias while the breakpoint now means tablet-and-up.
  const isLg = isDesktop;

  React.useEffect(() => {
    if (!isMobile && browserSheetOpen) setBrowserSheetOpen(false);
  }, [browserSheetOpen, isMobile]);
  /**
   * When the user crosses the inline boundary while the panel is open,
   * bridge between the inline surface and the stateful mobile sheet so
   * the browser does not disappear during a window resize.
   */
  const prevIsLgRef = React.useRef(isLg);
  React.useEffect(() => {
    const wasLg = prevIsLgRef.current;
    prevIsLgRef.current = isLg;
    if (wasLg === isLg) return;
    if (wasLg && !isLg && sidePanelOverride !== 'close' && isMobile) {
      setBrowserSheetOpen(true);
    }
    if (!wasLg && isLg && browserSheetOpen) {
      setBrowserSheetOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLg, isMobile]);
  // Single side-panel intent flag. `null` = use the default (live
  // tasks auto-open, terminal tasks stay hidden); `'open'` /
  // `'close'` forces the panel one way regardless of the default.
  // Resets on every task switch so a stale intent from task A
  // doesn't follow into task B. This single flag replaces the
  // previous three (browserCollapsed / userOpenedBrowserPanel /
  // showBrowserPanel) that were fighting each other.
  const [sidePanelOverride, setSidePanelOverride] =
    React.useState<SidePanelOverride>(null);
  const [confirmRebuildTask, setConfirmRebuildTask] = React.useState<{
    taskId: string;
    intent: string;
    pendingMessage: string;
  } | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // BrowserPanel width — explicit px from drag, persisted in
  // localStorage, clamped against both panel and main-column floors so
  // a stale saved width cannot crush the composer on the next visit.
  const contentRowRef = React.useRef<HTMLDivElement | null>(null);
  const enterPanelFullscreen = React.useCallback(async (): Promise<void> => {
    setPanelFullscreen(true);
    const mode = await enterBrowserFullscreen(contentRowRef.current);
    hdDebug('browser fullscreen entered', { mode });
  }, []);
  const exitPanelFullscreen = React.useCallback(async (): Promise<void> => {
    await exitBrowserFullscreen(document, contentRowRef.current);
    if (mountedRef.current) setPanelFullscreen(false);
  }, []);
  const togglePanelFullscreen = React.useCallback((): void => {
    if (panelFullscreen) {
      void exitPanelFullscreen();
      return;
    }
    void enterPanelFullscreen();
  }, [enterPanelFullscreen, exitPanelFullscreen, panelFullscreen]);
  React.useEffect(() => {
    const onFullscreenChange = (): void => {
      if (isBrowserFullscreenActive(document, contentRowRef.current)) return;
      setPanelFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  const [panelPx, setPanelPx] = React.useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem('holaday.panelPx');
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    const maxSensible = window.innerWidth * 0.85;
    if (n < PANEL_MIN_PX || n > maxSensible) return null;
    return n;
  });
  const dragStartPxRef = React.useRef<number | null>(null);
  const panelPxRef = React.useRef(panelPx);
  React.useEffect(() => {
    panelPxRef.current = panelPx;
  }, [panelPx]);

  const computeInitialPanelPx = React.useCallback((): number => {
    const row = contentRowRef.current;
    if (!row) return Math.max(PANEL_MIN_PX, Math.round(window.innerWidth * 0.5));
    const rect = row.getBoundingClientRect();
    return estimateInlineBrowserPanelWidth({
      rowWidth: rect.width,
      explicitPanelWidth: null,
      panelMinWidth: PANEL_MIN_PX,
      mainMinWidth: MAIN_PANEL_MIN_PX,
    }) ?? Math.max(PANEL_MIN_PX, Math.round(window.innerWidth * 0.5));
  }, []);
  const onPanelResizeDrag = React.useCallback(
    (dx: number) => {
      const row = contentRowRef.current;
      if (!row) return;
      if (dragStartPxRef.current === null) {
        dragStartPxRef.current = panelPxRef.current ?? computeInitialPanelPx();
      }
      const rowWidth = row.getBoundingClientRect().width;
      const raw = dragStartPxRef.current - dx;
      setPanelPx(
        clampInlineBrowserPanelWidth({
          width: raw,
          rowWidth,
          panelMinWidth: PANEL_MIN_PX,
          mainMinWidth: MAIN_PANEL_MIN_PX,
        }),
      );
    },
    [computeInitialPanelPx],
  );
  React.useEffect(() => {
    if (
      !isDesktop ||
      isCompactInlineViewport ||
      panelPx == null ||
      typeof ResizeObserver === 'undefined'
    ) return;
    const row = contentRowRef.current;
    if (!row) return;

    const clampToRow = (): void => {
      const next = clampInlineBrowserPanelWidth({
        width: panelPxRef.current,
        rowWidth: row.getBoundingClientRect().width,
        panelMinWidth: PANEL_MIN_PX,
        mainMinWidth: MAIN_PANEL_MIN_PX,
      });
      if (next != null && next !== panelPxRef.current) {
        setPanelPx(next);
      }
    };

    clampToRow();
    const ro = new ResizeObserver(clampToRow);
    ro.observe(row);
    return () => ro.disconnect();
  }, [isCompactInlineViewport, isDesktop, panelPx]);
  const onPanelResizeEnd = React.useCallback(() => {
    dragStartPxRef.current = null;
    const current = panelPxRef.current;
    if (current != null) {
      window.localStorage.setItem('holaday.panelPx', String(current));
    }
  }, []);

  // Task store selectors.
  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const composerMode = useTaskStore((s) => s.composerMode);
  const enterNewTaskMode = useTaskStore((s) => s.enterNewTaskMode);
  const setDefaultViewportProfile = useTaskStore((s) => s.setDefaultViewportProfile);
  const createTaskRaw = useTaskStore((s) => s.createTask);
  const pickCurrentViewportProfile = React.useCallback(() => {
    const rowRect = contentRowRef.current?.getBoundingClientRect();
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 800;
    return pickWorkbenchBrowserViewportProfile({
      viewportWidth,
      viewportHeight,
      rowWidth: rowRect?.width ?? null,
      rowHeight: rowRect?.height ?? null,
      explicitPanelWidth: isCompactInlineViewport ? null : panelPx,
      isTablet: false,
      fullscreen: panelFullscreen,
      panelMinWidth: inlineColumnMinimums.browser,
      mainMinWidth: inlineColumnMinimums.main,
      panelChromeHeight: PANEL_CHROME_ESTIMATE_PX,
    });
  }, [inlineColumnMinimums, isCompactInlineViewport, panelFullscreen, panelPx]);
  React.useEffect(() => {
    setDefaultViewportProfile(pickCurrentViewportProfile());
  }, [pickCurrentViewportProfile, setDefaultViewportProfile]);
  const createTask: typeof createTaskRaw = React.useCallback(
    (
      intent,
      fileIds,
      replyToTaskId,
      mode,
      expertMode,
      viewportProfile,
      videoOptions,
      skillSelection,
    ) => {
      // Pack C1 added `expertMode` at position 5; viewportProfile
      // moved to position 6. The wrapper still auto-picks viewport
      // from the current panel layout when callers don't pass one.
      const picked = viewportProfile ?? pickCurrentViewportProfile();
      return createTaskRaw(
        intent,
        fileIds,
        replyToTaskId,
        mode,
        expertMode,
        picked,
        videoOptions,
        skillSelection,
      );
    },
    [createTaskRaw, pickCurrentViewportProfile],
  );

  const submitFreshTask = React.useCallback(
    async ({
      intent,
      fileIds,
      mode,
      expertMode,
      skillSelection,
    }: FreshTaskSubmitPayload): Promise<ComposerSubmitResult> => {
      const res = await createTask(
        intent,
        fileIds,
        undefined,
        mode,
        expertMode,
        undefined,
        undefined,
        skillSelection,
      );
      if ('error' in res) {
        const codeRejected =
          res.error.includes('HOLA DAY 专注浏览器任务') ||
          res.error.includes('代码开发请用') ||
          res.error.includes('Claude Code 或 Cursor');
        if (codeRejected) {
          toast.show(
            'HOLA DAY 专注浏览器任务执行（搜索、填表、数据采集等）。代码开发建议使用 Claude Code 或 Cursor。',
          );
        } else {
          toast.show(taskActionError('发送失败', res.error), 'error');
        }
        return keepComposerOnSubmitFailure;
      }
      return clearComposerOnSubmitSuccess;
    },
    [createTask, toast],
  );
  const assignModelDataRegion = React.useCallback(async (region: ModelDataRegion) => {
    await trpc.auth.assignModelDataRegion.mutate({ region });
  }, []);
  const regionGatedSubmit = useRegionGatedTaskSubmit({
    region: me?.modelDataRegion ?? null,
    assignRegion: assignModelDataRegion,
    refreshMe,
    submit: submitFreshTask,
  });
  const replyToTask = useTaskStore((s) => s.replyToTask);
  const awaitingUserByTask = useTaskStore((s) => s.awaitingUserByTask);
  const userRepliesByTask = useTaskStore((s) => s.userRepliesByTask);
  const screencastByTask = useTaskStore((s) => s.screencastByTask);
  const captchaWaitByTask = useTaskStore((s) => s.captchaWaitByTask);
  const browserInteractive = useTaskStore((s) => s.browserInteractive);

  // Quota gate.
  const planForRetention: PlanId =
    me?.plan === 'basic' || me?.plan === 'pro' ? me.plan : 'free';
  const { snap: quotaSnap } = useQuotaStatus(tasks.length);
  const quotaExhausted = isQuotaExhausted(quotaSnap);

  // Awaiting / browser derivations.
  const selectedNeedsUser = Boolean(
    selectedTaskId &&
      (awaitingUserByTask[selectedTaskId] ||
        captchaWaitByTask[selectedTaskId] ||
        (tasks.find((t) => t.taskId === selectedTaskId)?.status as
          | string
          | undefined) === 'awaiting_user'),
  );
  const selectedAwaitingKind: UiTaskAwaitingKind = (() => {
    if (!selectedTaskId) return undefined;
    const fromAwaiting = awaitingUserByTask[selectedTaskId]?.awaitingKind;
    if (fromAwaiting) return fromAwaiting;
    const fromTask = tasks.find((t) => t.taskId === selectedTaskId)?.awaitingKind;
    return fromTask;
  })();
  const selectedNeedsBrowser = needsBrowserViewport({
    hasSelectedTask: Boolean(selectedTaskId),
    captchaWait: Boolean(selectedTaskId && captchaWaitByTask[selectedTaskId]),
    needsUser: selectedNeedsUser,
    awaitingKind: selectedAwaitingKind,
  });

  // Reset the side-panel intent on task switch so a manual open/close
  // from task A doesn't follow into task B — each task starts from
  // its default (live → open, terminal → closed).
  React.useEffect(() => {
    setSidePanelOverride(null);
  }, [selectedTaskId]);

  // P1.2 — every newTask entry point lands here when selectedTaskId
  // flips to null. Kill any layout state that would otherwise survive
  // the transition and leave the user staring at a fullscreen
  // BrowserPanel of nothing (or an empty mobile sheet). The composer
  // mode + URL strip is already handled inside the store action.
  React.useEffect(() => {
    if (selectedTaskId || browserWorkbenchOpen) return;
    void exitPanelFullscreen();
    setBrowserSheetOpen(false);
  }, [browserWorkbenchOpen, exitPanelFullscreen, selectedTaskId]);

  // Workbench-specific Esc routing. Closes panelFullscreen +
  // browserSheet, and steps out of the way when the BrowserPanel is in
  // interactive takeover (the remote page should own Esc then). Shell
  // modals (search / feedback / settings) are handled by AppShell's
  // own Esc handler, so this one ignores them.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';
      const remoteOwnsEsc =
        browserInteractive &&
        !!selectedTaskId &&
        !inField &&
        !e.metaKey &&
        !e.shiftKey;
      if (remoteOwnsEsc) return;
      if (browserSheetOpen) {
        setBrowserSheetOpen(false);
        closeBrowserWorkbench();
        return;
      }
      if (panelFullscreen) {
        void exitPanelFullscreen();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    browserSheetOpen,
    panelFullscreen,
    browserInteractive,
    closeBrowserWorkbench,
    exitPanelFullscreen,
    selectedTaskId,
  ]);

  // '/' to focus the composer.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === '/' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;
  const [browserReExecuting, setBrowserReExecuting] = React.useState(false);
  const handleBrowserReExecute = React.useCallback(async (): Promise<void> => {
    if (!selectedTask || browserReExecuting) return;
    const intent = selectedTask.intent;
    setBrowserReExecuting(true);
    setSidePanelOverride('close');
    setBrowserSheetOpen(false);
    enterNewTaskMode();
    try {
      const res = await createTask(intent);
      if (!mountedRef.current) return;
      if ('error' in res) {
        toast.show(taskActionError('重新执行失败', res.error), 'error');
      }
    } finally {
      if (mountedRef.current) {
        setBrowserReExecuting(false);
      }
    }
  }, [browserReExecuting, createTask, enterNewTaskMode, selectedTask, toast]);

  // Follow-up context — active on a terminal task that isn't currently
  // in awaiting-user reply mode.
  const isReplyMode = selectedNeedsUser;
  const followUpTarget = followUpTargetForTask({
    selectedTask,
    selectedTaskId,
    selectedNeedsUser: isReplyMode,
  });

  // Side-panel state machine. Derives a single `sidePanelMode` from
  // the task + the user's intent override. The renderer below maps
  // mode → "should the panel mount?".
  const isLiveBrowserTask = isLiveBrowserTaskForWorkbench(selectedTask);
  const sidePanelMode: SidePanelMode = computeSidePanelMode({
    hasSelectedTask: !!selectedTaskId,
    isComposerNew: composerMode === 'new',
    selectedNeedsBrowser,
    isLiveBrowserTask,
    override: sidePanelOverride,
  });
  const taskBrowserPanelOpen = sidePanelMode !== 'closed';
  const selectedHasBrowserRecord = hasBrowserRecordForWorkbench(selectedTask);
  const standaloneBrowserWorkspace =
    browserWorkbenchOpen && !taskBrowserPanelOpen && !selectedHasBrowserRecord;
  const showBrowserPanel = taskBrowserPanelOpen || browserWorkbenchOpen;
  const useAdaptiveSidebar = showBrowserPanel && isCompactInlineViewport;
  React.useEffect(() => {
    setBrowserAdaptiveSidebarCollapsed(useAdaptiveSidebar);
  }, [setBrowserAdaptiveSidebarCollapsed, useAdaptiveSidebar]);
  React.useEffect(
    () => () => setBrowserAdaptiveSidebarCollapsed(false),
    [setBrowserAdaptiveSidebarCollapsed],
  );
  const browserPanelTask = standaloneBrowserWorkspace ? null : selectedTask;
  const browserPanelTaskId = standaloneBrowserWorkspace ? null : selectedTaskId;
  const toolbarSidePanelMode = sidePanelModeForToolbar({
    sidePanelMode,
    isMobile,
    browserSheetOpen,
  });
  React.useEffect(() => {
    const nextSheetState = mobileBrowserSheetAutoOpenState({
      taskId: selectedTaskId,
      mode: sidePanelMode,
      isMobile,
      autoOpenedKey: mobileBrowserSheetAutoOpenedKeyRef.current,
    });
    mobileBrowserSheetAutoOpenedKeyRef.current = nextSheetState.autoOpenedKey;
    if (nextSheetState.shouldOpen) {
      setBrowserSheetOpen(true);
    }
  }, [isMobile, selectedTaskId, sidePanelMode]);

  React.useEffect(() => {
    if (sidePanelMode !== 'closed') openBrowserWorkbench();
  }, [openBrowserWorkbench, sidePanelMode]);

  const previousBrowserWorkbenchOpenRef = React.useRef(browserWorkbenchOpen);
  React.useEffect(() => {
    const wasOpen = previousBrowserWorkbenchOpenRef.current;
    previousBrowserWorkbenchOpenRef.current = browserWorkbenchOpen;
    if (!wasOpen || browserWorkbenchOpen) return;
    setSidePanelOverride('close');
    setBrowserSheetOpen(false);
    void exitPanelFullscreen();
  }, [browserWorkbenchOpen, exitPanelFullscreen]);

  React.useEffect(() => {
    if (browserWorkbenchOpen && isMobile) setBrowserSheetOpen(true);
  }, [browserWorkbenchOpen, isMobile]);

  const previousPanelStateRef = React.useRef<{
    taskId: string | null;
    mode: SidePanelMode;
  }>({ taskId: selectedTaskId, mode: sidePanelMode });
  React.useEffect(() => {
    const nextOverride = preserveBrowserRecordAfterLive({
      previousTaskId: previousPanelStateRef.current.taskId,
      currentTaskId: selectedTaskId,
      previousMode: previousPanelStateRef.current.mode,
      currentOverride: sidePanelOverride,
      isTerminalBrowserTask: Boolean(
        selectedTask &&
          hasBrowserRecordForWorkbench(selectedTask) &&
          isWorkbenchTerminalTask(selectedTask),
      ),
    });
    previousPanelStateRef.current = { taskId: selectedTaskId, mode: sidePanelMode };
    if (nextOverride !== sidePanelOverride) {
      setSidePanelOverride(nextOverride);
    }
  }, [selectedTask, selectedTaskId, sidePanelMode, sidePanelOverride]);
  const closeBrowserWorkspace = React.useCallback(() => {
    closeBrowserWorkbench();
    setSidePanelOverride('close');
    setBrowserSheetOpen(false);
    void exitPanelFullscreen();
  }, [closeBrowserWorkbench, exitPanelFullscreen]);
  const focusBrowserFollowUp = React.useCallback((): void => {
    const focusComposer = (): void => {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    if (isMobile) {
      closeBrowserWorkspace();
      focusComposer();
    } else if (panelFullscreen) {
      void exitPanelFullscreen().then(focusComposer);
    } else {
      focusComposer();
    }
    toast.show('输入下一步指令，AI 会从当前页面继续');
  }, [closeBrowserWorkspace, exitPanelFullscreen, isMobile, panelFullscreen, toast]);

  const startWorkspaceBrowserTask = React.useCallback(
    async (intent: string): Promise<boolean> => {
      const result = await createTask(intent);
      if ('error' in result) {
        toast.show(taskActionError('启动浏览器失败', result.error), 'error');
        return false;
      }
      openBrowserWorkbench();
      setSidePanelOverride('open');
      if (isMobile) setBrowserSheetOpen(true);
      return true;
    },
    [createTask, isMobile, openBrowserWorkbench, toast],
  );

  // Toolbar and global shell entry share one source of truth: closing
  // either control closes the visible surface; opening either control
  // preserves the selected task when it has a browser record.
  const onToggleSidePanel = React.useCallback(() => {
    if (showBrowserPanel) {
      closeBrowserWorkspace();
      return;
    }
    openBrowserWorkbench();
    if (selectedTaskId) setSidePanelOverride('open');
  }, [closeBrowserWorkspace, openBrowserWorkbench, selectedTaskId, showBrowserPanel]);

  return (
    <div
      className="relative flex h-full min-h-0 w-full overflow-hidden"
      ref={contentRowRef}
    >
      {!panelFullscreen && (
        <MainPanel
          task={selectedTask}
          greetingName={preferredDisplayName(me) || undefined}
          inputRef={inputRef}
          replyMode={isReplyMode}
          replyKind={selectedAwaitingKind}
          followUpTarget={followUpTarget}
          userPlan={me?.plan}
          userSelectedRoles={me?.selectedRoles ?? null}
          quotaExhausted={quotaExhausted}
          attachmentsAllowed={planForRetention !== 'free'}
          attachmentByteCap={
            planForRetention === 'pro'
              ? 10 * 1024 * 1024
              : planForRetention === 'basic'
                ? 5 * 1024 * 1024
                : 0
          }
          onSubmit={async (
            intent,
            fileIds,
            mode,
            expertMode,
            skillSelection?: UiSkillSelection,
          ) => {
            hdDebug('onSubmit', {
              isReplyMode,
              followUpTaskId: followUpTarget?.taskId ?? null,
              selectedTaskId,
              mode,
              expertMode,
              skillId: skillSelection?.skillId ?? null,
            });
            if (isReplyMode && selectedTaskId) {
              const res = await replyToTask(selectedTaskId, intent, fileIds);
              if ('error' in res) {
                toast.show(taskActionError('回复失败', res.error), 'error');
                return keepComposerOnSubmitFailure;
              } else if (!res.ok) {
                setConfirmRebuildTask({
                  taskId: selectedTaskId,
                  intent: selectedTask?.intent ?? '',
                  pendingMessage: intent,
                });
                return keepComposerOnSubmitFailure;
              }
              return clearComposerOnSubmitSuccess;
            }
            if (followUpTarget) {
              const res = await createTask(
                intent,
                fileIds,
                followUpTarget.taskId,
                undefined,
                undefined,
                undefined,
                undefined,
                skillSelection,
              );
              if ('error' in res) {
                toast.show(taskActionError('追问失败', res.error), 'error');
                return keepComposerOnSubmitFailure;
              }
              toast.show(
                selectedHasBrowserRecord
                  ? 'AI 已接手当前页面继续执行'
                  : '已基于上一个任务追问',
              );
              return clearComposerOnSubmitSuccess;
            }
            const decision = await regionGatedSubmit.requestSubmit({
              intent,
              fileIds,
              mode,
              expertMode,
              skillSelection,
            });
            return decision.kind === 'submitted'
              ? decision.result
              : keepComposerOnSubmitFailure;
          }}
          onOpenSidebar={() => setOpenMobile(true)}
          sidePanelMode={toolbarSidePanelMode}
          browserAttentionNeeded={selectedNeedsBrowser}
          browserPanelOpen={showBrowserPanel && isDesktop}
          onToggleSidePanel={() => {
            // BOSS bug fix — on mobile (bottom-sheet browser lane)
            // the bottom sheet IS the only browser surface, so the
            // toolbar button must toggle THAT directly. The old
            // guard only opened the sheet when sidePanelMode was
            // 'closed' — but for a live browser task the mode is
            // 'browser-live' even on mobile, so the button looked dead.
            const mobileWidth =
              typeof window !== 'undefined' && isWorkbenchMobileWidth(window.innerWidth);
            if (mobileWidth) {
              if (browserSheetOpen) {
                closeBrowserWorkspace();
              } else {
                openBrowserWorkbench();
                setSidePanelOverride('open');
                setBrowserSheetOpen(true);
              }
              return;
            }
            // Desktop: flip the override (closed → open → close).
            onToggleSidePanel();
          }}
        />
      )}

      {!panelFullscreen && showBrowserPanel && isDesktop && !isCompactInlineViewport && (
        <ResizeHandle onDrag={onPanelResizeDrag} onDragEnd={onPanelResizeEnd} />
      )}

      {/* Tablet and desktop render the browser as a true flex sibling
          of the task workspace. Compact phone widths use the sheet
          branch below. Only one BrowserPanel mount exists at a time. */}
      {(panelFullscreen || (showBrowserPanel && isDesktop)) && (
        <div
          className={
            panelFullscreen
              ? 'flex h-full w-full flex-col'
              : 'flex h-full min-w-0 flex-col lg:shrink-0'
          }
          style={
            panelFullscreen
              ? undefined
              : !isCompactInlineViewport && panelPx != null
                ? {
                    flex: `0 1 ${panelPx}px`,
                    minWidth: inlineColumnMinimums.browser,
                    maxWidth: `calc(100% - ${inlineColumnMinimums.main}px)`,
                  }
                : {
                    flex: '2 1 0',
                    minWidth: inlineColumnMinimums.browser,
                    maxWidth: `calc(100% - ${inlineColumnMinimums.main}px)`,
                  }
          }
        >
          <BrowserPanel
            frame={
              taskFrameForWorkbench(browserPanelTaskId, screencastByTask)
            }
            taskStatus={browserPanelTask?.status ?? null}
            awaitingUser={
              browserPanelTask
                ? Boolean(
                    captchaWaitByTask[browserPanelTask.taskId] ||
                      awaitingUserByTask[browserPanelTask.taskId],
                  )
                : false
            }
            awaitingKind={
              browserPanelTask && captchaWaitByTask[browserPanelTask.taskId]
                ? 'captcha'
                : browserPanelTask
                  ? selectedAwaitingKind
                  : undefined
            }
            activeTaskId={browserPanelTaskId}
            workspaceIdle={standaloneBrowserWorkspace}
            onStartWorkspaceTask={startWorkspaceBrowserTask}
            poolUserId={me?.multiUser ? me.userId : null}
            fullscreen={panelFullscreen}
            onToggleFullscreen={togglePanelFullscreen}
            onToggleCollapse={closeBrowserWorkspace}
            onClose={closeBrowserWorkspace}
            onReExecute={browserPanelTask ? () => void handleBrowserReExecute() : undefined}
            reExecuting={browserReExecuting}
            onRequestAgentHelp={focusBrowserFollowUp}
          />
        </div>
      )}

      {/* Bottom workspace: compact phone widths only. BrowserPanel
          internally returns null when `open=false`; the outer gate
          also prevents a parallel screencast mount. */}
      {!panelFullscreen && isMobile && (
        <div>
        {browserSheetOpen && (
          <button
            type="button"
            aria-label="收起浏览器"
            title="收起浏览器"
            className="fixed inset-0 z-[70] cursor-default bg-black/20 backdrop-blur-[1px]"
            onClick={closeBrowserWorkspace}
          />
        )}
        <BrowserPanel
          layout="sheet"
          open={browserSheetOpen}
          onClose={closeBrowserWorkspace}
          frame={
            taskFrameForWorkbench(browserPanelTaskId, screencastByTask)
          }
          taskStatus={browserPanelTask?.status ?? null}
          awaitingUser={
            browserPanelTask
              ? Boolean(
                  captchaWaitByTask[browserPanelTask.taskId] ||
                    awaitingUserByTask[browserPanelTask.taskId],
                )
              : false
          }
          awaitingKind={
            browserPanelTask && captchaWaitByTask[browserPanelTask.taskId]
              ? 'captcha'
              : browserPanelTask
                ? selectedAwaitingKind
                : undefined
          }
          activeTaskId={browserPanelTaskId}
          workspaceIdle={standaloneBrowserWorkspace}
          onStartWorkspaceTask={startWorkspaceBrowserTask}
          poolUserId={me?.multiUser ? me.userId : null}
          onReExecute={browserPanelTask ? () => void handleBrowserReExecute() : undefined}
          reExecuting={browserReExecuting}
          onRequestAgentHelp={focusBrowserFollowUp}
        />
        </div>
      )}

      <ModelDataRegionDialog
        open={regionGatedSubmit.dialogOpen}
        assigning={regionGatedSubmit.assigning}
        error={regionGatedSubmit.error}
        onClose={regionGatedSubmit.closeDialog}
        onConfirm={async (region) => {
          await regionGatedSubmit.confirmRegion(region);
        }}
      />

      <ConfirmDialog
        open={confirmRebuildTask !== null}
        title="执行进程已中断"
        description="该任务已不在等待回复（很可能是后端重启过）。是否基于当前上下文重新执行？将使用原任务描述、此前已收集的补充和你刚才输入的内容。"
        confirmLabel="重新执行"
        onClose={() => setConfirmRebuildTask(null)}
        onConfirm={async () => {
          const ctx = confirmRebuildTask;
          setConfirmRebuildTask(null);
          if (!ctx) return;
          const replies = userRepliesByTask[ctx.taskId] ?? [];
          const replyBlock = replies
            .map((r) => r.text)
            .filter(Boolean)
            .join('\n');
          const combined = [
            ctx.intent,
            replyBlock.length > 0 ? `\n[此前补充]\n${replyBlock}` : '',
            `\n[当前补充]\n${ctx.pendingMessage}`,
          ]
            .join('')
            .trim();
          const res = await createTask(combined);
          if ('error' in res) toast.show(taskActionError('重建任务失败', res.error), 'error');
          else toast.show('已基于当前上下文重新创建任务');
        }}
      />
    </div>
  );
}

/**
 * Single source of truth for the BrowserPanel's narrowest sane width.
 * Used by the localStorage clamp on seed, the drag handle floor, AND
 * the collapsed-flex fallback when no explicit panelPx is set.
 *
 * The task workspace keeps 560px on wide layouts so the composer and
 * result stream remain usable. The browser floor is 360px: 300px made
 * saved desktop screenshots and browser controls technically fit but
 * not meaningfully readable. Compact inline layouts ignore a saved
 * width and collapse the app sidebar, so the two same-plane surfaces
 * can still share the viewport without overlaying one another.
 */
const PANEL_MIN_PX = 360;
const MAIN_PANEL_MIN_PX = 560;
const PANEL_CHROME_ESTIMATE_PX = 140;

function preferredDisplayName(
  me: { displayName: string | null; email: string | null; phone?: string | null } | null,
): string {
  if (!me) return '';
  const raw = me.displayName?.trim();
  const looksMasked = raw ? /\d{3}\**\d{4}/.test(raw) : false;
  if (raw && !looksMasked) return raw;
  if (me.phone) return `用户_${me.phone.slice(-4)}`;
  if (me.email) {
    const at = me.email.indexOf('@');
    return at > 0 ? me.email.slice(0, at) : me.email;
  }
  return '用户';
}

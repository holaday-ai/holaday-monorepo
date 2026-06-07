import * as React from 'react';
import { type PlanId } from '@holaday/shared-types';
import { useAppShellContext } from '@/components/AppShell';
import { BrowserPanel } from '@/components/BrowserPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MainPanel } from '@/components/MainPanel';
import { ResizeHandle } from '@/components/ResizeHandle';
import {
  clearComposerOnSubmitSuccess,
  keepComposerOnSubmitFailure,
} from '@/components/composer-submit';
import { useToast } from '@/components/ui/toast';
import { useSidebar } from '@/components/ui/sidebar';
import { hdDebug } from '@/lib/hd-debug';
import { taskActionError } from '@/lib/error-copy';
import {
  clampInlineBrowserPanelWidth,
  estimateInlineBrowserPanelWidth,
  pickWorkbenchBrowserViewportProfile,
} from '@/lib/browser-viewport-profile';
import {
  isWorkbenchDesktopWidth,
  isWorkbenchMobileWidth,
  WORKBENCH_DESKTOP_BREAKPOINT_PX,
  WORKBENCH_MOBILE_BREAKPOINT_PX,
} from '@/lib/workbench-breakpoints';
import {
  followUpTargetForTask,
  isLiveBrowserTaskForWorkbench,
  isWorkbenchTerminalTask,
  mobileBrowserSheetAutoOpenState,
  preserveBrowserRecordAfterLive,
} from '@/lib/workbench-state';
import { useTaskStore } from '@/stores/task-store';
import { isQuotaExhausted, useQuotaStatus } from '@/lib/use-quota-status';
import {
  computeSidePanelMode,
  sidePanelModeForToolbar,
  type SidePanelMode,
  type SidePanelOverride,
} from '@/types/side-panel';
import type { UiTask } from '@/types/task';

type UiTaskAwaitingKind = NonNullable<UiTask['awaitingKind']> | undefined;

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
  const { me } = useAppShellContext();
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
   * alive. Now the render tree has one lane per viewport:
   * desktop inline, tablet overlay, mobile sheet.
   *
   * Track the breakpoint in state (not just a ref) so the render
   * tree updates on resize. matchMedia keeps the listener cheap.
   */
  /**
   * Codex Pack B2 + Round 2 P1-8 — three-tier responsive breakpoint:
   *   - desktop  ≥ 1360px → inline split panel (resize handle, flex)
   *   - tablet   1100-1359 → overlay panel (fixed right, backdrop)
   *   - compact  < 1100px → bottom sheet
   *
   * Round 2 P1-8 bumped the inline threshold from 1200 → 1360. At
   * 1200, the panel's 300-px floor + main's 480-px min-width left
   * ~420 px for the panel header / toolbar / screencast canvas —
   * tight enough that buttons started crowding when an expert
   * report card sat alongside. 1360 gives ~580 px for the panel at
   * its 540-px default. Narrow tablets and 1024-wide desktop windows
   * use the bottom sheet so the task body is not squeezed sideways.
   */
  const [isDesktop, setIsDesktop] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return isWorkbenchDesktopWidth(window.innerWidth);
  });
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isWorkbenchMobileWidth(window.innerWidth);
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const desktopMq = window.matchMedia(
      `(min-width: ${WORKBENCH_DESKTOP_BREAKPOINT_PX}px)`,
    );
    const mobileMq = window.matchMedia(
      `(min-width: ${WORKBENCH_MOBILE_BREAKPOINT_PX}px)`,
    );
    const onDesktop = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    const onMobile = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    desktopMq.addEventListener('change', onDesktop);
    mobileMq.addEventListener('change', onMobile);
    return () => {
      desktopMq.removeEventListener('change', onDesktop);
      mobileMq.removeEventListener('change', onMobile);
    };
  }, []);
  // tablet sits between desktop and mobile — the new overlay zone.
  const isTablet = !isDesktop && !isMobile;
  // Pre-B2 callers that branched on `isLg` (inline-vs-sheet) now read
  // this alias so the existing render logic + cross-bridge effects
  // keep working. Inline = desktop only; everything below desktop
  // routes through a non-inline surface (overlay OR sheet).
  const isLg = isDesktop;
  /**
   * When the user crosses the inline boundary WHILE the inline panel
   * was open, bridge to the appropriate non-inline surface so they
   * don't suddenly see a blank main area:
   *   - leaving desktop → tablet: overlay opens automatically (no
   *     extra state — the conditional render below picks it up).
   *   - leaving tablet → mobile: open the sheet so the panel content
   *     stays visible (sheet is a stateful drawer, not a derived
   *     render like overlay).
   *   - growing back to desktop: close sheet if it was open.
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
  // localStorage, clamped to PANEL_MIN_PX on read so a saved value
  // below that floor doesn't render a sliver.
  const contentRowRef = React.useRef<HTMLDivElement | null>(null);
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
    if (!row) return Math.max(PANEL_MIN_PX, Math.round(window.innerWidth * 0.55));
    const rect = row.getBoundingClientRect();
    return estimateInlineBrowserPanelWidth({
      rowWidth: rect.width,
      explicitPanelWidth: null,
      panelMinWidth: PANEL_MIN_PX,
      mainMinWidth: MAIN_PANEL_MIN_PX,
    }) ?? Math.max(PANEL_MIN_PX, Math.round(window.innerWidth * 0.55));
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
    if (!isDesktop || panelPx == null || typeof ResizeObserver === 'undefined') return;
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
  }, [isDesktop, panelPx]);
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
  const loading = useTaskStore((s) => s.loading);
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
      explicitPanelWidth: panelPx,
      isTablet,
      fullscreen: panelFullscreen,
      panelMinWidth: PANEL_MIN_PX,
      mainMinWidth: MAIN_PANEL_MIN_PX,
      panelChromeHeight: PANEL_CHROME_ESTIMATE_PX,
    });
  }, [isTablet, panelFullscreen, panelPx]);
  React.useEffect(() => {
    setDefaultViewportProfile(pickCurrentViewportProfile());
  }, [pickCurrentViewportProfile, setDefaultViewportProfile]);
  const createTask: typeof createTaskRaw = React.useCallback(
    (intent, fileIds, replyToTaskId, mode, expertMode, viewportProfile) => {
      // Pack C1 added `expertMode` at position 5; viewportProfile
      // moved to position 6. The wrapper still auto-picks viewport
      // from the current panel layout when callers don't pass one.
      const picked = viewportProfile ?? pickCurrentViewportProfile();
      return createTaskRaw(intent, fileIds, replyToTaskId, mode, expertMode, picked);
    },
    [createTaskRaw, pickCurrentViewportProfile],
  );
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
  const selectedNeedsBrowser = Boolean(
    selectedTaskId &&
      (captchaWaitByTask[selectedTaskId] ||
        (selectedNeedsUser &&
          selectedAwaitingKind != null &&
          selectedAwaitingKind !== 'clarification')),
  );

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
    if (selectedTaskId) return;
    setPanelFullscreen(false);
    setBrowserSheetOpen(false);
  }, [selectedTaskId]);

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
        return;
      }
      if (panelFullscreen) {
        setPanelFullscreen(false);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [browserSheetOpen, panelFullscreen, browserInteractive, selectedTaskId]);

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
  const showBrowserPanel = sidePanelMode !== 'closed';
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
        selectedTask?.executionMode === 'browser' &&
          isWorkbenchTerminalTask(selectedTask),
      ),
    });
    previousPanelStateRef.current = { taskId: selectedTaskId, mode: sidePanelMode };
    if (nextOverride !== sidePanelOverride) {
      setSidePanelOverride(nextOverride);
    }
  }, [selectedTask, selectedTaskId, sidePanelMode, sidePanelOverride]);
  // Toolbar click flips the panel: closed → open, anything-else → close.
  const onToggleSidePanel = React.useCallback(() => {
    setSidePanelOverride(sidePanelMode === 'closed' ? 'open' : 'close');
  }, [sidePanelMode]);

  return (
    <div
      className="relative flex h-full min-h-0 w-full overflow-hidden"
      ref={contentRowRef}
    >
      {!panelFullscreen && (
        <MainPanel
          task={selectedTask}
          busy={loading}
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
          onSubmit={async (intent, fileIds, mode, expertMode) => {
            hdDebug('onSubmit', {
              isReplyMode,
              followUpTaskId: followUpTarget?.taskId ?? null,
              selectedTaskId,
              mode,
              expertMode,
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
              const res = await createTask(intent, fileIds, followUpTarget.taskId);
              if ('error' in res) {
                toast.show(taskActionError('追问失败', res.error), 'error');
                return keepComposerOnSubmitFailure;
              }
              toast.show('已基于上一个任务追问');
              return clearComposerOnSubmitSuccess;
            }
            const res = await createTask(intent, fileIds, undefined, mode, expertMode);
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
          }}
          onOpenSidebar={() => setOpenMobile(true)}
          sidePanelMode={toolbarSidePanelMode}
          browserAttentionNeeded={selectedNeedsBrowser}
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
              setBrowserSheetOpen((open) => !open);
              return;
            }
            // Desktop: flip the override (closed → open → close).
            onToggleSidePanel();
          }}
        />
      )}

      {!panelFullscreen && showBrowserPanel && isDesktop && (
        <ResizeHandle onDrag={onPanelResizeDrag} onDragEnd={onPanelResizeEnd} />
      )}

      {/* Codex Pack B2 — three-tier panel rendering:
          inline (desktop ≥1360) renders here as a flex sibling of the
          main column; tablet (1100-1359) renders below in the overlay
          branch (fixed right, backdrop); compact widths (<1100) go
          through the sheet branch. Only ONE BrowserPanel mount per
          moment so CdpScreencastViewport doesn't fight itself. */}
      {(panelFullscreen || (showBrowserPanel && isDesktop)) && (
        <div
          className={
            panelFullscreen
              ? 'flex h-full w-full flex-col'
              : 'h-full flex flex-col lg:shrink-0'
          }
          style={
            panelFullscreen
              ? undefined
              : panelPx != null
                ? { flex: `0 0 ${panelPx}px` }
                : { flex: '3 1 0', minWidth: PANEL_MIN_PX }
          }
        >
          <BrowserPanel
            frame={
              selectedTask
                ? (screencastByTask[selectedTask.taskId] ?? null)
                : null
            }
            taskStatus={selectedTask?.status ?? null}
            awaitingUser={
              selectedTask
                ? Boolean(
                    captchaWaitByTask[selectedTask.taskId] ||
                      awaitingUserByTask[selectedTask.taskId],
                  )
                : false
            }
            awaitingKind={
              selectedTask && captchaWaitByTask[selectedTask.taskId]
                ? 'captcha'
                : selectedAwaitingKind
            }
            activeTaskId={selectedTaskId}
            poolUserId={me?.multiUser ? me.userId : null}
            fullscreen={panelFullscreen}
            onToggleFullscreen={() => setPanelFullscreen((v) => !v)}
            onToggleCollapse={() => setSidePanelOverride('close')}
            onClose={() => setSidePanelOverride('close')}
            onReExecute={selectedTask ? () => void handleBrowserReExecute() : undefined}
            reExecuting={browserReExecuting}
          />
        </div>
      )}

      {/* Codex Pack B2 — overlay panel (tablet 1100-1359). Sits over
          the main column as a fixed right-edge drawer with a backdrop
          tap-to-close. No resize handle (the width is fixed at
          560 px to fit comfortably while leaving room for the main
          column underneath). */}
      {!panelFullscreen && showBrowserPanel && isTablet && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            aria-hidden
            onClick={() => setSidePanelOverride('close')}
          />
          <div className="fixed right-0 top-0 bottom-0 z-50 flex w-[480px] max-w-[84vw] flex-col bg-background shadow-2xl">
            <BrowserPanel
              frame={
                selectedTask
                  ? (screencastByTask[selectedTask.taskId] ?? null)
                  : null
              }
              taskStatus={selectedTask?.status ?? null}
              awaitingUser={
                selectedTask
                  ? Boolean(
                      captchaWaitByTask[selectedTask.taskId] ||
                        awaitingUserByTask[selectedTask.taskId],
                    )
                  : false
              }
              awaitingKind={
                selectedTask && captchaWaitByTask[selectedTask.taskId]
                  ? 'captcha'
                  : selectedAwaitingKind
              }
              activeTaskId={selectedTaskId}
              poolUserId={me?.multiUser ? me.userId : null}
              fullscreen={false}
              onToggleFullscreen={() => setPanelFullscreen((v) => !v)}
              onToggleCollapse={() => setSidePanelOverride('close')}
              onClose={() => setSidePanelOverride('close')}
              onReExecute={selectedTask ? () => void handleBrowserReExecute() : undefined}
              reExecuting={browserReExecuting}
            />
          </div>
        </>
      )}

      {/* Bottom-sheet panel: renders on compact widths (<1100px).
          Tablet (1100-1359) routes through the overlay branch above, so
          the sheet doesn't double-mount alongside an overlay. The
          BrowserPanel internally returns null when `open=false`, but
          we ALSO gate the wrapping div on isMobile so the React tree
          never holds two parallel BrowserPanel mounts. */}
      {!panelFullscreen && isMobile && (
        <div>
        <BrowserPanel
          layout="sheet"
          open={browserSheetOpen}
          onClose={() => setBrowserSheetOpen(false)}
          frame={
            selectedTask
              ? (screencastByTask[selectedTask.taskId] ?? null)
              : null
          }
          taskStatus={selectedTask?.status ?? null}
          awaitingUser={
            selectedTask
              ? Boolean(
                  captchaWaitByTask[selectedTask.taskId] ||
                    awaitingUserByTask[selectedTask.taskId],
                )
              : false
          }
          awaitingKind={
            selectedTask && captchaWaitByTask[selectedTask.taskId]
              ? 'captcha'
              : selectedAwaitingKind
          }
          activeTaskId={selectedTaskId}
          poolUserId={me?.multiUser ? me.userId : null}
          onReExecute={selectedTask ? () => void handleBrowserReExecute() : undefined}
          reExecuting={browserReExecuting}
        />
        </div>
      )}

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
 * BUG-11 fix (2026-05-19): dropped from 560 → 300. At 560 + main's
 * lg:min-w-[420] = 980 the wrapper exceeded a typical 884-px content
 * column (1144 viewport − 260 sidebar) and the parent's overflow:hidden
 * clipped the right edge of search-result pages by ~108 px. CSS scale
 * on the screencast canvas already keeps the inner image readable at
 * narrower widths, so 300 is the new floor.
 */
const PANEL_MIN_PX = 300;
const MAIN_PANEL_MIN_PX = 420;
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

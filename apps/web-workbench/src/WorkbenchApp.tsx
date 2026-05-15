import * as React from 'react';
import {
  type BrowserViewportProfile,
  type PlanId,
} from '@holaday/shared-types';
import { useAppShellContext } from '@/components/AppShell';
import { BrowserPanel } from '@/components/BrowserPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MainPanel } from '@/components/MainPanel';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useToast } from '@/components/ui/toast';
import { useSidebar } from '@/components/ui/sidebar';
import { hdDebug } from '@/lib/hd-debug';
import { useTaskStore } from '@/stores/task-store';
import { isQuotaExhausted, useQuotaStatus } from '@/lib/use-quota-status';
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

  // Inner-workbench state.
  const [panelFullscreen, setPanelFullscreen] = React.useState(false);
  const [browserCollapsed, setBrowserCollapsed] = React.useState(false);
  const [browserSheetOpen, setBrowserSheetOpen] = React.useState(false);
  // True when the user explicitly opened the BrowserPanel via the
  // result-card icon on a terminal task that wouldn't otherwise
  // auto-render the panel. Reset on every task switch so a stale
  // open from task A doesn't follow into task B.
  const [userOpenedBrowserPanel, setUserOpenedBrowserPanel] =
    React.useState(false);
  const [followUpDismissedTaskId, setFollowUpDismissedTaskId] =
    React.useState<string | null>(null);
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
    if (!row) return Math.max(720, Math.round(window.innerWidth * 0.55));
    const rect = row.getBoundingClientRect();
    return Math.max(720, Math.min(rect.width - 420, Math.round(rect.width * 0.6)));
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
      const min = PANEL_MIN_PX;
      const max = Math.max(min, rowWidth - 360);
      setPanelPx(Math.min(max, Math.max(min, raw)));
    },
    [computeInitialPanelPx],
  );
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
  const createTaskRaw = useTaskStore((s) => s.createTask);
  const createTask: typeof createTaskRaw = React.useCallback(
    (intent, fileIds, replyToTaskId, mode, viewportProfile) => {
      const picked =
        viewportProfile ??
        pickViewportProfile({
          panelPx,
          isMobile:
            typeof window !== 'undefined' && window.innerWidth < 1024,
        });
      return createTaskRaw(intent, fileIds, replyToTaskId, mode, picked);
    },
    [createTaskRaw, panelPx],
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

  // Auto-expand BrowserPanel when the agent needs the user IN the
  // viewport (login / captcha / browser_action). Mobile pops the
  // bottom sheet so the takeover is reachable.
  React.useEffect(() => {
    if (!selectedNeedsBrowser) return;
    setBrowserCollapsed(false);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setBrowserSheetOpen(true);
    }
  }, [selectedNeedsBrowser]);

  // Reset per-task panel state on task switch: drop the "user opened
  // it" flag and the manual-collapse choice so each task starts from
  // its default (live tasks auto-show; terminal tasks stay hidden).
  React.useEffect(() => {
    setUserOpenedBrowserPanel(false);
    setBrowserCollapsed(false);
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

  // Follow-up chip — active on a terminal task that the user hasn't
  // dismissed and isn't currently in awaiting-user reply mode.
  const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
  const isReplyMode = selectedNeedsUser;
  const followUpTarget =
    selectedTask &&
    selectedTaskId &&
    TERMINAL_STATUSES.has(selectedTask.status) &&
    !isReplyMode &&
    followUpDismissedTaskId !== selectedTaskId
      ? {
          taskId: selectedTaskId,
          title: (selectedTask.title || selectedTask.intent || '').slice(0, 40),
        }
      : null;

  // BrowserPanel auto-render rules (Codex P1 fix — was always shown
  // for any browser task, including completed ones with no live frame
  // and no captured evidence, which displayed about:blank). New
  // policy: render only when there's actually something to look at —
  //   * live browser task (executing / queued / planning)
  //   * agent parked awaiting user input (login / captcha / etc.)
  //   * user explicitly clicked the 查看浏览器 icon on a terminal
  //     task's result card
  // Terminal browser tasks with neither a live frame nor an evidence
  // screenshot no longer slap a blank rail onto the layout.
  const isLiveBrowserTask = Boolean(
    selectedTask &&
      selectedTask.executionMode === 'browser' &&
      !TERMINAL_STATUSES.has(selectedTask.status),
  );
  const showBrowserPanel =
    !!selectedTaskId &&
    composerMode !== 'new' &&
    (selectedNeedsBrowser || isLiveBrowserTask || userOpenedBrowserPanel);

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
          followUpTarget={followUpTarget}
          onCancelFollowUp={() => {
            if (selectedTaskId) setFollowUpDismissedTaskId(selectedTaskId);
            enterNewTaskMode();
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
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
          onSubmit={async (intent, fileIds, mode) => {
            hdDebug('onSubmit', {
              isReplyMode,
              followUpTaskId: followUpTarget?.taskId ?? null,
              selectedTaskId,
              mode,
            });
            if (isReplyMode && selectedTaskId) {
              const res = await replyToTask(selectedTaskId, intent, fileIds);
              if ('error' in res) {
                toast.show(`回复失败：${res.error}`, 'error');
              } else if (!res.ok) {
                setConfirmRebuildTask({
                  taskId: selectedTaskId,
                  intent: selectedTask?.intent ?? '',
                  pendingMessage: intent,
                });
              }
              return;
            }
            if (followUpTarget) {
              const res = await createTask(intent, fileIds, followUpTarget.taskId);
              if ('error' in res) toast.show(`追问失败：${res.error}`, 'error');
              else toast.show('已基于上一个任务追问');
              return;
            }
            const res = await createTask(intent, fileIds, undefined, mode);
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
                toast.show(`发送失败：${res.error}`, 'error');
              }
            }
          }}
          onOpenSidebar={() => setOpenMobile(true)}
          onOpenBrowserPanel={() => {
            setUserOpenedBrowserPanel(true);
            if (
              typeof window !== 'undefined' &&
              window.innerWidth < 1024
            ) {
              setBrowserSheetOpen(true);
            }
          }}
        />
      )}

      {!panelFullscreen && !browserCollapsed && showBrowserPanel && (
        <ResizeHandle onDrag={onPanelResizeDrag} onDragEnd={onPanelResizeEnd} />
      )}

      {(panelFullscreen || showBrowserPanel) && (
        <div
          className={
            panelFullscreen
              ? 'flex h-full w-full flex-col'
              : 'hidden h-full lg:flex lg:flex-col lg:shrink-0'
          }
          style={
            panelFullscreen
              ? undefined
              : browserCollapsed
                ? { flex: '0 0 40px', minWidth: 40, width: 40 }
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
            collapsed={browserCollapsed}
            onToggleCollapse={() => {
              // Terminal task: close button fully unmounts the panel
              // (no leftover 40px rail). Live task keeps the rail so
              // the user can re-expand without losing the session.
              const taskNow = selectedTaskId
                ? tasks.find((t) => t.taskId === selectedTaskId)
                : null;
              const isTerminal =
                taskNow != null && TERMINAL_STATUSES.has(taskNow.status);
              if (isTerminal) {
                setUserOpenedBrowserPanel(false);
                setBrowserCollapsed(false);
                return;
              }
              setBrowserCollapsed((v) => !v);
            }}
            onReExecute={
              // Empty-state fallback action: re-run the same intent
              // as a fresh task. Drops the panel + the current
              // selection so the user lands on the new task as it
              // streams.
              selectedTask
                ? () => {
                    const intent = selectedTask.intent;
                    setUserOpenedBrowserPanel(false);
                    setBrowserCollapsed(false);
                    enterNewTaskMode();
                    void createTask(intent).then((res) => {
                      if ('error' in res) {
                        toast.show(`重试失败：${res.error}`, 'error');
                      }
                    });
                  }
                : undefined
            }
          />
        </div>
      )}

      <div className={panelFullscreen ? 'hidden' : 'lg:hidden'}>
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
        />
      </div>

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
          if ('error' in res) toast.show(`重建任务失败：${res.error}`, 'error');
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
 */
const PANEL_MIN_PX = 560;

/**
 * Picks the viewport profile baked into the task at create time.
 * Browser sessions are spawned once at task start; the SPA's
 * fullscreen toggle is a display-side zoom only — it can't shift the
 * agent's click coordinates relative to its plan.
 *
 *   Mobile viewport (< 1024) → 'mobile' (390×844)
 *   panelPx explicit and ≥ 1100 → 'desktop' (1280×800)
 *   Otherwise → 'sidepanel' (900×900)
 */
function pickViewportProfile(inputs: {
  panelPx: number | null;
  isMobile: boolean;
}): BrowserViewportProfile {
  if (inputs.isMobile) return 'mobile';
  if (inputs.panelPx != null && inputs.panelPx >= 1100) return 'desktop';
  return 'sidepanel';
}

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

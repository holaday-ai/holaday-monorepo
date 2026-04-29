import * as React from 'react';
import { PLAN_CATALOGUE, type PlanId } from '@holaday/shared-types';
import { BrowserPanel } from '@/components/BrowserPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FeedbackDialog } from '@/components/FeedbackDialog';
import { LoginGate } from '@/components/LoginGate';
import { MainPanel } from '@/components/MainPanel';
import { ResizeHandle } from '@/components/ResizeHandle';
import { SearchOverlay } from '@/components/SearchOverlay';
import { Sidebar } from '@/components/Sidebar';
import { AppSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ui/toast';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { type ConnStatus, connect, disconnect, onServerMessage, onStatus } from '@/lib/ws';
import { useTaskStore } from '@/stores/task-store';
import { isQuotaExhausted, useQuotaStatus } from '@/lib/use-quota-status';
import { applyHistoryRetention } from '@/utils/time-buckets';

interface MeProfile {
  userId: string;
  /** Nullable since Phase 12 — SMS-first users have no email yet. */
  email: string | null;
  displayName: string | null;
  plan: string;
  /** Phase 8.2 canary flag — when true, the VNC panel connects to
   *  this user's dedicated Brave via /vnc-ws/:userId. */
  multiUser: boolean;
  /** Phase 10 Tier 2 — open-pool role ids picked by this user. */
  selectedRoles?: string[];
}

/**
 * App shell. Gates on the access token: missing → LoginGate, present
 * → the three-column workbench wired to the live task store.
 *
 * On authenticate we kick off tRPC + WS in parallel, show a skeleton
 * until either the task list + user profile both resolve or 1.5 s
 * elapse (whichever first — avoids a perpetual skeleton if one call
 * is slow). A 4401 close from the WS means the stored token is bad;
 * we clear it and bounce back to the login gate.
 */
export function WorkbenchApp(): JSX.Element {
  return <AppShell />;
}

function AppShell(): JSX.Element {
  const [authed, setAuthed] = React.useState<boolean>(() => Boolean(getAccessToken()));
  const [wsStatus, setWsStatus] = React.useState<ConnStatus>('idle');
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [browserSheetOpen, setBrowserSheetOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [confirmClearFailed, setConfirmClearFailed] = React.useState(false);
  // Panel "full-screen": Sidebar + MainPanel hidden, BrowserPanel
  // takes the whole app shell. Toggled from the Panel header button
  // and from Escape (via the existing keyboard handler below).
  const [panelFullscreen, setPanelFullscreen] = React.useState(false);
  const [me, setMe] = React.useState<MeProfile | null>(null);
  const [bootstrapped, setBootstrapped] = React.useState(false);
  /**
   * Phase 14 audit follow-up — when user is viewing a terminal
   * task, the next message defaults to a 追问. They can dismiss
   * the chip via ✕ to send a new task instead. Dismissal is
   * scoped to one task id; switching tasks resets it.
   */
  const [followUpDismissedTaskId, setFollowUpDismissedTaskId] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const toast = useToast();
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // Explicit px width for the BrowserPanel on desktop.
  // Seed from localStorage, but clamp to sanity: a 420px stored value
  // (the old min clamp) on a 1500px viewport is useless. If the
  // stored value is outside [560, viewport*0.85], ignore and fall
  // back to the 60%-of-content default.
  const contentRowRef = React.useRef<HTMLDivElement | null>(null);
  const [panelPx, setPanelPx] = React.useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem('holaday.panelPx');
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    const maxSensible = window.innerWidth * 0.85;
    if (n < 560 || n > maxSensible) {
      // Stored value doesn't make sense for this viewport → ignore.
      // Don't delete it — user's other viewport might want it back.
      return null;
    }
    return n;
  });
  // Snapshot of panelPx at drag start. Ref avoids stale-closure bugs
  // when the drag callback re-identities between frames.
  const dragStartPxRef = React.useRef<number | null>(null);
  const panelPxRef = React.useRef(panelPx);
  React.useEffect(() => {
    panelPxRef.current = panelPx;
  }, [panelPx]);

  const computeInitialPanelPx = React.useCallback((): number => {
    const row = contentRowRef.current;
    if (!row) return Math.max(720, Math.round(window.innerWidth * 0.55));
    // Default split: panel is 60% of the (content minus sidebar)
    // horizontal budget. Min 560, floor of 720 so "just opened on a
    // 1500px laptop" lands at a readable ~800px panel rather than
    // the 560 min.
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
      // Dragging the handle right SHRINKS the panel (panel is on the
      // right of the handle), so subtract dx.
      const raw = dragStartPxRef.current - dx;
      const min = 420;
      const max = Math.max(min, rowWidth - 360);
      const next = Math.min(max, Math.max(min, raw));
      setPanelPx(next);
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

  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const loading = useTaskStore((s) => s.loading);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const replyToTask = useTaskStore((s) => s.replyToTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const renameTask = useTaskStore((s) => s.renameTask);
  const awaitingUserByTask = useTaskStore((s) => s.awaitingUserByTask);
  const applyServerMessage = useTaskStore((s) => s.applyServerMessage);
  const reset = useTaskStore((s) => s.reset);
  const screencastByTask = useTaskStore((s) => s.screencastByTask);
  const captchaWaitByTask = useTaskStore((s) => s.captchaWaitByTask);
  const storeError = useTaskStore((s) => s.error);
  // Phase 10 polish — sidebar history retention + input quota gate.
  // The hooks below MUST live above the `if (!authed)` early return
  // farther down; otherwise hook count differs between the logged-out
  // render and the authenticated one, and React surfaces it as #310
  // when zustand's useSyncExternalStore detects a snapshot mismatch
  // on the transition. Existing useTaskStore selectors (above) are
  // co-located here for the same reason — keep all hooks in one
  // unconditional block at the top of the component.
  const pinnedIds = useTaskStore((s) => s.pinnedTaskIds);
  const planForRetention: PlanId =
    me?.plan === 'basic' || me?.plan === 'pro' ? me.plan : 'free';
  const historyDays = PLAN_CATALOGUE[planForRetention].historyDays;
  // selectedTaskId from above is captured by closure — no need to
  // wait for the useTaskStore selector that reads it (already at
  // line 131). retentionPinned is rebuilt only when pinnedIds or
  // selectedTaskId changes; the new Set() is intentional, since
  // applyHistoryRetention treats the set as opaque ReadonlySet.
  const retentionPinned = React.useMemo(() => {
    const set = new Set(pinnedIds);
    if (selectedTaskId) set.add(selectedTaskId);
    return set;
  }, [pinnedIds, selectedTaskId]);
  const { visible: visibleTasks, hiddenCount: hiddenByRetentionCount } =
    React.useMemo(
      () => applyHistoryRetention(tasks, historyDays, retentionPinned),
      [tasks, historyDays, retentionPinned],
    );
  // Quota gate for the composer. Refresh keyed off the task list
  // length so terminal events update both the sidebar's QuotaIndicator
  // and the input gate in the same round-trip via tRPC batching.
  const { snap: quotaSnap } = useQuotaStatus(tasks.length);
  const quotaExhausted = isQuotaExhausted(quotaSnap);

  // Bootstrap: fetch user profile + tasks list once. Flip `bootstrapped`
  // on both the resolved and the fail path so a slow / broken endpoint
  // still hides the skeleton within a reasonable window.
  React.useEffect(() => {
    if (!authed) return;
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        setBootstrapped(true);
      }
    };
    const listFuture = refreshTasks();
    const meFuture = trpc.auth.me.query().then(
      (res) =>
        setMe({
          userId: res.userId,
          email: res.email,
          displayName: res.displayName,
          plan: res.plan,
          // Server adds this in Phase 8.2; older orchestrators (pre-
          // 8.2) don't set it, so fall back to false to keep the UI
          // on the shared /vnc/websockify path.
          multiUser: Boolean((res as { multiUser?: boolean }).multiUser),
          // Phase 10 Tier 2 — server returns selected_roles list. Pre-
          // 10 orchestrators omit the field; an absent value behaves
          // the same as an empty list (banner shows for basic users
          // until they pick).
          selectedRoles:
            (res as { selectedRoles?: string[] }).selectedRoles ?? [],
        }),
      () => {
        /* swallow — auth.me failure isn't fatal. */
      },
    );
    Promise.allSettled([listFuture, meFuture]).then(finish);
    // Cap: never leave users on a skeleton longer than 1.5 s.
    const timer = setTimeout(finish, 1500);
    connect();
    const offMsg = onServerMessage(applyServerMessage);
    const offStatus = onStatus(setWsStatus);
    return () => {
      clearTimeout(timer);
      offMsg();
      offStatus();
    };
  }, [authed, refreshTasks, applyServerMessage]);

  // Auth invalidated by server (bad / expired token).
  React.useEffect(() => {
    if (wsStatus === 'unauthorized' && authed) {
      clearAccessToken();
      reset();
      disconnect();
      setMe(null);
      setAuthed(false);
      setBootstrapped(false);
    }
  }, [wsStatus, authed, reset]);

  // Surface WS reconnection / disconnect as a toast so the user knows
  // real-time is degraded. Only flag a transition away from 'open'.
  const prevWsRef = React.useRef<ConnStatus>('idle');
  React.useEffect(() => {
    const prev = prevWsRef.current;
    prevWsRef.current = wsStatus;
    if (!authed) return;
    if (prev === 'open' && (wsStatus === 'closed' || wsStatus === 'connecting')) {
      toast.show('实时连接已断开，正在重连…', 'error');
    }
    if (prev !== 'open' && wsStatus === 'open' && prev !== 'idle') {
      toast.show('实时连接已恢复');
    }
  }, [wsStatus, authed, toast]);

  // Online / offline toasts (browser event). We only fire after the
  // initial mount so a cold-start offline doesn't double-notify with
  // the WS one.
  React.useEffect(() => {
    const onOffline = (): void => {
      setOnline(false);
      toast.show('网络连接已断开', 'error');
    };
    const onOnline = (): void => {
      setOnline(true);
      toast.show('网络已恢复');
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [toast]);

  // Surface store-level errors (failed list/create/delete) as toasts.
  const lastErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (storeError && storeError !== lastErrorRef.current) {
      lastErrorRef.current = storeError;
      toast.show(storeError, 'error');
    }
    if (!storeError) lastErrorRef.current = null;
  }, [storeError, toast]);

  // Keyboard shortcuts.
  React.useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';
      // Cmd/Ctrl + K: search.
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // Cmd/Ctrl + N: new task + focus composer.
      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setSelectedTask(null);
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }
      // Escape: close any modal; if nothing is open, deselect the task.
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (feedbackOpen) {
          setFeedbackOpen(false);
          return;
        }
        if (browserSheetOpen) {
          setBrowserSheetOpen(false);
          return;
        }
        if (panelFullscreen) {
          setPanelFullscreen(false);
          return;
        }
        if (selectedTaskId && !inField) {
          setSelectedTask(null);
        }
        return;
      }
      // '/' to focus the composer (not in a field).
      if (e.key === '/' && !inField && !meta && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authed, searchOpen, feedbackOpen, browserSheetOpen, panelFullscreen, selectedTaskId, setSelectedTask]);

  const handleLogout = React.useCallback(() => {
    clearAccessToken();
    disconnect();
    reset();
    setMe(null);
    setAuthed(false);
    setBootstrapped(false);
  }, [reset]);

  if (!authed) {
    return <LoginGate onAuthenticated={() => setAuthed(true)} />;
  }

  if (!bootstrapped) return <AppSkeleton />;

  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;
  const greetingName = me?.displayName || (me?.email ? firstSegment(me.email) : '');

  // Phase 14 audit follow-up — chip + replyToTaskId wiring.
  // Active when the selected task is in a terminal state AND not
  // currently parked on an awaiting_user question (replyMode wins
  // over follow-up — that's a tasks.reply, not a new task) AND
  // the user hasn't explicitly dismissed it for this task.
  const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
  const isReplyMode = Boolean(
    selectedTaskId && awaitingUserByTask[selectedTaskId],
  );
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

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden" ref={contentRowRef}>
      {!panelFullscreen && (
      <Sidebar
        tasks={visibleTasks}
        hiddenTaskCount={hiddenByRetentionCount}
        historyDays={historyDays}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTask}
        onNewTask={() => {
          setSelectedTask(null);
          setTimeout(() => inputRef.current?.focus(), 50);
          // Reset the panel by navigating Brave to Google. Doubles as
          // a product affordance: "you're connected to the open
          // internet through HOLA DAY" — way more inviting than
          // about:blank for a user who just signed up. Fire-and-
          // forget; errors are logged server-side, the user just
          // sees the previous frame for a beat longer.
          void trpc.tasks.browserNav
            .mutate({ direction: 'goto', url: 'https://www.google.com' })
            .catch(() => {});
        }}
        onDeleteTask={(taskId) => {
          // Defer the actual delete until the user confirms in the
          // modal below; onConfirm pulls the id back out of state.
          setConfirmDelete(taskId);
        }}
        onRetryTask={async (intent) => {
          const res = await createTask(intent);
          if ('error' in res) toast.show(`重试失败：${res.error}`, 'error');
        }}
        onRenameTask={async (taskId, title) => {
          const res = await renameTask(taskId, title);
          if ('error' in res) toast.show(`重命名失败：${res.error}`, 'error');
        }}
        userEmail={me?.email ?? null}
        userDisplayName={me?.displayName ?? firstSegment(me?.email ?? '') ?? ''}
        userPlan={me?.plan ?? 'free'}
        onLogout={handleLogout}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        failedTaskCount={tasks.filter((t) => t.status === 'failed').length}
        onClearFailedTasks={() => setConfirmClearFailed(true)}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      )}
      {!panelFullscreen && (
      <MainPanel
        task={selectedTask}
        busy={loading}
        greetingName={greetingName || undefined}
        inputRef={inputRef}
        replyMode={isReplyMode}
        followUpTarget={followUpTarget}
        onCancelFollowUp={() => {
          if (selectedTaskId) setFollowUpDismissedTaskId(selectedTaskId);
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
        onSubmit={async (intent, fileIds) => {
          // 1) In-flight awaiting_user → tasks.reply, resumes the existing loop.
          if (isReplyMode && selectedTaskId) {
            const res = await replyToTask(selectedTaskId, intent);
            if ('error' in res) toast.show(`回复失败：${res.error}`, 'error');
            else if (!res.ok) toast.show('这个任务已经不在等待回复了', 'error');
            return;
          }
          // 2) Terminal task selected + chip not dismissed → 追问 (free,
          //    parent context auto-injected server-side).
          if (followUpTarget) {
            const res = await createTask(intent, fileIds, followUpTarget.taskId);
            if ('error' in res) toast.show(`追问失败：${res.error}`, 'error');
            return;
          }
          // 3) Default — fresh task.
          const res = await createTask(intent, fileIds);
          if ('error' in res) toast.show(`发送失败：${res.error}`, 'error');
        }}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenBrowser={() => setBrowserSheetOpen(true)}
      />
      )}
      {!panelFullscreen && <ResizeHandle onDrag={onPanelResizeDrag} onDragEnd={onPanelResizeEnd} />}
      <div
        className={
          panelFullscreen
            ? 'flex h-full w-full flex-col'
            : 'hidden h-full lg:flex lg:flex-col lg:shrink-0'
        }
        style={
          panelFullscreen
            ? undefined
            : panelPx != null
              ? { flex: `0 0 ${panelPx}px` }
              : { flex: '3 1 0', minWidth: 560 }
        }
      >
        <BrowserPanel
          frame={selectedTask ? (screencastByTask[selectedTask.taskId] ?? null) : null}
          taskStatus={selectedTask?.status ?? null}
          awaitingUser={
            selectedTask ? Boolean(captchaWaitByTask[selectedTask.taskId]) : false
          }
          activeTaskId={selectedTaskId}
          poolUserId={me?.multiUser ? me.userId : null}
          fullscreen={panelFullscreen}
          onToggleFullscreen={() => setPanelFullscreen((v) => !v)}
        />
      </div>
      <div className={panelFullscreen ? 'hidden' : 'lg:hidden'}>
        <BrowserPanel
          layout="sheet"
          open={browserSheetOpen}
          onClose={() => setBrowserSheetOpen(false)}
          frame={selectedTask ? (screencastByTask[selectedTask.taskId] ?? null) : null}
          taskStatus={selectedTask?.status ?? null}
          awaitingUser={
            selectedTask ? Boolean(captchaWaitByTask[selectedTask.taskId]) : false
          }
          activeTaskId={selectedTaskId}
          poolUserId={me?.multiUser ? me.userId : null}
        />
      </div>

      <SearchOverlay
        open={searchOpen}
        tasks={tasks}
        onClose={() => setSearchOpen(false)}
        onPick={(taskId) => setSelectedTask(taskId)}
      />

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSubmit={async (message) => {
          try {
            const ctx = selectedTaskId ? `task_id=${selectedTaskId}` : undefined;
            await trpc.feedback.submit.mutate(
              ctx ? { message, context: ctx } : { message },
            );
            return { ok: true as const };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.show(`反馈发送失败：${msg}`, 'error');
            return { error: msg };
          }
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="确认删除此任务？"
        description="任务记录和所有步骤都会清除，操作无法恢复。"
        confirmLabel="删除"
        destructive
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const taskId = confirmDelete;
          setConfirmDelete(null);
          if (!taskId) return;
          const res = await deleteTask(taskId);
          if ('error' in res) toast.show(`删除失败：${res.error}`, 'error');
          else toast.show('任务已删除');
        }}
      />

      <ConfirmDialog
        open={confirmClearFailed}
        title="清除所有失败任务？"
        description="这些任务的记录和步骤都会被删除，操作无法恢复。进行中的任务不受影响。"
        confirmLabel={`清除 ${tasks.filter((t) => t.status === 'failed').length} 个`}
        destructive
        onClose={() => setConfirmClearFailed(false)}
        onConfirm={async () => {
          setConfirmClearFailed(false);
          const failed = tasks.filter((t) => t.status === 'failed');
          if (failed.length === 0) return;
          // Issue deletes in parallel — each one is a cheap DB write.
          // Errors toast individually; a partial failure doesn't block
          // the rest. We swallow individual rejects so Promise.all
          // fulfils even if one fails.
          const results = await Promise.all(
            failed.map((t) =>
              deleteTask(t.taskId).then(
                (r) => r,
                (err) => ({ error: err instanceof Error ? err.message : String(err) }),
              ),
            ),
          );
          const errs = results.filter((r): r is { error: string } => 'error' in r);
          if (errs.length === 0) toast.show(`已清除 ${failed.length} 个失败任务`);
          else if (errs.length === failed.length)
            toast.show(`清除失败：${errs[0]?.error ?? 'unknown'}`, 'error');
          else
            toast.show(
              `清除了 ${failed.length - errs.length} 个，${errs.length} 个失败`,
              'error',
            );
        }}
      />

      {!online && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] bg-red-600/95 px-3 py-1.5 text-center text-[11px] font-medium text-white"
        >
          当前离线 — 暂时无法创建新任务
        </div>
      )}
    </div>
  );
}

function firstSegment(email: string): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

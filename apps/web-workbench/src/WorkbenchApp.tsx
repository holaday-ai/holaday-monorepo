import * as React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PLAN_CATALOGUE, type PlanId } from '@holaday/shared-types';
import { BrowserPanel } from '@/components/BrowserPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FeedbackDialog } from '@/components/FeedbackDialog';
import { LoginGate } from '@/components/LoginGate';
import { MainPanel } from '@/components/MainPanel';
import { ResizeHandle } from '@/components/ResizeHandle';
import { SearchOverlay } from '@/components/SearchOverlay';
import { SettingsModal } from '@/components/SettingsModal';
import { Sidebar } from '@/components/Sidebar';
import { AppSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ui/toast';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { hdDebug } from '@/lib/hd-debug';
import { trpc } from '@/lib/trpc';
import { type ConnStatus, connect, disconnect, onServerMessage, onStatus } from '@/lib/ws';
import { toUiTask, useTaskStore } from '@/stores/task-store';
import { isQuotaExhausted, useQuotaStatus } from '@/lib/use-quota-status';
import { applyHistoryRetention } from '@/utils/time-buckets';
import type { UiProject, UiTask } from '@/types/task';

interface MeProfile {
  userId: string;
  /** Nullable since Phase 12 — SMS-first users have no email yet. */
  email: string | null;
  /** Phase 12 SMS users — 11-digit mainland mobile. */
  phone?: string | null;
  displayName: string | null;
  plan: string;
  /** Phase 8.2 canary flag — when true, the VNC panel connects to
   *  this user's dedicated Brave via /vnc-ws/:userId. */
  multiUser: boolean;
  /** Phase 10 Tier 2 — open-pool role ids picked by this user. */
  selectedRoles?: string[];
}

/**
 * B5 — humanise the displayName so legacy SMS-registered users (whose
 * displayName is the masked "138****1234") see "用户_<last4>" in the
 * UI instead of leaking their phone number into the avatar / greeting.
 * The new-registration path already stores 用户_XXXX (auth/service.ts);
 * this is the read-side fallback for rows that were inserted before
 * that fix landed.
 */
function preferredDisplayName(me: MeProfile | null): string {
  if (!me) return '';
  const raw = me.displayName?.trim();
  // Heuristic: any string that contains a phone-mask sequence
  // (3 digits + asterisks + 4 digits) we treat as the legacy
  // masked phone and replace with the prettier 用户_XXXX form.
  // Falls back to email prefix or the literal phone last4.
  const looksMasked = raw ? /\d{3}\**\d{4}/.test(raw) : false;
  if (raw && !looksMasked) return raw;
  if (me.phone) return `用户_${me.phone.slice(-4)}`;
  if (me.email) return firstSegment(me.email);
  return '用户';
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
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState<
    string[] | null
  >(null);
  const [confirmClearFailed, setConfirmClearFailed] = React.useState(false);
  // Panel "full-screen": Sidebar + MainPanel hidden, BrowserPanel
  // takes the whole app shell. Toggled from the Panel header button
  // and from Escape (via the existing keyboard handler below).
  const [panelFullscreen, setPanelFullscreen] = React.useState(false);
  // Lifted collapse state. The previous local state inside
  // BrowserPanel only narrowed an inner div but the parent column
  // (`flex: 3 1 0` / configured panelPx) kept its width — so the
  // collapse button visibly did nothing on desktop. Owning the flag
  // up here lets us also override the column flex and hide the
  // resize handle when collapsed.
  const [browserCollapsed, setBrowserCollapsed] = React.useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  // Phase 16b — when ?project=prj_… is present in the URL the
  // sidebar filters down to that project's tasks (the route stays /
  // — workbench just shows a filter chip + the filtered list).
  const projectFilter = searchParams.get('project');
  const [me, setMe] = React.useState<MeProfile | null>(null);
  const [bootstrapped, setBootstrapped] = React.useState(false);
  // Phase 16b — projects list, loaded once on mount + refreshed
  // after a move-to-project (so the right-click submenu and the
  // /projects page see new task counts). Empty until first fetch
  // resolves; the right-click submenu hides "无项目" + the list
  // when projects is undefined, so an empty state renders cleanly.
  const [projects, setProjects] = React.useState<UiProject[]>([]);
  const refreshProjects = React.useCallback(async () => {
    try {
      const list = await trpc.projects.list.query();
      setProjects(list as UiProject[]);
    } catch {
      // Silent — the right-click menu just won't show options.
    }
  }, []);
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
  const composerMode = useTaskStore((s) => s.composerMode);
  const loading = useTaskStore((s) => s.loading);
  const selectTask = useTaskStore((s) => s.selectTask);
  const enterNewTaskMode = useTaskStore((s) => s.enterNewTaskMode);
  const requestBrowserLive = useTaskStore((s) => s.requestBrowserLive);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const createTask = useTaskStore((s) => s.createTask);
  const replyToTask = useTaskStore((s) => s.replyToTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const renameTask = useTaskStore((s) => s.renameTask);
  const toggleStarred = useTaskStore((s) => s.toggleStarred);
  const moveTaskToProject = useTaskStore((s) => s.moveTaskToProject);
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
  // Project-scoped task list. When `?project=prj_…` is present we
  // fetch tasks.list with the projectId filter so older entries past
  // the sidebar's first-50 slice still surface here. Independent
  // pagination state — own cursor/hasMore/loading — so the "加载
  // 更多" button paginates within the project instead of the
  // store's global all-tasks list. Reset + refetch whenever
  // projectFilter changes.
  const [projectTasks, setProjectTasks] = React.useState<UiTask[] | null>(null);
  const [projectCursor, setProjectCursor] = React.useState<number | null>(null);
  const [projectHasMore, setProjectHasMore] = React.useState(false);
  const [projectLoadingMore, setProjectLoadingMore] = React.useState(false);
  const projectFetchToken = React.useRef(0);
  const loadProjectTasksPage = React.useCallback(
    async (
      pid: string,
      cursor: number | null,
      append: boolean,
    ): Promise<void> => {
      const myToken = ++projectFetchToken.current;
      setProjectLoadingMore(true);
      try {
        const res = await trpc.tasks.list.query({
          projectId: pid,
          limit: 50,
          ...(cursor != null ? { cursor } : {}),
        });
        if (myToken !== projectFetchToken.current) return;
        const fresh = res.tasks.map((t) => toUiTask(t));
        setProjectTasks((prev) => (append && prev ? [...prev, ...fresh] : fresh));
        setProjectCursor(res.nextCursor ?? null);
        setProjectHasMore(res.nextCursor != null);
      } catch {
        if (myToken !== projectFetchToken.current) return;
        if (!append) setProjectTasks([]);
      } finally {
        if (myToken === projectFetchToken.current) {
          setProjectLoadingMore(false);
        }
      }
    },
    [],
  );
  React.useEffect(() => {
    if (!projectFilter) {
      // Drop project-scoped state when the filter goes away — the
      // sidebar reverts to the store's tasks + the store-based
      // LoadMoreTasksButton.
      setProjectTasks(null);
      setProjectCursor(null);
      setProjectHasMore(false);
      setProjectLoadingMore(false);
      projectFetchToken.current += 1;
      return;
    }
    setProjectTasks(null);
    setProjectCursor(null);
    setProjectHasMore(false);
    void loadProjectTasksPage(projectFilter, null, false);
  }, [projectFilter, loadProjectTasksPage]);
  const onProjectLoadMore = React.useCallback(() => {
    if (!projectFilter) return;
    if (!projectHasMore || projectLoadingMore) return;
    void loadProjectTasksPage(projectFilter, projectCursor, true);
  }, [
    projectFilter,
    projectHasMore,
    projectLoadingMore,
    projectCursor,
    loadProjectTasksPage,
  ]);
  // Sidebar list source: server-fetched project view when filter is
  // active, otherwise the retention-clipped store list. Retention
  // doesn't apply to the project-scoped fetch — the user explicitly
  // navigated into the project, they want the full list.
  const filteredTasks = React.useMemo(() => {
    if (projectFilter) return projectTasks ?? [];
    return visibleTasks;
  }, [projectFilter, projectTasks, visibleTasks]);
  const activeProject = React.useMemo(
    () => projects.find((p) => p.projectId === projectFilter) ?? null,
    [projects, projectFilter],
  );
  // Quota gate for the composer. Refresh keyed off the task list
  // length so terminal events update both the sidebar's QuotaIndicator
  // and the input gate in the same round-trip via tRPC batching.
  const { snap: quotaSnap } = useQuotaStatus(tasks.length);
  const quotaExhausted = isQuotaExhausted(quotaSnap);

  // Bootstrap: single-shot state-machine entry. Reads the URL +
  // location.state ONCE on mount, dispatches the right initial
  // selection, then refreshes the list (which won't override the
  // selection — the store's refreshTaskList only auto-picks when
  // there's nothing selected and no `?task=` hint). Replaces the
  // earlier mix of an inbound URL effect, an outbound URL-sync
  // effect, and refreshTasks's auto-select — all of which used to
  // fight each other for selectedTaskId in the same render cycle.
  React.useEffect(() => {
    if (!authed) return;
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        setBootstrapped(true);
      }
    };

    // Read URL + state once. location is authoritative for the
    // initial selection decision (the navigation that brought the
    // user here already updated it before this effect ran).
    const urlTaskParam = new URLSearchParams(location.search).get('task');
    const stateNewTask =
      (location.state as { newTask?: boolean } | null)?.newTask === true;

    if (stateNewTask) {
      // Files page → 用于新任务. Drop any current selection / URL
      // ?task= regardless of what was there.
      enterNewTaskMode();
    } else if (urlTaskParam) {
      // Deep link / refresh-with-task. URL is the source of truth.
      // source='url' so selectTask doesn't replaceState (URL already
      // matches).
      selectTask(urlTaskParam, 'url');
    }

    const listFuture = refreshTaskList();
    const meFuture = trpc.auth.me.query().then(
      (res) =>
        setMe({
          userId: res.userId,
          email: res.email,
          displayName: res.displayName,
          plan: res.plan,
          multiUser: Boolean((res as { multiUser?: boolean }).multiUser),
          selectedRoles:
            (res as { selectedRoles?: string[] }).selectedRoles ?? [],
        }),
      () => {
        /* swallow — auth.me failure isn't fatal. */
      },
    );
    Promise.allSettled([listFuture, meFuture]).then(finish);
    const timer = setTimeout(finish, 1500);
    void refreshProjects();
    connect();
    const offMsg = onServerMessage(applyServerMessage);
    const offStatus = onStatus(setWsStatus);
    return () => {
      clearTimeout(timer);
      offMsg();
      offStatus();
    };
  }, [
    authed,
    refreshTaskList,
    applyServerMessage,
    refreshProjects,
    selectTask,
    enterNewTaskMode,
  ]);

  // URL → store: deep-link only. A missing ?task= is NOT a signal
  // to enter new-task mode — new-task is entered only by explicit
  // user intent (button, /files 用于新任务, keyboard shortcut). An
  // earlier "!taskParam → enterNewTaskMode" branch raced the outbound
  // navigate() and oscillated infinitely (101× selectTask ↔ 101×
  // enterNewTaskMode in a single mount).
  //
  // composerMode='new' gate: when the user just entered new-task
  // mode, this effect re-runs before outbound's navigate() has
  // flushed React Router's location, so `taskParam` still reads
  // the pre-click value (e.g. 'tsk_iJj8'). Without the gate, that
  // stale read fires `selectTask('url')` and undoes the user's
  // 发新任务 click. Skipping while composerMode==='new' lets
  // outbound clear the URL first; on the next render this effect
  // sees taskParam=null and is a no-op.
  const taskParam = searchParams.get('task');
  React.useEffect(() => {
    if (!bootstrapped) return;
    if (composerMode === 'new') return;
    if (taskParam && taskParam !== selectedTaskId) {
      selectTask(taskParam, 'url');
    }
  }, [bootstrapped, composerMode, taskParam, selectedTaskId, selectTask]);

  // D1 — store → URL outbound sync. Lives here (not in selectTask)
  // because React Router's `useSearchParams` ignores raw
  // `window.history.replaceState` writes — RR-internal history is
  // its own state. Going through `navigate` keeps RR's state
  // consistent so the inbound effect above sees the new taskParam
  // immediately and the round-trip closes cleanly. Other params
  // (?project=, _cb=, etc.) preserved.
  //
  // Also watches composerMode: a flip to 'new' must drop ?task=
  // even if selectedTaskId was already null (entering new-task
  // mode from a state where selection was previously cleared but
  // URL hadn't been reconciled — happens when an earlier path
  // wrote selectedTaskId=null without going through the canonical
  // selectTask/enterNewTaskMode signals the outbound effect was
  // watching). Without this branch, clicking 发新任务 in that
  // state was a no-op for the URL.
  React.useEffect(() => {
    if (!bootstrapped) return;
    const desired = composerMode === 'new' ? null : (selectedTaskId ?? null);
    if ((taskParam ?? null) === desired) return;
    const next = new URLSearchParams(searchParams);
    if (desired) next.set('task', desired);
    else next.delete('task');
    const search = next.toString() ? `?${next.toString()}` : '';
    navigate({ pathname: location.pathname, search }, { replace: true });
  }, [
    bootstrapped,
    selectedTaskId,
    composerMode,
    taskParam,
    searchParams,
    navigate,
    location.pathname,
  ]);

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
        enterNewTaskMode();
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
          enterNewTaskMode();
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
  }, [authed, searchOpen, feedbackOpen, browserSheetOpen, panelFullscreen, selectedTaskId, enterNewTaskMode]);

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
  const greetingName = preferredDisplayName(me);

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
        tasks={filteredTasks}
        hiddenTaskCount={projectFilter ? 0 : hiddenByRetentionCount}
        projectFilter={
          activeProject
            ? { projectId: activeProject.projectId, name: activeProject.name }
            : null
        }
        onClearProjectFilter={() => navigate('/')}
        historyDays={historyDays}
        // In project-filter mode, paginate within the project's
        // tasks via tasks.list({ projectId, cursor }). Without this
        // override, the sidebar's "加载更多" button paged the
        // store's global all-tasks list — which is the wrong axis
        // when the user has scoped down to a single project.
        pagerOverride={
          projectFilter
            ? {
                hasMore: projectHasMore,
                loadingMore: projectLoadingMore,
                onLoadMore: onProjectLoadMore,
              }
            : undefined
        }
        selectedTaskId={selectedTaskId}
        onSelectTask={(taskId) => {
          if (taskId) selectTask(taskId, 'ui');
          else enterNewTaskMode();
        }}
        onNewTask={() => {
          // 新任务 button is "clear the composer + focus" only — no
          // background browser wake. Allocating a Brave on every new-
          // task click was wasteful for non-browser tasks and gave a
          // misleading "browser is loading" signal in the right rail
          // when the user just wanted to start typing. Browser is
          // allocated lazily by `createTask` for tasks that actually
          // need it, or explicitly via the sidebar 浏览器 entry.
          enterNewTaskMode();
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        onDeleteTask={(taskId) => {
          // Defer the actual delete until the user confirms in the
          // modal below; onConfirm pulls the id back out of state.
          setConfirmDelete(taskId);
        }}
        onDeleteTasks={(taskIds) => {
          if (taskIds.length === 0) return;
          setConfirmBulkDelete(taskIds);
        }}
        onRetryTask={async (intent) => {
          const res = await createTask(intent);
          if ('error' in res) toast.show(`重试失败：${res.error}`, 'error');
        }}
        onRenameTask={async (taskId, title) => {
          const res = await renameTask(taskId, title);
          if ('error' in res) toast.show(`重命名失败：${res.error}`, 'error');
        }}
        onToggleStarred={(taskId) => void toggleStarred(taskId)}
        projects={projects}
        onMoveTaskToProject={async (taskId, projectId) => {
          await moveTaskToProject(taskId, projectId);
          // Refresh project task counts in the background so the
          // sidebar's submenu and the /projects page see the latest
          // numbers on next open.
          void refreshProjects();
        }}
        onCreateProject={() => navigate('/projects?create=1')}
        onOpenBrowser={() => {
          // Phase 18 — sidebar 浏览器 entry. Mobile (< lg) opens
          // the BrowserPanel sheet; desktop the panel is already
          // visible in the right rail, so we just kick wakeBrowser
          // so the user's Brave is ready when they arrive at it.
          // Fire-and-forget — wake errors land in toast via the
          // existing onNewTask path's handling.
          // requestBrowserLive opts the panel out of the no-active-
          // task idle gate so the user-scoped pool stream connects
          // immediately. Cleared automatically on next selectTask /
          // enterNewTaskMode / createTask.
          requestBrowserLive();
          setBrowserSheetOpen(true);
          void (async () => {
            try {
              await trpc.tasks.wakeBrowser.mutate();
            } catch {
              /* swallow — wakeBrowser errors are surfaced when the
                 first task tries to drive the browser */
            }
          })();
        }}
        userEmail={me?.email ?? null}
        userDisplayName={preferredDisplayName(me)}
        userPlan={me?.plan ?? 'free'}
        onLogout={handleLogout}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
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
          // 发新任务 — drop the follow-up chip AND clear the
          // selection / URL via the canonical state-machine entry.
          // setFollowUpDismissedTaskId on its own only suppressed
          // the chip locally; selectedTaskId stayed put, ?task= in
          // URL stayed put, and refreshTaskList could later re-
          // surface the same task as the panel default.
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
          // B6 diagnostic — surfaces in browser console which branch
          // fires for each submit. BOSS reported "follow-up still
          // creates a new task"; the routing is technically correct
          // (server creates a new task row + injects parent context)
          // but the visual outcome looks the same as fresh-task. Log
          // helps verify the FE actually sent replyToTaskId.
          hdDebug('onSubmit', {
            isReplyMode,
            followUpTaskId: followUpTarget?.taskId ?? null,
            selectedTaskId,
            mode,
          });
          // 1) In-flight awaiting_user → tasks.reply, resumes the existing loop.
          if (isReplyMode && selectedTaskId) {
            const res = await replyToTask(selectedTaskId, intent);
            if ('error' in res) toast.show(`回复失败：${res.error}`, 'error');
            else if (!res.ok) toast.show('这个任务已经不在等待回复了', 'error');
            return;
          }
          // 2) Terminal task selected + chip not dismissed → 追问 (free,
          //    parent context auto-injected server-side). Plan mode is
          //    skipped on follow-ups — the parent already established
          //    intent context, no value in pausing again.
          if (followUpTarget) {
            const res = await createTask(intent, fileIds, followUpTarget.taskId);
            if ('error' in res) toast.show(`追问失败：${res.error}`, 'error');
            else toast.show('已基于上一个任务追问');
            return;
          }
          // 3) Default — fresh task. Pass mode through so Plan flips
          //    the agent into "list plan first, wait for approval".
          const res = await createTask(intent, fileIds, undefined, mode);
          if ('error' in res) {
            // O15 — server returns BAD_REQUEST with this exact prefix
            // when the intent looks like a code task. Surface as an
            // informational toast (no "发送失败：" prefix, no error
            // styling) so the user understands the rejection isn't a
            // failure of HOLA DAY but a positioning choice.
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
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenBrowser={() => {
          // Mobile parity with the sidebar 浏览器 entry — wake the
          // pool browser so the sheet shows a live frame instead of
          // a dead about:blank when the user opens it from the
          // mobile shell.
          requestBrowserLive();
          setBrowserSheetOpen(true);
          void trpc.tasks.wakeBrowser.mutate().catch(() => {
            /* fire-and-forget, surfaces in toast on real task drive */
          });
        }}
      />
      )}
      {!panelFullscreen && !browserCollapsed && (
        <ResizeHandle onDrag={onPanelResizeDrag} onDragEnd={onPanelResizeEnd} />
      )}
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
          collapsed={browserCollapsed}
          onToggleCollapse={() => setBrowserCollapsed((v) => !v)}
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
        onPick={(taskId) => selectTask(taskId, 'ui')}
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

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        displayName={preferredDisplayName(me)}
        email={me?.email ?? null}
        phone={me?.phone ?? null}
        plan={me?.plan ?? 'free'}
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
        open={confirmBulkDelete !== null}
        title={`删除选中的 ${confirmBulkDelete?.length ?? 0} 个任务？`}
        description="任务记录和所有步骤都会清除，操作无法恢复。"
        confirmLabel={`删除 ${confirmBulkDelete?.length ?? 0} 个`}
        destructive
        onClose={() => setConfirmBulkDelete(null)}
        onConfirm={async () => {
          const ids = confirmBulkDelete;
          setConfirmBulkDelete(null);
          if (!ids || ids.length === 0) return;
          // Same allSettled tally pattern as 清除失败任务 above —
          // each delete is a cheap DB write, partial failures are
          // surfaced in the toast rather than aborting the rest.
          const results = await Promise.all(
            ids.map((id) =>
              deleteTask(id).then(
                (r) => r,
                (err) => ({ error: err instanceof Error ? err.message : String(err) }),
              ),
            ),
          );
          const errs = results.filter(
            (r): r is { error: string } => 'error' in r,
          );
          if (errs.length === 0) toast.show(`已删除 ${ids.length} 个任务`);
          else if (errs.length === ids.length)
            toast.show(`删除失败：${errs[0]?.error ?? 'unknown'}`, 'error');
          else
            toast.show(
              `已删除 ${ids.length - errs.length} 个，${errs.length} 个失败`,
              'error',
            );
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

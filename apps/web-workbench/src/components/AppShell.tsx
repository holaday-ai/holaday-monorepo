import * as React from 'react';
import { WifiOff } from 'lucide-react';
import {
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FeedbackDialog } from '@/components/FeedbackDialog';
import { LoginGate } from '@/components/LoginGate';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { SearchOverlay } from '@/components/SearchOverlay';
import { Sidebar } from '@/components/Sidebar';
import { AppSkeleton } from '@/components/Skeleton';
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';
// Phase 26B — hd-popover-enter keyframe is defined in the calendar's
// CSS but used by NotificationBell + other popovers too. Import here
// so it's available globally even before the user opens /scheduled.
import '@/pages/scheduled-calendar/calendar-styles.css';
import { useToast } from '@/components/ui/toast';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import {
  normalizeAuthMeProfile,
  preferredAuthDisplayName,
  type NormalizedAuthMeProfile,
} from '@/lib/auth-me-state';
import { authSessionExpiredMessage, isAuthSessionError } from '@/lib/auth-session';
import { taskActionError } from '@/lib/error-copy';
import { pageActionError, pageErrorMessage } from '@/lib/page-error-copy';
import {
  projectFilterChipState,
  projectTaskFilterAppendPage,
  projectTaskFilterAfterFailedTasksCleared,
  projectTaskFilterAfterTaskDelete,
  projectTaskFilterAfterTaskMove,
  projectTaskFilterFirstPage,
  projectTaskFilterLoadMoreFailed,
  projectTaskFilterStartLoadMore,
  refreshProjectTaskFilterState,
  resolveProjectFilteredTasks,
  type ProjectTaskFilterState,
} from '@/lib/project-task-filter-state';
import { normalizeProjectRows } from '@/lib/project-page-state';
import { shouldKeepProjectFilterForPickedTask } from '@/lib/task-selection-url-state';
import { trpc } from '@/lib/trpc';
import {
  networkTransitionToast,
  normalizeTaskActionCount,
  realtimeConnectionTransition,
} from '@/lib/workbench-state';
import {
  connect,
  disconnect,
  onServerMessage,
  onStatus,
  type ConnStatus,
} from '@/lib/ws';
import {
  normalizeTaskListCursor,
  normalizeTaskListRows,
  setStoreNavigate,
  useTaskStore,
} from '@/stores/task-store';
import type { UiProject, UiTask } from '@/types/task';
import { applyHistoryRetention } from '@/utils/time-buckets';
import { PLAN_CATALOGUE, type PlanId } from '@holaday/shared-types';

type MeProfile = NormalizedAuthMeProfile;

interface OutletContext {
  me: MeProfile | null;
  refreshProjects(): Promise<ProjectRefreshResult>;
  projects: readonly UiProject[];
}

type ProjectRefreshResult =
  | { ok: true; projects: UiProject[] }
  | { error: string };

/**
 * The one and only authed shell. Every authed route renders inside
 * here via `<Outlet />`. The shell owns:
 *
 *   - auth gate (LoginGate when no token, AppSkeleton during boot,
 *     children once both)
 *   - global bootstrap (auth.me + tasks.list + WS connect + projects
 *     list + URL ⇄ task store sync via setStoreNavigate)
 *   - the Sidebar mount (so /, /scheduled, /batch, /files all share
 *     the same Sidebar instance — no re-mount on route switch)
 *   - shared modals: SearchOverlay, FeedbackDialog,
 *     single-delete + bulk-delete + clear-failed confirms
 *   - keyboard shortcuts that span every route: Cmd/Ctrl+K (search),
 *     Cmd/Ctrl+N (new task), Esc (close topmost modal)
 *   - online / offline + WS reconnect + store-error toasts
 *
 * Inner workbench state (BrowserPanel resize, panel-fullscreen toggle,
 * the reply-flow rebuild-task confirm) lives in WorkbenchApp — those
 * are intrinsic to `/`. Both share the task store via zustand and the
 * Sidebar open state via shadcn's useSidebar().
 *
 * The shell exposes `me` + `projects` to children via `useOutletContext`
 * so individual pages don't each re-fetch.
 */
export function AppShell(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  // Auth state.
  const [authed, setAuthed] = React.useState<boolean>(() =>
    Boolean(getAccessToken()),
  );
  const [bootstrapped, setBootstrapped] = React.useState(false);
  const [wsStatus, setWsStatus] = React.useState<ConnStatus>('idle');
  const [me, setMe] = React.useState<MeProfile | null>(null);
  const [projects, setProjects] = React.useState<UiProject[]>([]);
  const [online, setOnline] = React.useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // Shared modal state.
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState<
    string[] | null
  >(null);
  const [confirmClearFailed, setConfirmClearFailed] = React.useState(false);
  const mountedRef = React.useRef(false);
  const authInvalidatedRef = React.useRef(false);
  const failedCountRequestRef = React.useRef(0);
  const projectRefreshRequestRef = React.useRef(0);
  const projectFilterRequestRef = React.useRef(0);
  const projectLoadMoreRequestRef = React.useRef(0);
  /**
   * BOSS bug fix — server-side failed-task count for the user
   * menu badge + clear-confirm dialog. The previous
   * `tasks.filter(failed).length` only counted what the SPA had
   * loaded (paginated), so the badge lagged reality after
   * out-of-band cleanups (admin SQL, deployments). Refetched on
   * bootstrap + after the clear-all action settles.
   */
  const [serverFailedCount, setServerFailedCount] = React.useState(0);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      failedCountRequestRef.current += 1;
      projectRefreshRequestRef.current += 1;
      projectFilterRequestRef.current += 1;
      projectLoadMoreRequestRef.current += 1;
    };
  }, []);

  const refreshFailedCount = React.useCallback(async () => {
    const requestId = failedCountRequestRef.current + 1;
    failedCountRequestRef.current = requestId;
    try {
      const res = await trpc.tasks.failedCount.query();
      if (!mountedRef.current || failedCountRequestRef.current !== requestId) return;
      setServerFailedCount(
        normalizeTaskActionCount((res as { count?: unknown } | null)?.count),
      );
    } catch {
      /* non-fatal — badge stays at last known value */
    }
  }, []);

  // Task store selectors.
  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const selectTask = useTaskStore((s) => s.selectTask);
  const enterNewTaskMode = useTaskStore((s) => s.enterNewTaskMode);
  const composerMode = useTaskStore((s) => s.composerMode);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const createTask = useTaskStore((s) => s.createTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const renameTask = useTaskStore((s) => s.renameTask);
  const moveTaskToProject = useTaskStore((s) => s.moveTaskToProject);
  const applyServerMessage = useTaskStore((s) => s.applyServerMessage);
  const storeError = useTaskStore((s) => s.error);
  const reset = useTaskStore((s) => s.reset);

  // Refresh projects on demand (used after move-to-project).
  const refreshProjects = React.useCallback(async (): Promise<ProjectRefreshResult> => {
    const requestId = projectRefreshRequestRef.current + 1;
    projectRefreshRequestRef.current = requestId;
    try {
      const list = await trpc.projects.list.query();
      const nextProjects = normalizeProjectRows(list);
      if (mountedRef.current && projectRefreshRequestRef.current === requestId) {
        setProjects(nextProjects);
      }
      return { ok: true, projects: nextProjects };
    } catch (err) {
      if (!mountedRef.current || projectRefreshRequestRef.current !== requestId) {
        return { ok: true, projects: [] };
      }
      return {
        error: pageErrorMessage(err),
      };
    }
  }, []);

  const refreshDeletionDependentMeta = React.useCallback(() => {
    void refreshFailedCount();
    void refreshProjects();
  }, [refreshFailedCount, refreshProjects]);

  const invalidateAuthSession = React.useCallback(() => {
    if (authInvalidatedRef.current) return;
    authInvalidatedRef.current = true;
    clearAccessToken();
    reset();
    disconnect();
    setMe(null);
    setAuthed(false);
    setBootstrapped(false);
    if (mountedRef.current) {
      toast.show(authSessionExpiredMessage(), 'error');
    }
  }, [reset, toast]);

  const handleAuthenticated = React.useCallback(() => {
    authInvalidatedRef.current = false;
    setAuthed(true);
  }, []);

  const failedTaskSignature = React.useMemo(() => {
    const failedIds = tasks
      .filter((task) => task.status === 'failed')
      .map((task) => task.taskId)
      .sort();
    return failedIds.join('|');
  }, [tasks]);

  React.useEffect(() => {
    if (!authed) return;
    void refreshFailedCount();
  }, [authed, failedTaskSignature, refreshFailedCount]);

  // Bootstrap. Runs once when `authed` flips true. Identical to the
  // pre-refactor flow inside WorkbenchApp but lifted up — every authed
  // route now boots from the same effect.
  React.useEffect(() => {
    if (!authed) return;
    let done = false;
    let authInvalidated = false;
    const finish = (): void => {
      if (!mountedRef.current || authInvalidated) return;
      if (!done) {
        done = true;
        setBootstrapped(true);
      }
    };

    const urlTaskParam = new URLSearchParams(location.search).get('task');
    const stateNewTask =
      (location.state as { newTask?: boolean } | null)?.newTask === true;

    if (stateNewTask) {
      enterNewTaskMode();
    } else if (urlTaskParam) {
      selectTask(urlTaskParam, 'url');
    }

    const listFuture = refreshTaskList();
    const meFuture = trpc.auth.me.query().then(
      (res) => {
        if (!mountedRef.current || authInvalidated) return;
        setMe(normalizeAuthMeProfile(res));
      },
      (err) => {
        if (!mountedRef.current) return;
        if (isAuthSessionError(err)) {
          authInvalidated = true;
          invalidateAuthSession();
        }
      },
    );
    void refreshFailedCount();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, invalidateAuthSession]);

  // URL → store: deep-link / browser back-forward. The URL is the
  // source of truth — if `?task=xxx` is present, sync it. Only the
  // bare `/` (no taskParam) in new-task mode is skipped, so visiting
  // a deep link while composer is in new-task mode doesn't get
  // silently dropped.
  //
  // Race guard (Sweep P1 fix): `lastSelectedRef` tracks the
  // most-recently-cleared task id. If composerMode='new' AND taskParam
  // still equals what we just cleared, that's the React commit
  // window between zustand.set and storeNavigate(null) — re-selecting
  // would undo enterNewTaskMode. Bail in that window. A genuine deep
  // link click on a DIFFERENT task id still wins (taskParam !== last
  // cleared).
  const taskParam = searchParams.get('task');
  const lastSelectedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!bootstrapped) return;
    if (!taskParam && composerMode === 'new') return;
    if (
      taskParam &&
      composerMode === 'new' &&
      taskParam === lastSelectedRef.current
    ) {
      return;
    }
    if (taskParam && taskParam !== selectedTaskId) {
      selectTask(taskParam, 'url');
    }
  }, [bootstrapped, composerMode, taskParam, selectedTaskId, selectTask]);
  React.useEffect(() => {
    if (selectedTaskId) lastSelectedRef.current = selectedTaskId;
  }, [selectedTaskId]);

  // New-task handoff. When a sub-page (e.g. Sidebar "新任务" from
  // /scheduled) navigates back with `state.newTask`, the bootstrap
  // effect doesn't re-run — so the old selectedTask would linger.
  // Catch it here on every location change, drop the selection, and
  // clear the state so a refresh doesn't re-fire. Preserve composer
  // handoffs (attachFile / skillTaskDraft) since sub-pages use the
  // same location.state pathway to seed the new-task composer.
  React.useEffect(() => {
    if (!bootstrapped) return;
    const state = location.state as
      | { newTask?: boolean; attachFile?: unknown; skillTaskDraft?: unknown }
      | null;
    if (!state?.newTask) return;
    enterNewTaskMode();
    const nextState: { attachFile?: unknown; skillTaskDraft?: unknown } = {};
    if (state.attachFile) nextState.attachFile = state.attachFile;
    if (state.skillTaskDraft) nextState.skillTaskDraft = state.skillTaskDraft;
    navigate(location.pathname + location.search, {
      replace: true,
      state: Object.keys(nextState).length > 0 ? nextState : null,
    });
  }, [
    bootstrapped,
    location.pathname,
    location.search,
    location.state,
    enterNewTaskMode,
    navigate,
  ]);

  // Store → URL injection. Lets the store actions write the URL
  // directly after a select / new / create, instead of relying on a
  // chained effect (which used to loop). Preserves other query params.
  const navigateToTask = React.useCallback(
    (taskId: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (taskId) next.set('task', taskId);
      else next.delete('task');
      const search = next.toString() ? `?${next.toString()}` : '';
      navigate({ pathname: location.pathname, search }, { replace: true });
    },
    [navigate, searchParams, location.pathname],
  );
  React.useEffect(() => {
    setStoreNavigate(navigateToTask);
    return () => setStoreNavigate(null);
  }, [navigateToTask]);

  // Auth invalidated by server (bad / expired token).
  React.useEffect(() => {
    if (wsStatus === 'unauthorized' && authed) {
      invalidateAuthSession();
    }
  }, [wsStatus, authed, invalidateAuthSession]);

  // WS reconnect / disconnect toasts.
  //
  // BOSS feedback: the "任务连接已恢复" toast was firing on initial
  // page load (the WS goes idle → connecting → open, and the old
  // guard `prev !== 'idle'` skipped only the very first frame —
  // first-paint reconnections still triggered). Now gated on a
  // ref that flips true ONLY when we've seen a real disconnect
  // (prev='open' → 'closed' or 'connecting'). On initial open the
  // ref stays false, so no toast.
  const prevWsRef = React.useRef<ConnStatus>('idle');
  const hadDisconnectRef = React.useRef(false);
  React.useEffect(() => {
    const prev = prevWsRef.current;
    prevWsRef.current = wsStatus;
    const next = realtimeConnectionTransition({
      previousStatus: prev,
      nextStatus: wsStatus,
      hadDisconnect: hadDisconnectRef.current,
      authed,
    });
    hadDisconnectRef.current = next.hadDisconnect;
    if (next.toast) {
      toast.show(next.toast.message, next.toast.tone, next.toast.durationMs);
    }
  }, [wsStatus, authed, toast]);

  // Online / offline toasts.
  const onlineRef = React.useRef(online);
  React.useEffect(() => {
    const applyOnline = (nextOnline: boolean): void => {
      const toastCopy = networkTransitionToast(onlineRef.current, nextOnline);
      onlineRef.current = nextOnline;
      setOnline(nextOnline);
      if (toastCopy) {
        toast.show(toastCopy.message, toastCopy.tone);
      }
    };
    const onOffline = (): void => {
      applyOnline(false);
    };
    const onOnline = (): void => {
      applyOnline(true);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [toast]);

  // Store-level error toasts (failed list / create / delete).
  const lastErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (storeError && storeError !== lastErrorRef.current) {
      lastErrorRef.current = storeError;
      toast.show(storeError, 'error');
    }
    if (!storeError) lastErrorRef.current = null;
  }, [storeError, toast]);

  // Shell-level keyboard shortcuts. Cmd+K opens search, Cmd+N starts a
  // new task at /, Escape closes whichever shell-owned modal is on top.
  // Workbench-specific Esc routing (panel fullscreen, browser sheet)
  // stays in WorkbenchApp and reads the same global flags.
  React.useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        enterNewTaskMode();
        if (location.pathname !== '/') navigate('/', { state: { newTask: true } });
        return;
      }
      if (e.key === 'Escape' && !inField) {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (feedbackOpen) {
          setFeedbackOpen(false);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    authed,
    searchOpen,
    feedbackOpen,
    enterNewTaskMode,
    location.pathname,
    navigate,
  ]);

  const handleLogout = React.useCallback(() => {
    clearAccessToken();
    disconnect();
    reset();
    setMe(null);
    setAuthed(false);
    setBootstrapped(false);
  }, [reset]);

  // Project filter chip — driven by ?project= in URL, surfaced in
  // sidebar header so the user knows the task list is scoped.
  const projectFilter = searchParams.get('project');
  const activeProject = React.useMemo(
    () => projects.find((p) => p.projectId === projectFilter) ?? null,
    [projects, projectFilter],
  );

  // Retention slice — same as the workbench used to compute, but
  // centralised here so the Sidebar shows the same hidden-count on
  // every route. Pinned + selected tasks bypass retention.
  const planForRetention: PlanId =
    me?.plan === 'basic' || me?.plan === 'pro' ? me.plan : 'free';
  const historyDays = PLAN_CATALOGUE[planForRetention].historyDays;
  // Pinned + currently-selected tasks bypass retention. Pin state
  // now lives in the server-backed `starred` flag on each row, so we
  // derive the set straight from `tasks` instead of a separate
  // localStorage cache.
  const retentionPinned = React.useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.starred) set.add(t.taskId);
    }
    if (selectedTaskId) set.add(selectedTaskId);
    return set;
  }, [tasks, selectedTaskId]);
  const { visible: visibleTasks, hiddenCount: hiddenByRetentionCount } =
    React.useMemo(
      () => applyHistoryRetention(tasks, historyDays, retentionPinned),
      [tasks, historyDays, retentionPinned],
    );

  // Project-scoped task list. Only fetched when the URL pins a
  // project — sub-pages don't trigger this.
  const [projectTaskFilter, setProjectTaskFilter] =
    React.useState<ProjectTaskFilterState | null>(null);
  React.useEffect(() => {
    if (!projectFilter) {
      setProjectTaskFilter(null);
      return;
    }
    let cancelled = false;
    const requestId = projectFilterRequestRef.current + 1;
    projectFilterRequestRef.current = requestId;
    setProjectTaskFilter((prev) =>
      refreshProjectTaskFilterState(prev, projectFilter),
    );
    void trpc.tasks.list
      .query({ projectId: projectFilter, limit: 50 })
      .then((res) => {
        if (
          cancelled ||
          !mountedRef.current ||
          projectFilterRequestRef.current !== requestId
        ) {
          return;
        }
        const fresh: UiTask[] = normalizeTaskListRows(res?.tasks);
        setProjectTaskFilter(projectTaskFilterFirstPage({
          projectId: projectFilter,
          tasks: fresh,
          nextCursor: normalizeTaskListCursor(
            (res as { nextCursor?: unknown } | null)?.nextCursor,
          ),
        }));
      })
      .catch((err) => {
        if (
          cancelled ||
          !mountedRef.current ||
          projectFilterRequestRef.current !== requestId
        ) {
          return;
        }
        const msg = pageErrorMessage(err);
        setProjectTaskFilter((prev) =>
          prev?.projectId === projectFilter
            ? { ...prev, loading: false, error: msg }
            : prev,
        );
        toast.show(taskActionError('项目任务暂时无法加载', msg), 'error');
      });
    return () => {
      cancelled = true;
      projectFilterRequestRef.current += 1;
    };
  }, [projectFilter, toast]);

  const filteredTasks = resolveProjectFilteredTasks(
    projectFilter,
    projectTaskFilter,
    visibleTasks,
  );
  const projectFilterChip = projectFilterChipState({
    projectId: projectFilter,
    projectName: activeProject?.name,
    state: projectTaskFilter,
  });
  const loadMoreProjectTasks = React.useCallback(() => {
    const current = projectTaskFilter;
    if (
      !projectFilter ||
      !current ||
      current.projectId !== projectFilter ||
      current.loadingMore ||
      !current.hasMore ||
      current.nextCursor === null
    ) {
      return;
    }
    const cursor = current.nextCursor;
    const requestId = projectLoadMoreRequestRef.current + 1;
    projectLoadMoreRequestRef.current = requestId;
    setProjectTaskFilter((prev) => projectTaskFilterStartLoadMore(prev, projectFilter));
    void trpc.tasks.list
      .query({ projectId: projectFilter, limit: 50, cursor })
      .then((res) => {
        if (
          !mountedRef.current ||
          projectLoadMoreRequestRef.current !== requestId
        ) {
          return;
        }
        const fresh = normalizeTaskListRows(res?.tasks);
        setProjectTaskFilter((prev) =>
          projectTaskFilterAppendPage(prev, {
            projectId: projectFilter,
            tasks: fresh,
            nextCursor: normalizeTaskListCursor(
              (res as { nextCursor?: unknown } | null)?.nextCursor,
            ),
          }),
        );
      })
      .catch((err) => {
        if (
          !mountedRef.current ||
          projectLoadMoreRequestRef.current !== requestId
        ) {
          return;
        }
        const msg = pageErrorMessage(err);
        setProjectTaskFilter((prev) =>
          projectTaskFilterLoadMoreFailed(prev, {
            projectId: projectFilter,
            error: msg,
          }),
        );
        toast.show(taskActionError('更多项目任务暂时无法加载', msg), 'error');
      });
  }, [projectFilter, projectTaskFilter, toast]);
  const projectPagerOverride = React.useMemo(() => {
    if (!projectFilter || projectTaskFilter?.projectId !== projectFilter) {
      return undefined;
    }
    return {
      hasMore: projectTaskFilter.hasMore,
      loadingMore: projectTaskFilter.loadingMore,
      onLoadMore: loadMoreProjectTasks,
    };
  }, [loadMoreProjectTasks, projectFilter, projectTaskFilter]);

  if (!authed) {
    return <LoginGate onAuthenticated={handleAuthenticated} />;
  }
  if (!bootstrapped) return <AppSkeleton />;

  const displayName = preferredAuthDisplayName(me);
  const ctx: OutletContext = {
    me,
    refreshProjects,
    projects,
  };

  return (
    <SidebarProvider
      defaultOpen={true}
      style={
        {
          '--sidebar-width': '260px',
          '--sidebar-width-icon': '56px',
        } as React.CSSProperties
      }
    >
      <Sidebar
        tasks={filteredTasks}
        hiddenTaskCount={projectFilter ? 0 : hiddenByRetentionCount}
        historyDays={historyDays}
        projectFilter={
          projectFilterChip
        }
        onClearProjectFilter={() => navigate('/')}
        pagerOverride={projectPagerOverride}
        selectedTaskId={selectedTaskId}
        onSelectTask={(taskId) => {
          if (location.pathname !== '/') {
            navigate(`/?task=${encodeURIComponent(taskId)}`);
            return;
          }
          if (taskId) selectTask(taskId, 'ui');
          else enterNewTaskMode();
        }}
        onNewTask={() => {
          // Sub-page: route to / + state.newTask=true so the handoff
          // effect catches it after the location change.
          if (location.pathname !== '/') {
            navigate('/', { state: { newTask: true } });
            return;
          }
          // Already on /. Strip any ?task= / ?project= synchronously
          // BEFORE flipping store state. Otherwise the URL inbound
          // effect races: it can fire with taskParam still set and
          // composerMode='new' + selectedTaskId=null, hitting the
          // second branch ("taskParam !== selectedTaskId → select")
          // and re-selecting the task we just cleared.
          if (location.search) {
            navigate('/', { replace: true });
          }
          enterNewTaskMode();
        }}
        onDeleteTask={(taskId) => setConfirmDelete(taskId)}
        onDeleteTasks={(taskIds) => {
          if (taskIds.length === 0) return;
          setConfirmBulkDelete(taskIds);
        }}
        onRetryTask={async (intent) => {
          const res = await createTask(intent);
          if (!mountedRef.current) return;
          if ('error' in res) {
            toast.show(taskActionError('重新执行失败', res.error), 'error');
          } else if (location.pathname !== '/') {
            navigate('/');
          }
        }}
        onRenameTask={async (taskId, title) => {
          const res = await renameTask(taskId, title);
          if (!mountedRef.current) return;
          if ('error' in res) toast.show(pageActionError('重命名失败', res.error), 'error');
        }}
        projects={projects}
        onMoveTaskToProject={async (taskId, projectId) => {
          const res = await moveTaskToProject(taskId, projectId);
          if (!mountedRef.current) return;
          if ('error' in res) {
            toast.show(taskActionError('移动失败', res.error), 'error');
            return;
          }
          setProjectTaskFilter((prev) =>
            projectTaskFilterAfterTaskMove(prev, { taskId, projectId }),
          );
          void refreshProjects();
        }}
        onCreateProject={() => navigate('/projects?create=1')}
        userEmail={me?.email ?? null}
        userDisplayName={displayName}
        userPlan={me?.plan ?? 'free'}
        userRole={me?.role ?? 'user'}
        videoEnabled={me?.videoEnabled ?? false}
        onLogout={handleLogout}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        failedTaskCount={serverFailedCount}
        onClearFailedTasks={() => setConfirmClearFailed(true)}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      {/* SidebarInset bounds the page to the viewport AND owns its
          own scroll. Two reasons:
            1. WorkbenchApp's composer must stay pinned to the
               viewport bottom even on short windows (BOSS bug — at
               500–600px the composer was being pushed below the
               fold because body scrolled instead).
            2. `position: sticky` descendants (calendar header band,
               admin layouts) need a scrolling ancestor. `h-svh
               overflow-y-auto` makes SidebarInset that ancestor;
               sticky offsets resolve against it.
          Pages that need internal scroll still get it via their own
          flex-1 + overflow-y-auto blocks (WorkbenchApp, scheduled
          calendar). */}
      <SidebarInset className="h-svh overflow-y-auto bg-background">
        <Outlet context={ctx} />
      </SidebarInset>
      <MobileNotificationBellSlot />

      <SearchOverlay
        open={searchOpen}
        tasks={tasks}
        onClose={() => setSearchOpen(false)}
        onPick={(taskId) => {
          setSearchOpen(false);
          if (location.pathname !== '/') {
            navigate(`/?task=${encodeURIComponent(taskId)}`);
            return;
          }
          const pickedTask = tasks.find((task) => task.taskId === taskId);
          if (
            shouldKeepProjectFilterForPickedTask({
              currentProjectId: projectFilter,
              taskProjectId: pickedTask?.projectId,
            })
          ) {
            selectTask(taskId, 'ui');
            return;
          }
          const next = new URLSearchParams(searchParams);
          next.delete('project');
          next.set('task', taskId);
          navigate(
            {
              pathname: '/',
              search: next.toString() ? `?${next.toString()}` : '',
            },
            { replace: true },
          );
          selectTask(taskId, 'url');
        }}
      />

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSubmit={async (message) => {
          try {
            const ctxStr = selectedTaskId ? `task_id=${selectedTaskId}` : undefined;
            await trpc.feedback.submit.mutate(
              ctxStr ? { message, context: ctxStr } : { message },
            );
            return { ok: true as const };
          } catch (err) {
            const msg = pageErrorMessage(err);
            toast.show(pageActionError('反馈发送失败', err), 'error');
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
          if (!mountedRef.current) return;
          if ('error' in res) toast.show(pageActionError('删除失败', res.error), 'error');
          else {
            setProjectTaskFilter((prev) =>
              projectTaskFilterAfterTaskDelete(prev, [taskId]),
            );
            toast.show('任务已删除');
            refreshDeletionDependentMeta();
          }
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
          const results = await Promise.all(
            ids.map((id) =>
              deleteTask(id).then(
                (result) => ({ id, result }),
                (err) => ({
                  id,
                  result: {
                    error: pageErrorMessage(err),
                  },
                }),
              ),
            ),
          );
          if (!mountedRef.current) return;
          const deletedIds = results
            .filter((entry) => !('error' in entry.result))
            .map((entry) => entry.id);
          const errs = results.filter(
            (entry): entry is { id: string; result: { error: string } } =>
              'error' in entry.result,
          );
          if (deletedIds.length > 0) {
            setProjectTaskFilter((prev) =>
              projectTaskFilterAfterTaskDelete(prev, deletedIds),
            );
          }
          if (errs.length === 0) toast.show(`已删除 ${ids.length} 个任务`);
          else if (errs.length === ids.length)
            toast.show(taskActionError('删除失败', errs[0]?.result.error), 'error');
          else
            toast.show(
              `已删除 ${ids.length - errs.length} 个，${errs.length} 个失败`,
              'error',
            );
          refreshDeletionDependentMeta();
        }}
      />

      <ConfirmDialog
        open={confirmClearFailed}
        title="清除所有失败任务？"
        description={`将清除 ${serverFailedCount} 个失败任务，此操作不可恢复。\n进行中的任务不受影响。`}
        confirmLabel={`清除 ${serverFailedCount} 个`}
        destructive
        onClose={() => setConfirmClearFailed(false)}
        onConfirm={async () => {
          setConfirmClearFailed(false);
          try {
            const res = await trpc.tasks.clearFailed.mutate();
            if (!mountedRef.current) return;
            const deleted = normalizeTaskActionCount(
              (res as { deleted?: unknown } | null)?.deleted,
            );
            if (deleted > 0) {
              setProjectTaskFilter(projectTaskFilterAfterFailedTasksCleared);
              toast.show(`已清除 ${deleted} 个失败任务`);
            } else {
              toast.show('没有可清除的失败任务');
            }
            const active = tasks.find((t) => t.taskId === selectedTaskId);
            if (active?.status === 'failed') {
              enterNewTaskMode();
            }
            void refreshTaskList();
            refreshDeletionDependentMeta();
          } catch (err) {
            if (!mountedRef.current) return;
            toast.show(pageActionError('清除失败', err), 'error');
          }
        }}
      />

      {!online && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex justify-center px-3 sm:bottom-4"
        >
          <div className="inline-flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-[8px] border border-[#EA1F59]/20 bg-white/90 px-3 py-2 text-[12px] font-medium text-[#595757] shadow-[0_12px_30px_rgba(89,87,87,0.12)] backdrop-blur dark:border-[#EA1F59]/35 dark:bg-card/90 dark:text-foreground/85">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#EA1F59]/10 text-[#EA1F59]">
              <WifiOff className="h-3 w-3" aria-hidden />
            </span>
            <span className="truncate">当前离线，暂时无法创建新任务</span>
          </div>
        </div>
      )}
    </SidebarProvider>
  );
}

function MobileNotificationBellSlot(): JSX.Element | null {
  const { isMobile, openMobile } = useSidebar();
  if (!isMobile || openMobile) return null;
  return (
    <div className="fixed right-3 top-1.5 z-40 md:hidden">
      <NotificationBell placement="mobile-header" />
    </div>
  );
}

/**
 * Convenience hook for children rendered through `<Outlet />`. Returns
 * the shell's `me` + `projects` so a sub-page doesn't have to repeat
 * auth.me / projects.list itself.
 */
export function useAppShellContext(): OutletContext {
  return useOutletContext<OutletContext>();
}

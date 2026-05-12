import * as React from 'react';
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
import { SearchOverlay } from '@/components/SearchOverlay';
import { SettingsModal } from '@/components/SettingsModal';
import { Sidebar } from '@/components/Sidebar';
import { AppSkeleton } from '@/components/Skeleton';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useToast } from '@/components/ui/toast';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import {
  connect,
  disconnect,
  onServerMessage,
  onStatus,
  type ConnStatus,
} from '@/lib/ws';
import { setStoreNavigate, toUiTask, useTaskStore } from '@/stores/task-store';
import type { UiProject, UiTask } from '@/types/task';
import { applyHistoryRetention } from '@/utils/time-buckets';
import { PLAN_CATALOGUE, type PlanId } from '@holaday/shared-types';

interface MeProfile {
  userId: string;
  email: string | null;
  phone?: string | null;
  displayName: string | null;
  plan: string;
  multiUser: boolean;
  selectedRoles?: string[];
}

interface OutletContext {
  me: MeProfile | null;
  refreshProjects(): void;
  projects: readonly UiProject[];
}

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
 *   - shared modals: SearchOverlay, FeedbackDialog, SettingsModal,
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
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState<
    string[] | null
  >(null);
  const [confirmClearFailed, setConfirmClearFailed] = React.useState(false);

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
  const toggleStarred = useTaskStore((s) => s.toggleStarred);
  const moveTaskToProject = useTaskStore((s) => s.moveTaskToProject);
  const applyServerMessage = useTaskStore((s) => s.applyServerMessage);
  const pinnedIds = useTaskStore((s) => s.pinnedTaskIds);
  const storeError = useTaskStore((s) => s.error);
  const reset = useTaskStore((s) => s.reset);

  // Refresh projects on demand (used after move-to-project).
  const refreshProjects = React.useCallback(async () => {
    try {
      const list = await trpc.projects.list.query();
      setProjects(list as UiProject[]);
    } catch {
      /* silent */
    }
  }, []);

  // Bootstrap. Runs once when `authed` flips true. Identical to the
  // pre-refactor flow inside WorkbenchApp but lifted up — every authed
  // route now boots from the same effect.
  React.useEffect(() => {
    if (!authed) return;
    let done = false;
    const finish = (): void => {
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
        setMe({
          userId: res.userId,
          email: res.email,
          displayName: res.displayName,
          plan: res.plan,
          multiUser: Boolean((res as { multiUser?: boolean }).multiUser),
          selectedRoles:
            (res as { selectedRoles?: string[] }).selectedRoles ?? [],
        });
      },
      () => {
        /* silent — auth.me failure isn't fatal. */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // URL → store: deep-link / browser back-forward. The URL is the
  // source of truth — if `?task=xxx` is present, sync it. Only the
  // bare `/` (no taskParam) in new-task mode is skipped, so visiting
  // a deep link while composer is in new-task mode doesn't get
  // silently dropped.
  const taskParam = searchParams.get('task');
  React.useEffect(() => {
    if (!bootstrapped) return;
    if (!taskParam && composerMode === 'new') return;
    if (taskParam && taskParam !== selectedTaskId) {
      selectTask(taskParam, 'url');
    }
  }, [bootstrapped, composerMode, taskParam, selectedTaskId, selectTask]);

  // New-task handoff. When a sub-page (e.g. Sidebar "新任务" from
  // /scheduled) navigates back with `state.newTask`, the bootstrap
  // effect doesn't re-run — so the old selectedTask would linger.
  // Catch it here on every location change, drop the selection, and
  // clear the state so a refresh doesn't re-fire. Preserve attachFile
  // since FilesPage uses the same state.location pathway to hand off
  // a file into the composer.
  React.useEffect(() => {
    if (!bootstrapped) return;
    const state = location.state as
      | { newTask?: boolean; attachFile?: unknown }
      | null;
    if (!state?.newTask) return;
    enterNewTaskMode();
    navigate(location.pathname + location.search, {
      replace: true,
      state: state.attachFile ? { attachFile: state.attachFile } : null,
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
      clearAccessToken();
      reset();
      disconnect();
      setMe(null);
      setAuthed(false);
      setBootstrapped(false);
    }
  }, [wsStatus, authed, reset]);

  // WS reconnect / disconnect toasts.
  const prevWsRef = React.useRef<ConnStatus>('idle');
  React.useEffect(() => {
    const prev = prevWsRef.current;
    prevWsRef.current = wsStatus;
    if (!authed) return;
    if (
      prev === 'open' &&
      (wsStatus === 'closed' || wsStatus === 'connecting')
    ) {
      toast.show('实时连接已断开，正在重连…', 'error');
    }
    if (prev !== 'open' && wsStatus === 'open' && prev !== 'idle') {
      toast.show('实时连接已恢复');
    }
  }, [wsStatus, authed, toast]);

  // Online / offline toasts.
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

  // Project-scoped task list. Only fetched when the URL pins a
  // project — sub-pages don't trigger this.
  const [projectTasks, setProjectTasks] = React.useState<UiTask[] | null>(null);
  React.useEffect(() => {
    if (!projectFilter) {
      setProjectTasks(null);
      return;
    }
    let cancelled = false;
    void trpc.tasks.list
      .query({ projectId: projectFilter, limit: 50 })
      .then((res) => {
        if (cancelled) return;
        const fresh: UiTask[] = (res?.tasks ?? []).map((t) => toUiTask(t));
        setProjectTasks(fresh);
      });
    return () => {
      cancelled = true;
    };
  }, [projectFilter]);

  const filteredTasks = projectFilter ? (projectTasks ?? []) : visibleTasks;

  if (!authed) {
    return <LoginGate onAuthenticated={() => setAuthed(true)} />;
  }
  if (!bootstrapped) return <AppSkeleton />;

  const displayName = preferredDisplayName(me);
  const ctx: OutletContext = {
    me,
    refreshProjects: () => {
      void refreshProjects();
    },
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
          activeProject
            ? { projectId: activeProject.projectId, name: activeProject.name }
            : null
        }
        onClearProjectFilter={() => navigate('/')}
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
          if (location.pathname !== '/') {
            navigate('/', { state: { newTask: true } });
          } else {
            enterNewTaskMode();
          }
        }}
        onDeleteTask={(taskId) => setConfirmDelete(taskId)}
        onDeleteTasks={(taskIds) => {
          if (taskIds.length === 0) return;
          setConfirmBulkDelete(taskIds);
        }}
        onRetryTask={async (intent) => {
          const res = await createTask(intent);
          if ('error' in res) {
            toast.show(`重试失败：${res.error}`, 'error');
          } else if (location.pathname !== '/') {
            navigate('/');
          }
        }}
        onRenameTask={async (taskId, title) => {
          const res = await renameTask(taskId, title);
          if ('error' in res) toast.show(`重命名失败：${res.error}`, 'error');
        }}
        onToggleStarred={(taskId) => void toggleStarred(taskId)}
        projects={projects}
        onMoveTaskToProject={async (taskId, projectId) => {
          await moveTaskToProject(taskId, projectId);
          void refreshProjects();
        }}
        onCreateProject={() => navigate('/projects?create=1')}
        userEmail={me?.email ?? null}
        userDisplayName={displayName}
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
      <SidebarInset className="overflow-hidden bg-background">
        <Outlet context={ctx} />
      </SidebarInset>

      <SearchOverlay
        open={searchOpen}
        tasks={tasks}
        onClose={() => setSearchOpen(false)}
        onPick={(taskId) => {
          setSearchOpen(false);
          if (location.pathname !== '/') {
            navigate(`/?task=${encodeURIComponent(taskId)}`);
          } else {
            selectTask(taskId, 'ui');
          }
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
            const msg = err instanceof Error ? err.message : String(err);
            toast.show(`反馈发送失败：${msg}`, 'error');
            return { error: msg };
          }
        }}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        displayName={displayName}
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
          const results = await Promise.all(
            ids.map((id) =>
              deleteTask(id).then(
                (r) => r,
                (err) => ({
                  error: err instanceof Error ? err.message : String(err),
                }),
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
          const results = await Promise.all(
            failed.map((t) =>
              deleteTask(t.taskId).then(
                (r) => r,
                (err) => ({
                  error: err instanceof Error ? err.message : String(err),
                }),
              ),
            ),
          );
          const errs = results.filter(
            (r): r is { error: string } => 'error' in r,
          );
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
    </SidebarProvider>
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

function preferredDisplayName(me: MeProfile | null): string {
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

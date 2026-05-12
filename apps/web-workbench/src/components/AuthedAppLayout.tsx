import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FeedbackDialog } from '@/components/FeedbackDialog';
import { SearchOverlay } from '@/components/SearchOverlay';
import { SettingsModal } from '@/components/SettingsModal';
import { Sidebar } from '@/components/Sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useToast } from '@/components/ui/toast';
import { clearAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import {
  connect,
  disconnect,
  onServerMessage,
  onStatus,
  type ConnStatus,
} from '@/lib/ws';
import { useTaskStore } from '@/stores/task-store';
import type { UiProject } from '@/types/task';

interface MeProfile {
  userId: string;
  email: string | null;
  phone?: string | null;
  displayName: string | null;
  plan: string;
}

/**
 * Unified application shell for every authed route. Renders the same
 * Sidebar that the workbench uses (full task list + features +
 * quota + user menu) so sub-pages (`/scheduled`, `/batch`, `/files`,
 * …) live inside the same workspace surface instead of behind a
 * separate slim icon-rail.
 *
 * The shell owns its own bootstrap because a deep-link directly to
 * `/scheduled` should still load the task store + connect WS, even
 * if the user never visited `/`. `connect()` is idempotent — when
 * the user navigates `/ → /scheduled` and WorkbenchApp's bootstrap
 * already opened the socket, this no-ops.
 *
 * Sub-page-scoped modals (search / feedback / settings, plus the
 * task-delete confirm wired through the sidebar's right-click menu)
 * live here too so the navigation surface is the same on every
 * route. Workbench-specific dialogs (rebuild task / bulk clear /
 * batch delete from the task list) stay on WorkbenchApp because
 * they're tied to the inner workbench reply flow.
 */
export function AuthedAppLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();

  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const createTask = useTaskStore((s) => s.createTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const renameTask = useTaskStore((s) => s.renameTask);
  const toggleStarred = useTaskStore((s) => s.toggleStarred);
  const moveTaskToProject = useTaskStore((s) => s.moveTaskToProject);
  const applyServerMessage = useTaskStore((s) => s.applyServerMessage);
  const reset = useTaskStore((s) => s.reset);

  const [me, setMe] = React.useState<MeProfile | null>(null);
  const [projects, setProjects] = React.useState<UiProject[]>([]);
  const [, setWsStatus] = React.useState<ConnStatus>('idle');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState<
    string[] | null
  >(null);

  // One-shot bootstrap on mount. Connect the WS (idempotent), fetch
  // auth.me, prime the task list if the store is empty (deep-link).
  React.useEffect(() => {
    connect();
    const offMsg = onServerMessage(applyServerMessage);
    const offStatus = onStatus(setWsStatus);
    void trpc.auth.me.query().then(
      (res) =>
        setMe({
          userId: res.userId,
          email: res.email,
          displayName: res.displayName,
          plan: res.plan,
        }),
      () => {
        /* silent — sidebar still renders without `me` */
      },
    );
    void trpc.projects.list.query().then(
      (list) => setProjects(list as UiProject[]),
      () => {
        /* silent */
      },
    );
    // Always refresh — the store's refreshTaskList replaces the list
    // in-place, so a quick double-fetch when navigating /→/scheduled
    // is just a single extra round trip + the latest snapshot wins.
    void refreshTaskList();
    return () => {
      offMsg();
      offStatus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshProjects = React.useCallback(async () => {
    try {
      const list = await trpc.projects.list.query();
      setProjects(list as UiProject[]);
    } catch {
      /* silent */
    }
  }, []);

  const handleLogout = React.useCallback(() => {
    clearAccessToken();
    disconnect();
    reset();
    setMe(null);
    navigate('/');
  }, [navigate, reset]);

  const displayName = preferredDisplayName(me);

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={(taskId) => {
          navigate(`/?task=${encodeURIComponent(taskId)}`);
        }}
        onNewTask={() => {
          navigate('/', { state: { newTask: true } });
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
          } else {
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
      />
      <SidebarInset className="bg-background overflow-auto">
        {children}
      </SidebarInset>

      <SearchOverlay
        open={searchOpen}
        tasks={tasks}
        onClose={() => setSearchOpen(false)}
        onPick={(taskId) => {
          setSearchOpen(false);
          navigate(`/?task=${encodeURIComponent(taskId)}`);
        }}
      />

      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSubmit={async (message) => {
          try {
            await trpc.feedback.submit.mutate({ message });
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
          if (errs.length === 0) {
            toast.show(`已删除 ${ids.length} 个任务`);
          } else if (errs.length === ids.length) {
            toast.show(`删除失败：${errs[0]?.error ?? 'unknown'}`, 'error');
          } else {
            toast.show(
              `已删除 ${ids.length - errs.length} 个，${errs.length} 个失败`,
              'error',
            );
          }
        }}
      />
    </SidebarProvider>
  );
}

// Avoid leaking masked SMS phone numbers into the sidebar greeting.
// Mirrors the workbench's preferredDisplayName — kept here so this
// shell doesn't reach into WorkbenchApp internals.
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


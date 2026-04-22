import * as React from 'react';
import { BrowserPanel } from '@/components/BrowserPanel';
import { LoginGate } from '@/components/LoginGate';
import { MainPanel } from '@/components/MainPanel';
import { Sidebar } from '@/components/Sidebar';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { type ConnStatus, connect, disconnect, onServerMessage, onStatus } from '@/lib/ws';
import { useTaskStore } from '@/stores/task-store';

interface MeProfile {
  userId: string;
  email: string;
  displayName: string | null;
  plan: string;
}

/**
 * App shell. Gates on the access token: missing → LoginGate, present
 * → the three-column workbench wired to the live task store.
 *
 * On authenticate we kick off tRPC + WS in parallel and resolve the
 * caller's profile (auth.me) so the sidebar can show the real email
 * instead of hardcoding "Yalei · Free". A 4401 close from the WS
 * means the stored token is bad; we clear it and bounce back to the
 * login gate. Normal disconnects (reconnecting) don't touch auth.
 */
export function App(): JSX.Element {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

function AppShell(): JSX.Element {
  const [authed, setAuthed] = React.useState<boolean>(() => Boolean(getAccessToken()));
  const [wsStatus, setWsStatus] = React.useState<ConnStatus>('idle');
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [me, setMe] = React.useState<MeProfile | null>(null);
  const toast = useToast();

  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const loading = useTaskStore((s) => s.loading);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const applyServerMessage = useTaskStore((s) => s.applyServerMessage);
  const reset = useTaskStore((s) => s.reset);
  const screencastByTask = useTaskStore((s) => s.screencastByTask);
  const captchaWaitByTask = useTaskStore((s) => s.captchaWaitByTask);
  const storeError = useTaskStore((s) => s.error);

  // Kick off tRPC + WS once authenticated. StrictMode double-mount is
  // safe here: refreshTasks is idempotent, connect() is a no-op when
  // a socket is already open, and the listener unsubscribe cleans up.
  React.useEffect(() => {
    if (!authed) return;
    void refreshTasks();
    void (async () => {
      try {
        const res = await trpc.auth.me.query();
        setMe({
          userId: res.userId,
          email: res.email,
          displayName: res.displayName,
          plan: res.plan,
        });
      } catch {
        // auth.me failure isn't fatal — sidebar falls back to generic
        // labels. The WS unauthorized close will bounce us to login if
        // the token is actually bad.
      }
    })();
    connect();
    const offMsg = onServerMessage(applyServerMessage);
    const offStatus = onStatus(setWsStatus);
    return () => {
      offMsg();
      offStatus();
    };
  }, [authed, refreshTasks, applyServerMessage]);

  // Auth invalidated by server (bad / expired token): flush local state
  // and drop back to the login gate.
  React.useEffect(() => {
    if (wsStatus === 'unauthorized' && authed) {
      clearAccessToken();
      reset();
      disconnect();
      setMe(null);
      setAuthed(false);
    }
  }, [wsStatus, authed, reset]);

  // Surface store-level errors (failed list/create/delete) as toasts.
  const lastErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (storeError && storeError !== lastErrorRef.current) {
      lastErrorRef.current = storeError;
      toast.show(storeError, 'error');
    }
    if (!storeError) lastErrorRef.current = null;
  }, [storeError, toast]);

  const handleLogout = React.useCallback(() => {
    clearAccessToken();
    disconnect();
    reset();
    setMe(null);
    setAuthed(false);
  }, [reset]);

  if (!authed) {
    return <LoginGate onAuthenticated={() => setAuthed(true)} />;
  }

  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;
  const greetingName = me?.displayName || (me?.email ? firstSegment(me.email) : '');

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <Sidebar
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTask}
        onNewTask={() => setSelectedTask(null)}
        onDeleteTask={async (taskId) => {
          const ok = window.confirm('删除这个任务？任务记录和步骤都会清除。');
          if (!ok) return;
          const res = await deleteTask(taskId);
          if ('error' in res) toast.show(`删除失败：${res.error}`, 'error');
          else toast.show('任务已删除');
        }}
        onRetryTask={async (intent) => {
          const res = await createTask(intent);
          if ('error' in res) toast.show(`重试失败：${res.error}`, 'error');
        }}
        userEmail={me?.email ?? null}
        userDisplayName={me?.displayName ?? firstSegment(me?.email ?? '') ?? ''}
        userPlan={me?.plan ?? 'free'}
        onLogout={handleLogout}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      <MainPanel
        task={selectedTask}
        busy={loading}
        greetingName={greetingName || undefined}
        onSubmit={async (intent) => {
          const res = await createTask(intent);
          if ('error' in res) toast.show(`发送失败：${res.error}`, 'error');
        }}
        onOpenSidebar={() => setSidebarOpen(true)}
      />
      <div className="hidden lg:block">
        <BrowserPanel
          frame={selectedTask ? (screencastByTask[selectedTask.taskId] ?? null) : null}
          taskStatus={selectedTask?.status ?? null}
          awaitingUser={
            selectedTask ? Boolean(captchaWaitByTask[selectedTask.taskId]) : false
          }
          activeTaskId={selectedTaskId}
        />
      </div>
    </div>
  );
}

function firstSegment(email: string): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

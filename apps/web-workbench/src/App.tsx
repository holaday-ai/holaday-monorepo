import * as React from 'react';
import { BrowserPanel } from '@/components/BrowserPanel';
import { FeedbackDialog } from '@/components/FeedbackDialog';
import { LoginGate } from '@/components/LoginGate';
import { MainPanel } from '@/components/MainPanel';
import { SearchOverlay } from '@/components/SearchOverlay';
import { Sidebar } from '@/components/Sidebar';
import { AppSkeleton } from '@/components/Skeleton';
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
 * On authenticate we kick off tRPC + WS in parallel, show a skeleton
 * until either the task list + user profile both resolve or 1.5 s
 * elapse (whichever first — avoids a perpetual skeleton if one call
 * is slow). A 4401 close from the WS means the stored token is bad;
 * we clear it and bounce back to the login gate.
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
  const [browserSheetOpen, setBrowserSheetOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [me, setMe] = React.useState<MeProfile | null>(null);
  const [bootstrapped, setBootstrapped] = React.useState(false);
  const [online, setOnline] = React.useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const toast = useToast();
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const loading = useTaskStore((s) => s.loading);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const replyToTask = useTaskStore((s) => s.replyToTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const awaitingUserByTask = useTaskStore((s) => s.awaitingUserByTask);
  const applyServerMessage = useTaskStore((s) => s.applyServerMessage);
  const reset = useTaskStore((s) => s.reset);
  const screencastByTask = useTaskStore((s) => s.screencastByTask);
  const captchaWaitByTask = useTaskStore((s) => s.captchaWaitByTask);
  const storeError = useTaskStore((s) => s.error);

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
  }, [authed, searchOpen, feedbackOpen, browserSheetOpen, selectedTaskId, setSelectedTask]);

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

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <Sidebar
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTask}
        onNewTask={() => {
          setSelectedTask(null);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
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
        onOpenFeedback={() => setFeedbackOpen(true)}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      <MainPanel
        task={selectedTask}
        busy={loading}
        greetingName={greetingName || undefined}
        inputRef={inputRef}
        replyMode={Boolean(selectedTaskId && awaitingUserByTask[selectedTaskId])}
        onSubmit={async (intent) => {
          // Supercar: when the current task is parked on an awaiting_user
          // question, route the composer to tasks.reply so the agent's
          // existing loop resumes. Otherwise spawn a fresh task.
          if (selectedTaskId && awaitingUserByTask[selectedTaskId]) {
            const res = await replyToTask(selectedTaskId, intent);
            if ('error' in res) toast.show(`回复失败：${res.error}`, 'error');
            else if (!res.ok) toast.show('这个任务已经不在等待回复了', 'error');
            return;
          }
          const res = await createTask(intent);
          if ('error' in res) toast.show(`发送失败：${res.error}`, 'error');
        }}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenBrowser={() => setBrowserSheetOpen(true)}
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
      <div className="lg:hidden">
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

import * as React from 'react';
import { BrowserPanel } from '@/components/BrowserPanel';
import { LoginGate } from '@/components/LoginGate';
import { MainPanel } from '@/components/MainPanel';
import { Sidebar } from '@/components/Sidebar';
import { clearAccessToken, getAccessToken } from '@/lib/auth';
import { type ConnStatus, connect, disconnect, onServerMessage, onStatus } from '@/lib/ws';
import { useTaskStore } from '@/stores/task-store';

/**
 * App shell. Gates on the access token: missing → LoginGate, present
 * → the three-column workbench wired to the live task store.
 *
 * On authenticate we kick off both transports in parallel:
 *   - tRPC `tasks.list` via `refreshTasks()` (seeds the sidebar)
 *   - WebSocket `connect()` (streams live events into the store)
 *
 * A 4401 close from the WS means the stored token is bad; we clear it
 * and bounce back to the login gate. Normal disconnects (reconnecting)
 * don't touch the auth state.
 */
export function App(): JSX.Element {
  const [authed, setAuthed] = React.useState<boolean>(() => Boolean(getAccessToken()));
  const [wsStatus, setWsStatus] = React.useState<ConnStatus>('idle');
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const loading = useTaskStore((s) => s.loading);
  const setSelectedTask = useTaskStore((s) => s.setSelectedTask);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const createTask = useTaskStore((s) => s.createTask);
  const applyServerMessage = useTaskStore((s) => s.applyServerMessage);
  const reset = useTaskStore((s) => s.reset);
  const screencastByTask = useTaskStore((s) => s.screencastByTask);
  const captchaWaitByTask = useTaskStore((s) => s.captchaWaitByTask);

  // Kick off tRPC + WS once authenticated. StrictMode double-mount is
  // safe here: refreshTasks is idempotent, connect() is a no-op when
  // a socket is already open, and the listener unsubscribe cleans up.
  React.useEffect(() => {
    if (!authed) return;
    void refreshTasks();
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
      setAuthed(false);
    }
  }, [wsStatus, authed, reset]);

  if (!authed) {
    return <LoginGate onAuthenticated={() => setAuthed(true)} />;
  }

  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <Sidebar
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTask}
        onNewTask={() => setSelectedTask(null)}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      <MainPanel
        task={selectedTask}
        busy={loading}
        onSubmit={async (intent) => {
          await createTask(intent);
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
        />
      </div>
    </div>
  );
}

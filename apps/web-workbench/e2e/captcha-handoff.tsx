// Local fixture only: a real BrowserPanel with the production HTTP/WS input channel.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserPanel } from '../src/components/BrowserPanel';
import { ToastProvider } from '../src/components/ui/toast';
import { useTaskStore } from '../src/stores/task-store';
import '../src/index.css';
const taskId = 'tsk_captcha_e2e';
localStorage.setItem('holaday.access_token', 'local-fixture-only');
function App() {
  const [state, setState] = React.useState({ status: 'executing', waiting: false, calls: 0 });
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => {
    const poll = async () => {
      const next = await fetch('/api/fixture/state').then((r) => r.json());
      setState(next);
      useTaskStore.setState({
        selectedTaskId: taskId,
        tasks: [
          {
            taskId,
            title: 'Local CAPTCHA fixture',
            intent: '读取验证后的公开内容',
            status: next.status,
            tickCount: next.calls,
            createdAt: new Date(),
            executionMode: 'browser',
            ...(next.waiting ? { awaitingKind: 'captcha' as const } : {}),
          },
        ],
      });
    };
    void poll();
    const timer = setInterval(() => void poll(), 250);
    return () => clearInterval(timer);
  }, []);
  return (
    <ToastProvider>
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <output data-testid="fixture-state">{JSON.stringify(state)}</output>
        <div style={{ flex: 1, minHeight: 0 }}>
          <BrowserPanel
            activeTaskId={taskId}
            poolUserId="usr_fixture"
            taskStatus={state.status as never}
            awaitingUser={state.waiting}
            awaitingKind={state.waiting ? 'captcha' : undefined}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((v) => !v)}
          />
        </div>
      </div>
    </ToastProvider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

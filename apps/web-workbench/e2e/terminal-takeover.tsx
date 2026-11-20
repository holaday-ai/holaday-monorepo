// Local fixture only: a real BrowserPanel for an ended task (部分完成) whose browser was released.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserPanel } from '../src/components/BrowserPanel';
import { ToastProvider } from '../src/components/ui/toast';
import { useTaskStore } from '../src/stores/task-store';
import '../src/index.css';
const taskId = 'tsk_terminal_takeover_e2e';
const status = new URLSearchParams(location.search).get('status') ?? 'partial_success';
localStorage.setItem('holaday.access_token', 'local-fixture-only');
useTaskStore.setState({
  selectedTaskId: taskId,
  tasks: [
    {
      taskId,
      title: 'Ended task fixture',
      intent: '打开机型比较页',
      status: status as never,
      tickCount: 3,
      createdAt: new Date(),
      executionMode: 'browser',
      finalUrl: 'https://compare.holaday-fixture.test/iphone/compare',
    },
  ],
});
function App() {
  const [fullscreen, setFullscreen] = React.useState(false);
  return (
    <ToastProvider>
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <BrowserPanel
            activeTaskId={taskId}
            poolUserId="usr_fixture"
            taskStatus={status as never}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((v) => !v)}
          />
        </div>
      </div>
    </ToastProvider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

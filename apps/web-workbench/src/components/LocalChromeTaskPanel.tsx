import { Button } from '@/components/ui/button';
import { awaitingUserCopy, awaitingUserStreamMessage } from '@/lib/awaiting-user-copy';
import { trpc } from '@/lib/trpc';
import { useTaskStore } from '@/stores/task-store';
import type { UiTaskStatus } from '@/types/task';
import { Globe, X } from 'lucide-react';
import * as React from 'react';

export function LocalChromeTaskPanel({
  taskId,
  status,
  onClose,
}: { taskId: string; status?: UiTaskStatus | null; onClose?: () => void }) {
  // REBUILD-4 共同操作: the page is in the person's own Chrome; they can use it at any time and
  // the assistant waits until they are still before it continues. No takeover, no handback.
  // FIX-PR259-2 — a task parked before any Chrome session exists (extension
  // offline / no page selected) shows the same connect-the-extension copy as
  // the task stream instead of the in-session control states.
  const connection = useTaskStore((s) => s.awaitingUserByTask[taskId]?.browserConnection);
  const [stopping, setStopping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const terminal = ['completed', 'failed', 'cancelled', 'timeout', 'partial_success'].includes(
    status ?? '',
  );
  const waitingForExtension = Boolean(connection) && !terminal;
  async function stop() {
    setStopping(true);
    setError(null);
    try {
      const result = await trpc.tasks.abort.mutate({ taskId });
      if (!result.ok) {
        setError('未能确认停止，请重试。');
        setStopping(false);
      }
    } catch {
      setError('未能确认停止，请重试。');
      setStopping(false);
    }
  }
  return (
    <aside
      aria-label="本地 Chrome 任务"
      className="flex h-full min-h-64 flex-col rounded-2xl bg-background/80 p-5 text-foreground"
    >
      <header className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4" />
          Chrome
        </span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭浏览器面板"
            title="关闭浏览器面板"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
        <Globe className="h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-medium">
          {waitingForExtension
            ? awaitingUserCopy('permission', connection).panelTitle
            : '在你的 Chrome 中执行'}
        </h2>
        <p role="status" className="max-w-xs text-sm text-muted-foreground">
          {waitingForExtension
            ? awaitingUserCopy('permission', connection).panelBody
            : terminal
              ? '任务已结束，页面保留在 Chrome。'
              : stopping
                ? '正在停止，等待执行结果确认…'
                : 'AI 正在处理你选择的页面，你也可以直接在 Chrome 里操作。'}
        </p>
        {waitingForExtension ? (
          <p className="max-w-xs text-xs text-muted-foreground">
            {awaitingUserStreamMessage('permission', null, connection).followUp}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="max-w-xs text-xs text-muted-foreground">
            {error}
          </p>
        ) : null}
      </div>
      {!terminal ? (
        <footer className="flex justify-center gap-2">
          <Button
            variant="ghost"
            disabled={stopping}
            onClick={() => {
              void stop();
            }}
          >
            停止任务
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}

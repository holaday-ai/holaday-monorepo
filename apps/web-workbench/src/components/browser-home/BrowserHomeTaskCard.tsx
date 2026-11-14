import { taskListItemSubtitle } from '@/components/TaskListItem';
import { humaniseTaskError } from '@/lib/error-copy';
import { taskStatusLabel } from '@/lib/task-status-copy';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';
import { type UiTask, isActive, isTerminalStatus } from '@/types/task';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import * as React from 'react';

/**
 * BROWSER-HOME-1 step 4 — the task sent from the「云浏览器」floating input, as a small collapsible
 * card above it: the same status words and progress line as the task list while it runs (in the
 * browser right behind it), the answer or the reason when it ends. The page never navigates away;
 * 「在任务里查看」is only an explicit choice.
 */
export function BrowserHomeTaskCard({
  taskId,
  onDismiss,
  onOpenTask,
}: {
  taskId: string;
  onDismiss(): void;
  onOpenTask(taskId: string): void;
}): JSX.Element | null {
  const task = useTaskStore((s) => s.tasks.find((t) => t.taskId === taskId) ?? null);
  const liveSubStatus = useTaskStore((s) => s.subStatusByTask[taskId] ?? null);
  const question = useTaskStore((s) => s.awaitingUserByTask[taskId]?.question ?? null);
  const [expanded, setExpanded] = React.useState(true);
  if (!task) return null;

  // Waiting for the person is not "running": no spinner, the question shows instead.
  const running = isActive(task.status) && task.status !== 'awaiting_user';
  const label = taskStatusLabel(task.status, task.awaitingKind ?? null);
  const progress = taskListItemSubtitle(task, liveSubStatus);
  const body = cardBody(task, question);

  return (
    <section
      aria-label="云浏览器任务"
      data-status={task.status}
      className="pointer-events-auto mb-2 w-full overflow-hidden rounded-[14px] border border-[#E6E7EB] bg-background/95 text-[13px] shadow-[0_6px_24px_rgba(0,0,0,0.08)] backdrop-blur dark:border-white/10"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#FF0061]" aria-hidden />
        ) : (
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              task.status === 'completed' && 'bg-muted-foreground/40',
              (task.status === 'partial_success' || task.status === 'awaiting_user') &&
                'bg-[#FFC910]',
              task.status === 'failed' && 'bg-[#FF0061]',
              task.status === 'cancelled' && 'bg-muted-foreground/25',
            )}
            aria-hidden
          />
        )}
        <span className="shrink-0 font-medium text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={task.intent}>
          {running && progress && progress !== label ? progress : task.intent}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起任务卡片' : '展开任务卡片'}
          className="rounded-[8px] p-1 text-muted-foreground hover:bg-muted"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronUp className="h-4 w-4" aria-hidden />
          )}
        </button>
        {isTerminalStatus(task.status) && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭任务卡片"
            className="rounded-[8px] p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-[#E6E7EB] px-3 py-2 dark:border-white/10">
          {body ? (
            <p
              data-testid="browser-home-task-body"
              className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap break-words text-foreground/90"
            >
              {body}
            </p>
          ) : (
            <p className="text-muted-foreground">助手正在当前页面操作，你可以随时在画面上操作。</p>
          )}
          <button
            type="button"
            onClick={() => onOpenTask(taskId)}
            className="mt-1.5 text-[12px] font-medium text-[#FF0061] hover:underline"
          >
            在任务里查看
          </button>
        </div>
      )}
    </section>
  );
}

function cardBody(task: UiTask, question: string | null): string | null {
  if (task.status === 'awaiting_user') return question ?? task.resultText ?? null;
  if (isActive(task.status)) return null;
  const text = task.resultText?.trim() ?? '';
  if (task.status === 'failed') return humaniseTaskError(text || null);
  return text || null;
}

import { Clock, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageShell } from '@/pages/PageShell';

type RepeatType = 'once' | 'daily' | 'weekly' | 'monthly';

interface UiScheduled {
  scheduledTaskId: string;
  intent: string;
  repeatType: RepeatType;
  nextRunAt: string | Date;
  lastRunAt: string | Date | null;
  status: 'active' | 'paused' | 'completed';
  createdAt: string | Date;
}

const REPEAT_LABELS: Record<RepeatType, string> = {
  once: '单次',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

/**
 * Phase 16b — scheduled tasks page. Lists the user's triggers with
 * pause/resume/delete actions and a + 添加 dialog for creating
 * new ones. The runner (orchestrator/scheduled-runner.ts) fires due
 * triggers every 60 s.
 */
export function ScheduledPage(): JSX.Element {
  const toast = useToast();
  const [items, setItems] = React.useState<UiScheduled[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.scheduledTasks.list.query();
      setItems(list as UiScheduled[]);
    } catch (err) {
      toast.show(
        err instanceof Error ? `加载失败：${err.message}` : '加载失败',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onPauseResume(item: UiScheduled): Promise<void> {
    try {
      if (item.status === 'paused') {
        await trpc.scheduledTasks.resume.mutate({ scheduledTaskId: item.scheduledTaskId });
        toast.show('已恢复');
      } else {
        await trpc.scheduledTasks.pause.mutate({ scheduledTaskId: item.scheduledTaskId });
        toast.show('已暂停');
      }
      await refresh();
    } catch (err) {
      toast.show(
        err instanceof Error ? `操作失败：${err.message}` : '操作失败',
        'error',
      );
    }
  }

  async function onDelete(item: UiScheduled): Promise<void> {
    if (!window.confirm('删除这个定时任务？')) return;
    try {
      await trpc.scheduledTasks.delete.mutate({ scheduledTaskId: item.scheduledTaskId });
      toast.show('已删除');
      await refresh();
    } catch (err) {
      toast.show(
        err instanceof Error ? `删除失败：${err.message}` : '删除失败',
        'error',
      );
    }
  }

  return (
    <PageShell title="定时任务" subtitle="自动按计划执行的任务" width="3xl">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">共 {items.length} 个</span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/85"
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <Clock className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">还没有定时任务</div>
          <div className="text-xs text-muted-foreground">
            点上方的 + 添加按钮，让 HOLA DAY 按时自动执行任务。
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ScheduledRow
              key={item.scheduledTaskId}
              item={item}
              onPauseResume={() => void onPauseResume(item)}
              onDelete={() => void onDelete(item)}
            />
          ))}
        </div>
      )}

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
    </PageShell>
  );
}

function ScheduledRow({
  item,
  onPauseResume,
  onDelete,
}: {
  item: UiScheduled;
  onPauseResume: () => void;
  onDelete: () => void;
}): JSX.Element {
  const next = new Date(item.nextRunAt as string);
  const isCompleted = item.status === 'completed';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-wider text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">{REPEAT_LABELS[item.repeatType]}</span>
        {item.status === 'paused' && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
            已暂停
          </span>
        )}
        {isCompleted && (
          <span className="rounded bg-muted px-1.5 py-0.5">已完成</span>
        )}
      </div>
      <div className="text-sm text-foreground">"{item.intent}"</div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {isCompleted
            ? `已执行：${formatDateTime(new Date(item.lastRunAt as string))}`
            : `下次执行：${formatDateTime(next)}`}
        </span>
        <div className="flex items-center gap-1">
          {!isCompleted && (
            <button
              type="button"
              onClick={onPauseResume}
              className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-foreground/[0.05] hover:text-foreground"
            >
              {item.status === 'paused' ? (
                <>
                  <Play className="h-3 w-3" />
                  恢复
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3" />
                  暂停
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const toast = useToast();
  const [intent, setIntent] = React.useState('');
  const [repeatType, setRepeatType] = React.useState<RepeatType>('once');
  // Defaults to "tomorrow at the current minute" so the date input
  // never starts in the past.
  const [date, setDate] = React.useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = React.useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function onSubmit(): Promise<void> {
    if (!intent.trim() || submitting) return;
    setSubmitting(true);
    try {
      const local = new Date(`${date}T${time}:00`);
      await trpc.scheduledTasks.create.mutate({
        intent: intent.trim(),
        repeatType,
        scheduledAt: local.toISOString(),
      });
      toast.show('已创建定时任务');
      onCreated();
    } catch (err) {
      toast.show(
        err instanceof Error ? `创建失败：${err.message}` : '创建失败',
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl animate-fade-in">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">添加定时任务</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-4 text-sm">
          <div>
            <label
              className="mb-1 block text-xs font-medium tracking-wider text-muted-foreground"
              htmlFor="schedule-intent"
            >
              任务描述
            </label>
            <textarea
              id="schedule-intent"
              autoFocus
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="例如：查看今天的科技新闻并总结"
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:border-foreground/30 focus-visible:outline-none"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium tracking-wider text-muted-foreground"
              htmlFor="schedule-repeat"
            >
              重复频率
            </label>
            <select
              id="schedule-repeat"
              value={repeatType}
              onChange={(e) => setRepeatType(e.target.value as RepeatType)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:border-foreground/30 focus-visible:outline-none"
            >
              <option value="once">单次</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium tracking-wider text-muted-foreground"
              htmlFor="schedule-date"
            >
              {repeatType === 'once' ? '执行时间' : '首次执行时间'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:border-foreground/30 focus-visible:outline-none"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:border-foreground/30 focus-visible:outline-none"
              />
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!intent.trim() || submitting}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
              intent.trim() && !submitting
                ? 'bg-foreground text-background hover:bg-foreground/85'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            )}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}月${day}日 ${h}:${min}`;
}

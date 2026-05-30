import { Clock, Loader2, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';
import { ScheduledTaskDialog } from '@/components/ScheduledTaskDialog';
import { humaniseTaskError, taskActionError } from '@/lib/error-copy';
import { pageErrorMessage } from '@/lib/page-error-copy';

/**
 * Phase 5a — scheduled tasks list page. Replaces the Phase 16b
 * roadmap placeholder. Wires through to scheduledTasksRouter:
 *   list      -> render rows
 *   toggle    -> pause <-> active flip on the row
 *   delete    -> remove
 *   create    -> modal popup (see ScheduledTaskDialog)
 *
 * Row shape: name (intent slice) · 频率 · 上次/下次执行 · 状态. One-shot
 * schedules that already fired show as 'completed' and are read-only
 * (toggle is rejected by the router with a BAD_REQUEST).
 */

interface UiScheduled {
  scheduledTaskId: string;
  intent: string;
  repeatType: string;
  status: string;
  nextRunAt: string | Date;
  lastRunAt: string | Date | null;
  /** Codex P1 — 'success' | 'failed' | null. Differentiates the
   *  status='active' recurring row that just-failed vs the
   *  status='active' row that just-succeeded. */
  lastRunStatus?: 'success' | 'failed' | string | null;
  /** Error message captured when last_run_status='failed'. Shown
   *  as a tooltip on the failure badge. */
  lastError?: string | null;
  createdAt: string | Date;
}

const REPEAT_LABEL: Record<string, string> = {
  once: '一次性',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

export function ScheduledPage(): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = React.useState<UiScheduled[] | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  // Native window.confirm leaves the page chrome and gives a generic
  // platform prompt. The product-internal Radix-backed ConfirmDialog
  // keeps users inside HOLA DAY's UI and lets us name the task being
  // deleted + show its next run time so the action is unambiguous.
  const [confirmDelete, setConfirmDelete] = React.useState<UiScheduled | null>(
    null,
  );
  // 重新创建 on a failed row pre-fills the dialog with the original
  // intent so the user can edit then save without retyping it.
  const [recreateIntent, setRecreateIntent] = React.useState<string | null>(
    null,
  );
  const [togglingIds, setTogglingIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const reload = React.useCallback(async (): Promise<void> => {
    try {
      const list = await trpc.scheduledTasks.list.query();
      setRows(list as UiScheduled[]);
    } catch (err) {
      toast.show(taskActionError('加载失败', errorMessage(err)), 'error');
      setRows([]);
    }
  }, [toast]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const handleToggle = async (id: string): Promise<void> => {
    if (togglingIds.has(id)) return;
    setTogglingIds((prev) => new Set(prev).add(id));
    try {
      const result = await trpc.scheduledTasks.toggle.mutate({ scheduledTaskId: id });
      toast.show(result.status === 'active' ? '已恢复' : '已暂停');
      await reload();
    } catch (err) {
      toast.show(taskActionError('操作失败', errorMessage(err)), 'error');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const performDelete = async (id: string): Promise<void> => {
    try {
      await trpc.scheduledTasks.delete.mutate({ scheduledTaskId: id });
      toast.show('已删除');
      await reload();
    } catch (err) {
      toast.show(taskActionError('删除失败', errorMessage(err)), 'error');
    }
  };

  return (
    <PageContainer width="list">
      <PageHeader
        title="定时任务"
        description="按计划自动执行任务 — 每天 / 每周 / 每月，或一次性"
        action={
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            新建定时任务
          </button>
        }
      />
      <Section>
        <div className="mb-3 text-xs text-muted-foreground">
          {rows == null
            ? '加载中…'
            : rows.length === 0
              ? '还没有定时任务，点右上角按钮新建一个。'
              : `共 ${rows.length} 个定时任务`}
        </div>
        {rows && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Clock className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground/85">
                把重复的工作交给定时器
              </div>
              <div className="max-w-md text-xs text-muted-foreground">
                例如「每天早上 9 点跑昨天的电商日报」「每周一发送项目周报」。
              </div>
            </div>
          </div>
        )}
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.scheduledTaskId} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium text-foreground" title={r.intent}>
                    {r.intent}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="rounded border border-border bg-card px-1.5 py-0.5">
                      {REPEAT_LABEL[r.repeatType] ?? r.repeatType}
                    </span>
                    <span
                      className={
                        r.status === 'running'
                          ? 'text-primary'
                          : r.status === 'active'
                            ? 'text-foreground/80'
                            : r.status === 'paused'
                              ? 'text-amber-700 dark:text-amber-300'
                              : r.status === 'failed'
                                ? 'text-rose-700 dark:text-rose-300'
                                : 'text-muted-foreground'
                      }
                    >
                      {r.status === 'running'
                        ? '执行中'
                        : r.status === 'active'
                          ? '已启用'
                          : r.status === 'paused'
                            ? '已暂停'
                            : r.status === 'failed'
                              ? '已失败'
                              : '已完成'}
                    </span>
                    {/* Codex P1 — for recurring rows that just had a
                        failed fire (status='active', last_run_status='failed'),
                        surface a small red chip with the error message.
                        For one-shot rows that failed the status badge
                        already says 已失败 so this chip is redundant. */}
                    {r.status === 'active' && r.lastRunStatus === 'failed' && (
                      <span
                        className="rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                        title={humaniseTaskError(r.lastError) || '上次执行失败'}
                      >
                        上次失败
                      </span>
                    )}
                    <span>下次：{fmtDate(r.nextRunAt)}</span>
                    {r.lastRunAt && <span>上次：{fmtDate(r.lastRunAt)}</span>}
                    {/* One-shot failed: the status badge already says
                        已失败; offer the error detail on hover when
                        present. */}
                    {r.status === 'failed' && r.lastError && (
                      <span
                        className="cursor-help text-rose-700 dark:text-rose-300"
                        title={humaniseTaskError(r.lastError)}
                      >
                        ⓘ 错误详情
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Pause/resume only for the two states it actually
                      means something. running can't be toggled (mid-
                      execution), completed one-shots can't be re-armed
                      from a button (use 重新创建), failed surfaces a
                      reopen-with-intent affordance instead. */}
                  {(r.status === 'active' || r.status === 'paused') && (
                    <ScheduledToggleButton
                      status={r.status}
                      toggling={togglingIds.has(r.scheduledTaskId)}
                      onToggle={() => void handleToggle(r.scheduledTaskId)}
                    />
                  )}
                  {r.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => {
                        setRecreateIntent(r.intent);
                        setDialogOpen(true);
                      }}
                      aria-label="基于此任务重新创建定时"
                      title="基于此任务重新创建定时"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      重新创建
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(r)}
                    aria-label="删除"
                    title="删除"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <ScheduledTaskDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setRecreateIntent(null);
        }}
        onCreated={() => {
          setDialogOpen(false);
          setRecreateIntent(null);
          void reload();
        }}
        {...(recreateIntent ? { initialIntent: recreateIntent } : {})}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="删除这个定时任务？"
        description={
          confirmDelete
            ? `「${truncate(confirmDelete.intent, 60)}」\n下次执行：${fmtDate(confirmDelete.nextRunAt)}\n删除后无法恢复。`
            : ''
        }
        confirmLabel="确认删除"
        destructive
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const row = confirmDelete;
          if (!row) return;
          await performDelete(row.scheduledTaskId);
          setConfirmDelete(null);
        }}
      />
    </PageContainer>
  );
}

function ScheduledToggleButton({
  status,
  toggling,
  onToggle,
}: {
  status: string;
  toggling: boolean;
  onToggle(): void;
}): JSX.Element {
  const actionLabel = status === 'active' ? '暂停' : '恢复';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={actionLabel}
      title={toggling ? '同步中…' : actionLabel}
      disabled={toggling}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-wait disabled:opacity-50"
    >
      {toggling ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : status === 'active' ? (
        <Pause className="h-4 w-4" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </button>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function errorMessage(err: unknown): string {
  return pageErrorMessage(err);
}

/**
 * Local date formatter — keep the rendered string in the user's
 * tz. Falls back to the raw value if the input isn't parseable.
 */
function fmtDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  try {
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return String(input);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return String(input);
  }
}

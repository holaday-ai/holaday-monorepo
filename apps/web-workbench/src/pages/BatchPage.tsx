import { CheckCircle2, Layers, Loader2, Plus, XCircle } from 'lucide-react';
import * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';
import { BatchTaskDialog } from '@/components/BatchTaskDialog';

/**
 * Phase 5b — batch tasks list + detail (one page, two modes).
 *
 * When `:batchId` is in the URL we render the detail view: progress
 * bar + per-item rows with task deep-links. Otherwise we render the
 * list of the user's batches with a "新建批量" button.
 *
 * Live updates come through the global WS handler in task-store —
 * server.batch.progress events refresh the displayed counters
 * without a re-fetch. (Today this page does a manual reload on
 * mount + on a 5s poll for safety; the WS hook is a follow-up.)
 */

interface UiBatchRow {
  batchId: string;
  name: string | null;
  status: string;
  concurrency: number;
  itemsTotal: number;
  itemsDone: number;
  itemsFailed: number;
  createdAt: string | Date;
  completedAt: string | Date | null;
}

interface UiBatchDetail extends UiBatchRow {
  items: Array<{
    batchItemId: string;
    seq: number;
    prompt: string;
    status: string;
    errorMessage: string | null;
    taskId: string | null;
    createdAt: string | Date;
    completedAt: string | Date | null;
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  completed: '全部完成',
  partial: '部分失败',
  cancelled: '已取消',
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
};

export function BatchPage(): JSX.Element {
  const { batchId } = useParams<{ batchId?: string }>();
  if (batchId) return <BatchDetail batchId={batchId} />;
  return <BatchList />;
}

function BatchList(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = React.useState<UiBatchRow[] | null>(null);
  // Phase 5b — when InputArea routes here with `state.initialPrompts`
  // (multi-line composer detect), auto-open the create dialog with
  // those lines pre-filled. One-shot: we clear the state after using
  // it so a refresh doesn't re-open the dialog.
  const incomingPrompts = (location.state as { initialPrompts?: string[] } | null)
    ?.initialPrompts;
  const [dialogOpen, setDialogOpen] = React.useState(
    Array.isArray(incomingPrompts) && incomingPrompts.length > 1,
  );
  const [initialPrompts] = React.useState<string[] | undefined>(
    Array.isArray(incomingPrompts) ? incomingPrompts : undefined,
  );
  React.useEffect(() => {
    if (incomingPrompts) {
      // Clear the location.state so a re-mount doesn't re-trigger.
      window.history.replaceState({}, '');
    }
  }, [incomingPrompts]);

  const reload = React.useCallback(async () => {
    try {
      const list = await trpc.batchTasks.list.query();
      setRows(list as UiBatchRow[]);
    } catch (err) {
      toast.show(err instanceof Error ? `加载失败：${err.message}` : '加载失败', 'error');
      setRows([]);
    }
  }, [toast]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <PageContainer width="list">
      <PageHeader
        title="批量任务"
        description="一次提交多个任务，按套餐并发执行"
        action={
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            新建批量任务
          </button>
        }
      />
      <Section>
        <div className="mb-3 text-xs text-muted-foreground">
          {rows == null
            ? '加载中…'
            : rows.length === 0
              ? '还没有批量任务。'
              : `共 ${rows.length} 个批量任务`}
        </div>
        {rows && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground/85">
                一次提交多个任务
              </div>
              <div className="max-w-md text-xs text-muted-foreground">
                例如「逐个查询这 10 个竞品的最新动态」。按套餐并发：Basic 同时 3 个，Pro 同时 5 个。
              </div>
            </div>
          </div>
        )}
        {rows && rows.length > 0 && (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.batchId}>
                <button
                  type="button"
                  onClick={() => navigate(`/batch/${encodeURIComponent(r.batchId)}`)}
                  className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-foreground/[0.03]"
                >
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Layers className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-sm font-medium">
                      {r.name ?? `批量任务 · ${r.itemsTotal} 项`}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span
                        className={
                          r.status === 'completed'
                            ? 'text-foreground/80'
                            : r.status === 'partial'
                              ? 'text-amber-700 dark:text-amber-300'
                              : r.status === 'cancelled' || r.status === 'pending'
                                ? 'text-muted-foreground'
                                : 'text-primary'
                        }
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                      <span>
                        {r.itemsDone}/{r.itemsTotal} 完成
                        {r.itemsFailed > 0 && ` · ${r.itemsFailed} 失败`}
                      </span>
                      <span>并发 {r.concurrency}</span>
                      <span>{fmtDate(r.createdAt)}</span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <BatchTaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(newBatchId) => {
          setDialogOpen(false);
          navigate(`/batch/${encodeURIComponent(newBatchId)}`);
        }}
        initialPrompts={initialPrompts}
      />
    </PageContainer>
  );
}

function BatchDetail({ batchId }: { batchId: string }): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [detail, setDetail] = React.useState<UiBatchDetail | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      const data = await trpc.batchTasks.detail.query({ batchId });
      setDetail(data as UiBatchDetail);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '加载失败', 'error');
    }
  }, [batchId, toast]);

  React.useEffect(() => {
    void reload();
    // Lightweight polling — server.batch.progress WS events also
    // refresh state via the task-store hook, but the 5s poll is the
    // safety net in case the WS dropped.
    const handle = setInterval(() => {
      void reload();
    }, 5_000);
    return () => clearInterval(handle);
  }, [reload]);

  const performCancel = async (): Promise<void> => {
    try {
      await trpc.batchTasks.cancel.mutate({ batchId });
      toast.show('已取消');
      await reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '取消失败', 'error');
    }
  };

  if (!detail) {
    return (
      <PageContainer width="list">
        <PageHeader title="批量任务详情" />
        <Section>
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        </Section>
      </PageContainer>
    );
  }

  const pct =
    detail.itemsTotal > 0
      ? Math.round(((detail.itemsDone + detail.itemsFailed) / detail.itemsTotal) * 100)
      : 0;

  const canCancel = detail.status === 'pending' || detail.status === 'running';

  return (
    <PageContainer width="list">
      <PageHeader
        title={detail.name ?? `批量任务 · ${detail.itemsTotal} 项`}
        description={`并发 ${detail.concurrency} · ${STATUS_LABEL[detail.status] ?? detail.status}`}
        action={
          canCancel ? (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
            >
              取消批量
            </button>
          ) : null
        }
      />
      <Section>
        <div className="mb-2 text-xs text-muted-foreground">
          {detail.itemsDone} / {detail.itemsTotal} 完成
          {detail.itemsFailed > 0 && ` · ${detail.itemsFailed} 失败`}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
            aria-label={`${pct}%`}
          />
        </div>
        <ul className="mt-5 divide-y divide-border">
          {detail.items.map((item) => (
            <li key={item.batchItemId} className="flex items-start gap-3 py-3">
              <div className="mt-0.5 shrink-0">
                <ItemStatusIcon status={item.status} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-mono">#{item.seq + 1}</span>
                  <span>{ITEM_STATUS_LABEL[item.status] ?? item.status}</span>
                </div>
                <div
                  className="mt-0.5 line-clamp-2 text-sm text-foreground"
                  title={item.prompt}
                >
                  {item.prompt}
                </div>
                {item.errorMessage && (
                  <div className="mt-1 text-[11px] text-destructive">
                    {item.errorMessage}
                  </div>
                )}
                {item.taskId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/?task=${encodeURIComponent(item.taskId!)}`)}
                    className="mt-1 inline-flex items-center text-[11px] text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:text-primary/80"
                  >
                    打开任务详情 →
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <ConfirmDialog
        open={confirmCancel}
        title="取消这个批量任务？"
        description={`未开始的项目会被取消。已在执行中的项目会继续完成，不会被中断。`}
        confirmLabel="取消批量"
        destructive
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          setConfirmCancel(false);
          await performCancel();
        }}
      />
    </PageContainer>
  );
}

function ItemStatusIcon({ status }: { status: string }): JSX.Element {
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-primary" />;
  }
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle className="h-4 w-4 text-destructive" />;
  }
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  }
  return <div className="h-4 w-4 rounded-full border border-border" />;
}

function fmtDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  try {
    const d = typeof input === 'string' ? new Date(input) : input;
    if (Number.isNaN(d.getTime())) return String(input);
    return d.toLocaleString('zh-CN', {
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

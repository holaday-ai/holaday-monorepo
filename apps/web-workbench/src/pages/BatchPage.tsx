import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';
import { BatchTaskDialog } from '@/components/BatchTaskDialog';
import { batchUnsuccessfulCopy } from '@/lib/batch-copy';
import {
  batchDetailRemainingCount,
  batchDetailSummary,
  batchErrorMessage,
  batchListSummary,
  mergeBatchRows,
  normalizeBatchPage,
  batchPromptImportStateReset,
  normalizeBatchDetail,
  type NormalizedBatchDetail,
  type NormalizedBatchRow,
  type BatchListCursor,
  batchFinishedCount,
  batchProgressPercent,
  batchRemainingCount,
  batchShouldPoll,
  batchStatusCopy,
  batchStatusLabel,
  safeBatchCount,
} from '@/lib/batch-page-state';
import {
  applyBatchProgressToDetail,
  applyBatchProgressToRows,
  type BatchProgressFrame,
} from '@/lib/batch-progress';
import { humaniseTaskError, taskActionError } from '@/lib/error-copy';
import { supportMailtoHref } from '@/lib/support-links';
import { onServerMessage } from '@/lib/ws';

/**
 * Phase 5b — batch tasks list + detail (one page, two modes).
 *
 * When `:batchId` is in the URL we render the detail view: progress
 * bar + per-item rows with task deep-links. Otherwise we render the
 * list of the user's batches with a "新建批量" button.
 *
 * Live updates come from `server.batch.progress` frames, with a 5s
 * poll as a safety net if the WS connection drops.
 */

const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  completed: '完成',
  partial_success: '需复核',
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
  const { hash, pathname, search } = location;
  const [rows, setRows] = React.useState<NormalizedBatchRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<BatchListCursor | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const reloadRequestRef = React.useRef(0);
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
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (incomingPrompts) {
      // Clear the location.state so a re-mount doesn't re-trigger.
      const reset = batchPromptImportStateReset({ hash, pathname, search });
      navigate(reset.to, reset.options);
    }
  }, [hash, incomingPrompts, navigate, pathname, search]);

  const loadPage = React.useCallback(async (cursor: BatchListCursor | null = null) => {
    const requestId = reloadRequestRef.current + 1;
    reloadRequestRef.current = requestId;
    const append = cursor !== null;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const list = await trpc.batchTasks.list.query({
        limit: 50,
        cursor: cursor
          ? {
              id: cursor.id,
              createdAt:
                cursor.createdAt instanceof Date
                  ? cursor.createdAt
                  : new Date(cursor.createdAt),
            }
          : undefined,
      });
      if (!mountedRef.current || reloadRequestRef.current !== requestId) return;
      const page = normalizeBatchPage(list);
      setRows((current) =>
        append ? mergeBatchRows(current ?? [], page.items) : page.items,
      );
      setNextCursor(page.nextCursor);
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current || reloadRequestRef.current !== requestId) return;
      const message = batchErrorMessage(err);
      toast.show(taskActionError('批量任务暂时无法加载', message), 'error');
      setLoadError(message);
    } finally {
      if (mountedRef.current && reloadRequestRef.current === requestId) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [toast]);

  const reload = React.useCallback(() => loadPage(null), [loadPage]);

  React.useEffect(() => {
    void reload();
    return () => {
      reloadRequestRef.current += 1;
    };
  }, [reload]);

  React.useEffect(() => {
    return onServerMessage((msg) => {
      if (!mountedRef.current) return;
      if (!isBatchProgressFrame(msg)) return;
      setRows((current) =>
        current ? applyBatchProgressToRows(current, msg) : current,
      );
    });
  }, []);

  const rowCount = rows?.length ?? 0;
  const summary = batchListSummary({ loading, error: loadError, count: rowCount });
  const statusCopy = batchStatusCopy({
    loading,
    error: loadError,
    hasData: rowCount > 0,
    target: 'list',
  });

  return (
    <PageContainer width="list">
      <PageHeader
        title="批量任务"
        description="一次提交多个任务，按套餐并发执行"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="hidden items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:inline-flex">
              {summary}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
              onClick={() => void reload()}
              disabled={loading}
              aria-label={loading ? '正在刷新批量任务' : '刷新批量任务'}
              title={loading ? '刷新中' : '刷新'}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
            <Button type="button" onClick={() => setDialogOpen(true)} size="sm">
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              新建批量任务
            </Button>
          </div>
        }
      />
      <Section className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {statusCopy && (loading || rowCount > 0) && (
          <StatusNotice
            copy={statusCopy}
            loading={loading}
            onRetry={() => void reload()}
            supportSubject="批量任务列表加载失败"
            supportBody="批量任务列表加载失败，请协助排查。"
          />
        )}
        {loading && rows == null && (
          <div className="space-y-3">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="flex items-start gap-3 rounded-[8px] border border-[#DCDDDD] p-3">
                <div className="h-7 w-7 rounded-md bg-[#EFEFEF]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-40 rounded bg-[#EFEFEF]" />
                  <div className="h-3 w-64 max-w-full rounded bg-[#EFEFEF]" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && loadError && rows == null && (
          <HardErrorState
            title={statusCopy?.title ?? '批量任务暂时无法加载'}
            message={loadError}
            onRetry={() => void reload()}
            supportSubject="批量任务列表加载失败"
            supportBody="批量任务列表加载失败，请协助排查。"
          />
        )}
        {rows && rows.length === 0 && !loadError && (
          <div className="flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[#DCDDDD] bg-white text-[#EA1F59]">
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
          <>
            <ul className="divide-y divide-[#EFEFEF]">
              {rows.map((r) => (
                <BatchListRow
                  key={r.batchId}
                  row={r}
                  onOpen={() => navigate(`/batch/${encodeURIComponent(r.batchId)}`)}
                />
              ))}
            </ul>
            {nextCursor && (
              <div className="flex justify-center border-t border-[#EFEFEF] px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadPage(nextCursor)}
                  className="h-8 rounded-[6px] border-[#DCDDDD] bg-white px-3 text-xs text-[#595757] hover:border-[#EA1F59]/25 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59]"
                >
                  {loadingMore && (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />
                  )}
                  {loadingMore ? '加载中…' : '加载更多批量任务'}
                </Button>
              </div>
            )}
          </>
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

function BatchListRow({
  row,
  onOpen,
}: {
  readonly row: NormalizedBatchRow;
  readonly onOpen: () => void;
}): JSX.Element {
  const total = safeBatchCount(row.itemsTotal);
  const done = safeBatchCount(row.itemsDone);
  const review = safeBatchCount(row.itemsReview);
  const failed = safeBatchCount(row.itemsFailed);
  const cancelled = safeBatchCount(row.itemsCancelled ?? 0);
  const finished = batchFinishedCount({ done, review, failed, cancelled });
  const remaining = batchRemainingCount({ total, done, review, failed, cancelled });
  const pct = batchProgressPercent({ total, done, review, failed, cancelled });
  const statusTone = batchStatusTone(row.status);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#EFEFEF]/35"
      >
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#EA1F59] transition-colors group-hover:border-[#EA1F59]/35">
          <Layers className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="line-clamp-1 text-sm font-medium group-hover:text-[#EA1F59]">
                {row.name ?? `批量任务 · ${total} 项`}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className={statusTone}>
                  {batchStatusLabel(row.status)}
                </span>
                <span>并发 {safeBatchCount(row.concurrency)}</span>
                <span>{fmtDate(row.createdAt)}</span>
              </div>
            </div>
            <div className="shrink-0 rounded-full border border-[#DCDDDD] bg-white px-2.5 py-1 text-[11px] font-medium text-[#595757]">
              {pct}%
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#EFEFEF]">
            <div
              className={`h-full rounded-full transition-[width] ${batchProgressFillTone(row.status)}`}
              style={{ width: `${pct}%` }}
              aria-label={`${pct}%`}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              {finished}/{total} 已处理
              {batchUnsuccessfulCopy(failed, cancelled, review)}
            </span>
            {remaining > 0 && <span>剩余 {remaining}</span>}
          </div>
        </div>
      </button>
    </li>
  );
}

function BatchDetail({ batchId }: { batchId: string }): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [detail, setDetail] = React.useState<NormalizedBatchDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const reloadRequestRef = React.useRef(0);
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = React.useCallback(async () => {
    const requestId = reloadRequestRef.current + 1;
    reloadRequestRef.current = requestId;
    setLoading(true);
    try {
      const data = await trpc.batchTasks.detail.query({ batchId });
      if (!mountedRef.current || reloadRequestRef.current !== requestId) return;
      setDetail(normalizeBatchDetail(data));
      setLoadError(null);
    } catch (err) {
      if (!mountedRef.current || reloadRequestRef.current !== requestId) return;
      const message = batchErrorMessage(err);
      toast.show(taskActionError('批量任务详情暂时无法加载', message), 'error');
      setLoadError(message);
    } finally {
      if (mountedRef.current && reloadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [batchId, toast]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const shouldPollDetail = batchShouldPoll(detail?.status);

  React.useEffect(() => {
    if (!shouldPollDetail) return undefined;
    // Lightweight polling while work is still queued/running — WS
    // events update immediately; this keeps the view correct after
    // reconnects or missed frames. Terminal batches stop polling so
    // a reader doesn't get stale refresh errors while reviewing
    // completed results.
    const handle = setInterval(() => {
      void reload();
    }, 5_000);
    return () => {
      clearInterval(handle);
      reloadRequestRef.current += 1;
    };
  }, [reload, shouldPollDetail]);

  React.useEffect(() => {
    return onServerMessage((msg) => {
      if (!mountedRef.current) return;
      if (!isBatchProgressFrame(msg)) return;
      setDetail((current) =>
        current ? applyBatchProgressToDetail(current, msg) : current,
      );
    });
  }, []);

  const performCancel = async (): Promise<void> => {
    try {
      await trpc.batchTasks.cancel.mutate({ batchId });
      if (!mountedRef.current) return;
      toast.show('已取消');
      await reload();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(taskActionError('取消失败', batchErrorMessage(err)), 'error');
    }
  };

  const detailDone = safeBatchCount(detail?.itemsDone);
  const detailReview = safeBatchCount(detail?.itemsReview);
  const detailFailed = safeBatchCount(detail?.itemsFailed);
  const detailCancelled = safeBatchCount(detail?.itemsCancelled ?? 0);
  const detailTotal = detail ? safeBatchCount(detail.itemsTotal) : null;
  const finishedCount = batchFinishedCount({
    done: detailDone,
    review: detailReview,
    failed: detailFailed,
    cancelled: detailCancelled,
  });
  const detailSummary = batchDetailSummary({
    loading,
    error: loadError,
    total: detailTotal,
    finished: finishedCount,
  });
  const detailStatusCopy = batchStatusCopy({
    loading,
    error: loadError,
    hasData: detail != null,
    target: 'detail',
  });

  if (!detail) {
    return (
      <PageContainer width="list">
        <PageHeader
          title="批量任务详情"
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="hidden items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:inline-flex">
                {detailSummary}
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
                onClick={() => void reload()}
                disabled={loading}
                aria-label={loading ? '正在刷新批量详情' : '刷新批量详情'}
                title={loading ? '刷新中' : '刷新'}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
              </Button>
            </div>
          }
        />
        <Section className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          {loading ? (
            <div className="space-y-3">
              <div className="h-3 w-32 rounded bg-[#EFEFEF]" />
              <div className="h-2 w-full rounded-full bg-[#EFEFEF]" />
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="flex items-start gap-3 border-t border-[#EFEFEF] py-3 first:border-t-0">
                  <div className="h-4 w-4 rounded-full bg-[#EFEFEF]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-20 rounded bg-[#EFEFEF]" />
                    <div className="h-3 w-72 max-w-full rounded bg-[#EFEFEF]" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <HardErrorState
              title={detailStatusCopy?.title ?? '批量任务详情暂时无法加载'}
              message={loadError}
              onRetry={() => void reload()}
              supportSubject="批量任务详情加载失败"
              supportBody="批量任务详情加载失败，请协助排查。"
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              暂无批量任务详情
            </div>
          )}
        </Section>
      </PageContainer>
    );
  }

  const pct = batchProgressPercent({
    total: detailTotal ?? 0,
    done: detailDone,
    review: detailReview,
    failed: detailFailed,
    cancelled: detailCancelled,
  });
  const detailRemaining = batchDetailRemainingCount(detail);

  const canCancel = detail.status === 'pending' || detail.status === 'running';

  return (
    <PageContainer width="list">
      <PageHeader
        title={detail.name ?? `批量任务 · ${detailTotal ?? 0} 项`}
        description={`并发 ${safeBatchCount(detail.concurrency)} · ${batchStatusLabel(detail.status)}`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="hidden items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:inline-flex">
              {detailSummary}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
              onClick={() => void reload()}
              disabled={loading}
              aria-label={loading ? '正在刷新批量详情' : '刷新批量详情'}
              title={loading ? '刷新中' : '刷新'}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
            {canCancel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-[#DCDDDD] bg-white text-[#EA1F59] hover:border-[#EA1F59]/35 hover:bg-white hover:text-[#EA1F59]"
                onClick={() => setConfirmCancel(true)}
              >
                取消批量
              </Button>
            )}
          </div>
        }
      />
      <Section className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {detailStatusCopy && (
          <StatusNotice
            copy={detailStatusCopy}
            loading={loading}
            onRetry={() => void reload()}
            supportSubject="批量任务详情加载失败"
            supportBody="批量任务详情加载失败，请协助排查。"
          />
        )}
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <BatchMetric label="成功" value={detailDone} tone="success" />
          <BatchMetric label="需复核" value={detailReview} tone="warning" />
          <BatchMetric label="失败" value={detailFailed} tone="danger" />
          <BatchMetric label="取消" value={detailCancelled} tone="neutral" />
          <BatchMetric label="剩余" value={detailRemaining} tone="pending" />
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {finishedCount} / {detailTotal ?? 0} 已处理
            {batchUnsuccessfulCopy(detailFailed, detailCancelled, detailReview)}
          </span>
          <span className="font-mono text-[#595757]">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#EFEFEF]">
          <div
            className={`h-full rounded-full transition-[width] ${batchProgressFillTone(detail.status)}`}
            style={{ width: `${pct}%` }}
            aria-label={`${pct}%`}
          />
        </div>
        <ul className="mt-5 divide-y divide-[#EFEFEF]">
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
                  <div className="mt-1 text-[11px] text-[#EA1F59]">
                    {humaniseTaskError(item.errorMessage)}
                  </div>
                )}
                {item.taskId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/?task=${encodeURIComponent(item.taskId!)}`)}
                    className="mt-1 inline-flex items-center text-[11px] text-[#EA1F59] underline decoration-[#EA1F59]/40 underline-offset-2 transition-colors hover:text-[#EA1F59]"
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
          await performCancel();
          if (mountedRef.current) {
            setConfirmCancel(false);
          }
        }}
      />
    </PageContainer>
  );
}

function isBatchProgressFrame(msg: unknown): msg is BatchProgressFrame {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'server.batch.progress'
  );
}

function StatusNotice({
  copy,
  loading,
  onRetry,
  supportSubject,
  supportBody,
}: {
  copy: { readonly title: string; readonly body: string };
  loading: boolean;
  onRetry(): void;
  supportSubject: string;
  supportBody: string;
}): JSX.Element {
  const isError = copy.title.includes('失败');
  return (
    <div className="mb-4 rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] [border-left-width:3px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          {isError ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA1F59]" aria-hidden />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#EA1F59]" aria-hidden />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground/85">{copy.title}</div>
            <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{copy.body}</div>
          </div>
        </div>
        {isError && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
              onClick={onRetry}
              disabled={loading}
            >
              {loading ? '重试中…' : '重试'}
            </Button>
            <Button
              asChild
              type="button"
              variant="outline"
              size="sm"
              className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
            >
              <a
                href={supportMailtoHref({
                  subject: supportSubject,
                  body: `${supportBody}\n\n注册邮箱：\n出现时间：`,
                })}
              >
                联系支持
              </a>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function HardErrorState({
  title,
  message,
  onRetry,
  supportSubject,
  supportBody,
}: {
  title: string;
  message: string;
  onRetry(): void;
  supportSubject: string;
  supportBody: string;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <AlertCircle className="h-8 w-8 text-[#EA1F59]" aria-hidden />
      <div className="text-sm font-medium text-foreground/80">{title}</div>
      <div className="max-w-md text-xs leading-5 text-muted-foreground">{message}</div>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button type="button" size="sm" onClick={onRetry}>
          重试
        </Button>
        <Button
          asChild
          type="button"
          variant="outline"
          size="sm"
          className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
        >
          <a
            href={supportMailtoHref({
              subject: supportSubject,
              body: `${supportBody}\n\n注册邮箱：\n出现时间：`,
            })}
          >
            联系支持
          </a>
        </Button>
      </div>
    </div>
  );
}

function ItemStatusIcon({ status }: { status: string }): JSX.Element {
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-[#42C0EF]" />;
  }
  if (status === 'partial_success') {
    return <AlertCircle className="h-4 w-4 text-[#FFC910]" />;
  }
  if (status === 'failed') {
    return <XCircle className="h-4 w-4 text-[#EA1F59]" />;
  }
  if (status === 'cancelled') {
    return <CircleSlash className="h-4 w-4 text-muted-foreground" />;
  }
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 animate-spin text-[#EA1F59]" />;
  }
  return <div className="h-4 w-4 rounded-full border border-[#DCDDDD]" />;
}

function BatchMetric({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral' | 'pending';
}): JSX.Element {
  const toneClass = {
    success: 'border-[#42C0EF]/35 bg-[rgba(66,192,239,0.10)] text-[#1688AA]',
    warning: 'border-[#FFC910]/45 bg-[rgba(255,201,16,0.12)] text-[#8A6A00]',
    danger: 'border-[#EA1F59]/30 bg-[rgba(234,31,89,0.08)] text-[#EA1F59]',
    neutral: 'border-[#DCDDDD] bg-[#EFEFEF]/50 text-[#595757]',
    pending: 'border-[#FFC910]/45 bg-[rgba(255,201,16,0.12)] text-[#8A6A00]',
  }[tone];

  return (
    <div
      className={`flex min-h-16 items-center justify-between rounded-[8px] border px-3 py-2 ${toneClass}`}
    >
      <span className="text-[12px] font-medium text-[#595757]">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{safeBatchCount(value)}</span>
    </div>
  );
}

function batchStatusTone(status: string): string {
  if (status === 'completed') return 'text-[#1688AA]';
  if (status === 'partial') return 'text-[#8A6A00]';
  if (status === 'running') return 'text-[#EA1F59]';
  return 'text-muted-foreground';
}

function batchProgressFillTone(status: string): string {
  if (status === 'completed') return 'bg-[#42C0EF]';
  if (status === 'partial') return 'bg-[#FFC910]';
  if (status === 'cancelled' || status === 'pending') return 'bg-[#ADADAD]';
  return 'bg-[#EA1F59]';
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

import { pageErrorMessage } from './page-error-copy';

export interface NormalizedBatchRow {
  readonly batchId: string;
  readonly name: string | null;
  readonly status: string;
  readonly concurrency: number;
  readonly itemsTotal: number;
  readonly itemsDone: number;
  readonly itemsFailed: number;
  readonly itemsCancelled: number;
  readonly createdAt: string | Date;
  readonly completedAt: string | Date | null;
}

export interface NormalizedBatchItem {
  readonly batchItemId: string;
  readonly seq: number;
  readonly prompt: string;
  readonly status: string;
  readonly errorMessage: string | null;
  readonly taskId: string | null;
  readonly createdAt: string | Date;
  readonly completedAt: string | Date | null;
}

export interface NormalizedBatchDetail extends NormalizedBatchRow {
  readonly items: NormalizedBatchItem[];
}

export function batchListSummary({
  loading,
  error,
  count,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: number;
}): string {
  const safeCount = safeBatchCount(count);
  if (loading && safeCount === 0) return '批量任务加载中…';
  if (error && safeCount > 0) return `刷新失败 · 显示 ${safeCount} 个批量`;
  if (error) return '批量任务暂时无法加载';
  if (safeCount === 0) return '暂无批量任务';
  return `共 ${safeCount} 个批量任务`;
}

export function batchDetailSummary({
  loading,
  error,
  total,
  finished,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly total: number | null;
  readonly finished: number;
}): string {
  const safeTotal = total == null ? null : safeBatchCount(total);
  const safeFinished = safeBatchCount(finished);
  if (loading && safeTotal == null) return '详情加载中…';
  if (error && safeTotal != null) return '刷新失败 · 显示上次详情';
  if (error) return '详情暂时无法加载';
  if (safeTotal == null) return '暂无详情';
  return `${safeFinished} / ${safeTotal} 已处理`;
}

export function batchStatusCopy({
  loading,
  error,
  hasData,
  target,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasData: boolean;
  readonly target: 'list' | 'detail';
}): { readonly title: string; readonly body: string } | null {
  const label = target === 'list' ? '批量任务' : '批量任务详情';
  if (error && hasData) {
    return {
      title: `刷新失败，正在显示上次成功加载的${label}`,
      body: error,
    };
  }
  if (error) {
    return {
      title: `${label}暂时无法加载`,
      body: error,
    };
  }
  if (loading && !hasData) {
    return {
      title: `${label}加载中…`,
      body: target === 'list' ? '正在读取你的批量任务。' : '正在读取批量任务进度和每一项状态。',
    };
  }
  return null;
}

export function batchProgressPercent({
  total,
  done,
  failed,
  cancelled,
}: {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled?: number | null;
}): number {
  const safeTotal = safeBatchCount(total);
  if (safeTotal <= 0) return 0;
  const finished = batchFinishedCount({ done, failed, cancelled });
  return Math.min(100, Math.max(0, Math.round((finished / safeTotal) * 100)));
}

export function batchFinishedCount({
  done,
  failed,
  cancelled,
}: {
  readonly done: number;
  readonly failed: number;
  readonly cancelled?: number | null;
}): number {
  return (
    safeBatchCount(done) +
    safeBatchCount(failed) +
    safeBatchCount(cancelled ?? 0)
  );
}

export function batchRemainingCount({
  total,
  done,
  failed,
  cancelled,
}: {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled?: number | null;
}): number {
  const safeTotal = safeBatchCount(total);
  const finished = batchFinishedCount({ done, failed, cancelled });
  return Math.max(0, safeTotal - finished);
}

export function batchErrorMessage(err: unknown, fallback = '请稍后重试'): string {
  return pageErrorMessage(err, fallback);
}

export function batchShouldPoll(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'running';
}

export function safeBatchCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function normalizeBatchRows(value: unknown): NormalizedBatchRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = normalizeBatchRow(entry);
    return row ? [row] : [];
  });
}

export function normalizeBatchDetail(value: unknown): NormalizedBatchDetail | null {
  const row = normalizeBatchRow(value);
  if (!row || !isRecord(value)) return null;
  const items = Array.isArray(value.items)
    ? value.items.flatMap((entry, index) => {
        const item = normalizeBatchItem(entry, index);
        return item ? [item] : [];
      })
    : [];
  return { ...row, items };
}

function normalizeBatchRow(value: unknown): NormalizedBatchRow | null {
  if (!isRecord(value)) return null;
  const batchId = safeBatchText(value.batchId);
  if (!batchId) return null;
  return {
    batchId,
    name: safeNullableBatchText(value.name),
    status: normalizeBatchStatus(value.status),
    concurrency: positiveBatchCount(value.concurrency),
    itemsTotal: safeBatchCount(value.itemsTotal),
    itemsDone: safeBatchCount(value.itemsDone),
    itemsFailed: safeBatchCount(value.itemsFailed),
    itemsCancelled: safeBatchCount(value.itemsCancelled),
    createdAt: safeBatchDate(value.createdAt) ?? '',
    completedAt: safeNullableBatchDate(value.completedAt),
  };
}

function normalizeBatchItem(value: unknown, fallbackSeq: number): NormalizedBatchItem | null {
  if (!isRecord(value)) return null;
  const batchItemId = safeBatchText(value.batchItemId);
  if (!batchItemId) return null;
  return {
    batchItemId,
    seq:
      typeof value.seq === 'number' && Number.isSafeInteger(value.seq) && value.seq >= 0
        ? value.seq
        : fallbackSeq,
    prompt: safeBatchText(value.prompt) || '未命名任务',
    status: normalizeBatchItemStatus(value.status),
    errorMessage: safeNullableBatchText(value.errorMessage),
    taskId: safeNullableBatchText(value.taskId),
    createdAt: safeBatchDate(value.createdAt) ?? '',
    completedAt: safeNullableBatchDate(value.completedAt),
  };
}

function normalizeBatchStatus(value: unknown): string {
  return value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'partial' ||
    value === 'cancelled'
    ? value
    : 'pending';
}

function normalizeBatchItemStatus(value: unknown): string {
  return value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : 'pending';
}

function positiveBatchCount(value: unknown): number {
  const count = safeBatchCount(value);
  return count > 0 ? count : 1;
}

function safeNullableBatchText(value: unknown): string | null {
  const text = safeBatchText(value);
  return text || null;
}

function safeBatchText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeNullableBatchDate(value: unknown): string | Date | null {
  return value == null ? null : safeBatchDate(value);
}

function safeBatchDate(value: unknown): string | Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

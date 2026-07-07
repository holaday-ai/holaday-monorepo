export interface BatchProgressRow {
  batchId: string;
  status: string;
  itemsTotal: number;
  itemsDone: number;
  itemsReview?: number | null;
  itemsFailed: number;
  itemsCancelled?: number | null;
}

export interface BatchProgressItem {
  batchItemId: string;
  status: string;
  taskId: string | null;
  errorMessage: string | null;
}

export interface BatchProgressDetail extends BatchProgressRow {
  items: BatchProgressItem[];
}

export interface BatchProgressFrame {
  type: 'server.batch.progress';
  batchId: string;
  status: string;
  itemsTotal: number;
  itemsDone: number;
  itemsReview?: number;
  itemsFailed: number;
  itemsCancelled?: number;
  item?: {
    batchItemId: string;
    status: string;
    taskId?: string;
    errorMessage?: string;
  };
}

export function normalizeBatchProgressFrame(value: unknown): BatchProgressFrame | null {
  if (!isRecord(value) || value.type !== 'server.batch.progress') return null;
  const batchId = safeProgressText(value.batchId);
  if (!batchId) return null;
  const item = normalizeProgressItem(value.item);
  const itemsReview = hasOwn(value, 'itemsReview')
    ? safeProgressCount(value.itemsReview)
    : undefined;
  return {
    type: 'server.batch.progress',
    batchId,
    status: normalizeBatchProgressStatus(value.status),
    itemsTotal: safeProgressCount(value.itemsTotal),
    itemsDone: safeProgressCount(value.itemsDone),
    ...(itemsReview !== undefined ? { itemsReview } : {}),
    itemsFailed: safeProgressCount(value.itemsFailed),
    itemsCancelled: safeProgressCount(value.itemsCancelled),
    ...(item ? { item } : {}),
  };
}

export function applyBatchProgressToRows<T extends BatchProgressRow>(
  rows: T[],
  rawFrame: BatchProgressFrame,
): T[] {
  const frame = normalizeBatchProgressFrame(rawFrame);
  if (!frame) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (row.batchId !== frame.batchId) return row;
    changed = true;
    return applyBatchCounters(row, frame);
  });
  return changed ? next : rows;
}

export function applyBatchProgressToDetail<T extends BatchProgressDetail>(
  detail: T,
  rawFrame: BatchProgressFrame,
): T {
  const frame = normalizeBatchProgressFrame(rawFrame);
  if (!frame) return detail;
  if (detail.batchId !== frame.batchId) return detail;
  const next = applyBatchCounters(detail, frame);
  if (!frame.item) return next;
  let itemChanged = false;
  const items = detail.items.map((item) => {
    if (item.batchItemId !== frame.item?.batchItemId) return item;
    itemChanged = true;
    return {
      ...item,
      status: frame.item.status,
      taskId: frame.item.taskId ?? item.taskId,
      errorMessage: frame.item.errorMessage ?? item.errorMessage,
    };
  });
  return itemChanged ? { ...next, items } : next;
}

function applyBatchCounters<T extends BatchProgressRow>(
  row: T,
  frame: BatchProgressFrame,
): T {
  return {
    ...row,
    status: frame.status,
    itemsTotal: frame.itemsTotal,
    itemsDone: frame.itemsDone,
    itemsReview: frame.itemsReview ?? row.itemsReview ?? 0,
    itemsFailed: frame.itemsFailed,
    itemsCancelled: frame.itemsCancelled ?? row.itemsCancelled ?? 0,
  };
}

function normalizeProgressItem(value: unknown): BatchProgressFrame['item'] | undefined {
  if (!isRecord(value)) return undefined;
  const batchItemId = safeProgressText(value.batchItemId);
  if (!batchItemId) return undefined;
  const taskId = safeProgressText(value.taskId);
  const errorMessage = safeProgressText(value.errorMessage);
  return {
    batchItemId,
    status: normalizeBatchItemProgressStatus(value.status),
    ...(taskId ? { taskId } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function normalizeBatchProgressStatus(value: unknown): string {
  const status = safeProgressText(value);
  return status || 'unknown';
}

function normalizeBatchItemProgressStatus(value: unknown): string {
  const status = safeProgressText(value);
  return status || 'unknown';
}

function safeProgressCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function safeProgressText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

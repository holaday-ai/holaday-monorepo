export interface BatchProgressRow {
  batchId: string;
  status: string;
  itemsTotal: number;
  itemsDone: number;
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
  itemsFailed: number;
  itemsCancelled?: number;
  item?: {
    batchItemId: string;
    status: string;
    taskId?: string;
    errorMessage?: string;
  };
}

export function applyBatchProgressToRows<T extends BatchProgressRow>(
  rows: T[],
  frame: BatchProgressFrame,
): T[] {
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
  frame: BatchProgressFrame,
): T {
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
    itemsFailed: frame.itemsFailed,
    itemsCancelled: frame.itemsCancelled ?? row.itemsCancelled ?? 0,
  };
}

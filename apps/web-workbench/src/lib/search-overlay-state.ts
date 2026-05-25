export interface SearchOverlayRow {
  readonly taskId: string;
  readonly intent: string;
  readonly title: string | null;
  readonly status: string;
}

export function searchOverlayErrorMessage(
  err: unknown,
  fallback = '搜索暂时不可用，请稍后重试。',
): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

export function searchOverlayStatusCopy({
  query,
  searching,
  error,
  resultCount,
}: {
  readonly query: string;
  readonly searching: boolean;
  readonly error: string | null;
  readonly resultCount: number;
}): { readonly title: string; readonly body: string; readonly retry: boolean } | null {
  if (!query.trim()) return null;
  if (error && resultCount > 0) {
    return {
      title: '搜索失败，正在显示上次结果',
      body: error,
      retry: true,
    };
  }
  if (error) {
    return {
      title: '搜索失败',
      body: error,
      retry: true,
    };
  }
  if (searching && resultCount > 0) {
    return {
      title: '正在刷新搜索结果…',
      body: '当前仍显示上次结果。',
      retry: false,
    };
  }
  return null;
}

export function nextSearchActiveIndex({
  current,
  direction,
  count,
}: {
  readonly current: number;
  readonly direction: 'up' | 'down';
  readonly count: number;
}): number {
  if (count <= 0) return 0;
  if (current < 0) return 0;
  if (direction === 'down') return Math.min(current + 1, count - 1);
  return Math.max(Math.min(current, count - 1) - 1, 0);
}

export function normalizeSearchOverlayRows(value: unknown): SearchOverlayRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = normalizeSearchOverlayRow(entry);
    return row ? [row] : [];
  });
}

function normalizeSearchOverlayRow(value: unknown): SearchOverlayRow | null {
  if (!isRecord(value)) return null;
  const taskId = safeSearchText(value.taskId);
  if (!taskId) return null;
  return {
    taskId,
    intent: safeSearchText(value.intent) || '未命名任务',
    title: safeNullableSearchText(value.title),
    status: normalizeSearchStatus(value.status),
  };
}

function normalizeSearchStatus(value: unknown): string {
  return value === 'queued' ||
    value === 'executing' ||
    value === 'awaiting_user' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'partial_success' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : 'queued';
}

function safeNullableSearchText(value: unknown): string | null {
  const text = safeSearchText(value);
  return text || null;
}

function safeSearchText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

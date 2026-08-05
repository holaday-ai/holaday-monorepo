import { pageErrorMessage } from './page-error-copy';

export interface NotificationListCursor {
  readonly id: number;
  readonly createdAt: string | Date;
}

export interface NormalizedNotificationRow {
  readonly notificationId: string;
  readonly type: string;
  readonly title: string;
  readonly message: string;
  readonly isRead: boolean;
  readonly createdAt: string | Date;
  readonly scheduledTaskInternalId: number | null;
}

export interface NormalizedNotificationPage {
  readonly items: NormalizedNotificationRow[];
  readonly nextCursor: NotificationListCursor | null;
}

export function normalizeNotificationPage(value: unknown): NormalizedNotificationPage {
  if (Array.isArray(value)) {
    return { items: normalizeNotificationRows(value), nextCursor: null };
  }
  if (!isRecord(value)) {
    throw new Error('通知暂时无法读取，请刷新后重试。');
  }
  return {
    items: normalizeNotificationRows(value.items),
    nextCursor: normalizeNotificationCursor(value.nextCursor),
  };
}

export function mergeNotificationRows(
  current: readonly NormalizedNotificationRow[],
  incoming: readonly NormalizedNotificationRow[],
): NormalizedNotificationRow[] {
  const merged = new Map(current.map((row) => [row.notificationId, row]));
  for (const row of incoming) merged.set(row.notificationId, row);
  return [...merged.values()];
}

function normalizeNotificationRows(value: unknown): NormalizedNotificationRow[] {
  if (!Array.isArray(value)) {
    throw new Error('通知暂时无法读取，请刷新后重试。');
  }
  return value.flatMap((row, index): NormalizedNotificationRow[] => {
    if (!isRecord(row)) return [];
    const notificationId = safeText(row.notificationId);
    if (!notificationId) return [];
    const scheduledTaskInternalId =
      typeof row.scheduledTaskInternalId === 'number' &&
      Number.isSafeInteger(row.scheduledTaskInternalId) &&
      row.scheduledTaskInternalId > 0
        ? row.scheduledTaskInternalId
        : null;
    const createdAt = safeDate(row.createdAt) ?? '';
    return [
      {
        notificationId,
        type: safeText(row.type) || 'unknown',
        title: safeText(row.title) || `通知 ${index + 1}`,
        message: typeof row.message === 'string' ? row.message : '',
        isRead: row.isRead === true,
        createdAt,
        scheduledTaskInternalId,
      },
    ];
  });
}

function normalizeNotificationCursor(value: unknown): NotificationListCursor | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const createdAt = safeDate(value.createdAt);
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && createdAt
    ? { id, createdAt }
    : null;
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeDate(value: unknown): string | Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && !Number.isNaN(new Date(trimmed).getTime()) ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function notificationListSummary({
  loading,
  error,
  count,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: unknown;
}): string {
  const safeCount = safeNotificationCount(count);
  if (loading && safeCount === 0) return '通知加载中…';
  if (error && safeCount > 0) return `刷新失败 · 显示 ${safeCount} 条通知`;
  if (error) return '通知暂时无法加载';
  if (safeCount === 0) return '暂无通知';
  return `${safeCount} 条通知`;
}

export function notificationListStatusCopy({
  loading,
  error,
  count,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: unknown;
}): { readonly title: string; readonly body: string } | null {
  const safeCount = safeNotificationCount(count);
  if (error && safeCount > 0) {
    return {
      title: '刷新失败，正在显示上次成功加载的通知',
      body: error,
    };
  }
  if (loading && safeCount === 0) {
    return {
      title: '通知加载中…',
      body: '正在读取最新任务通知。',
    };
  }
  return null;
}

export function notificationErrorMessage(err: unknown, fallback = '请稍后重试'): string {
  return pageErrorMessage(err, fallback);
}

export function notificationBadgeText(
  count: unknown,
  placement: 'sidebar-footer' | 'mobile-header' | 'topbar' = 'sidebar-footer',
): string {
  const safeCount = safeNotificationCount(count);
  if (safeCount <= 0) return '';
  if (placement === 'mobile-header' && safeCount > 9) return '';
  if (placement === 'sidebar-footer' && safeCount > 99) return '99+';
  return String(safeCount);
}

export function notificationButtonTitle(
  count: unknown,
  placement: 'sidebar-footer' | 'mobile-header' | 'topbar' = 'sidebar-footer',
): string | undefined {
  if (placement === 'topbar') return undefined;
  const safeCount = safeNotificationCount(count);
  return safeCount > 0 ? `通知，${safeCount} 条未读` : '通知';
}

export function shouldRenderCompactNotificationDot(
  count: unknown,
  placement: 'sidebar-footer' | 'mobile-header' | 'topbar' = 'sidebar-footer',
): boolean {
  return placement === 'mobile-header' && safeNotificationCount(count) > 9;
}

export function safeNotificationCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

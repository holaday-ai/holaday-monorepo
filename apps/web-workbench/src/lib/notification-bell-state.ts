import { pageErrorMessage } from './page-error-copy';

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
  placement: 'sidebar-footer' | 'mobile-header' = 'sidebar-footer',
): string {
  const safeCount = safeNotificationCount(count);
  if (safeCount <= 0) return '';
  if (placement === 'mobile-header' && safeCount > 9) return '';
  if (placement === 'sidebar-footer' && safeCount > 99) return '99+';
  return String(safeCount);
}

export function shouldRenderCompactNotificationDot(
  count: unknown,
  placement: 'sidebar-footer' | 'mobile-header' = 'sidebar-footer',
): boolean {
  return placement === 'mobile-header' && safeNotificationCount(count) > 9;
}

export function safeNotificationCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

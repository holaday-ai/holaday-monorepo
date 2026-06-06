/**
 * Phase 26B — global notification bell.
 *
 * Phase 26B follow-up — moved desktop from a fixed top-right viewport
 * position to an INLINE mount inside Sidebar's footer (next to the
 * UserMenu). Mobile keeps a header-safe floating mount because the
 * sidebar footer lives inside a drawer and would otherwise make
 * notifications unreachable.
 *
 * Polls `notification.unreadCount` every 30s for the badge. Dropdown
 * opens above-right of the button (since the bell sits at the
 * bottom of the sidebar).
 *
 * Visual:
 *   - 36×36 circle button, ghost on rest, accent on hover
 *   - Brand magenta badge bottom-right when unread > 0
 *   - Dropdown 360px wide, scrolls past ~6 rows
 *   - Smooth scale+opacity entrance (matches calendar popovers)
 */

import {
  AlertCircle,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import {
  notificationBadgeText,
  notificationErrorMessage,
  notificationListStatusCopy,
  notificationListSummary,
  safeNotificationCount,
  shouldRenderCompactNotificationDot,
} from '@/lib/notification-bell-state';

const POLL_INTERVAL_MS = 30_000;

interface NotificationRow {
  notificationId: string;
  type: 'task_started' | 'task_complete' | 'task_failed' | 'task_reminder' | string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string | Date;
  scheduledTaskInternalId: number | null;
}

type NotificationBellPlacement = 'sidebar-footer' | 'mobile-header';

interface NotificationBellProps {
  placement?: NotificationBellPlacement;
}

export function NotificationBell({
  placement = 'sidebar-footer',
}: NotificationBellProps): JSX.Element {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = React.useState<number>(0);
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [markingAll, setMarkingAll] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const mountedRef = React.useRef(false);
  const countRequestRef = React.useRef(0);
  const listRequestRef = React.useRef(0);

  // Poll the cheap COUNT query every 30s, plus an immediate fetch
  // on mount so the badge isn't stale on first render.
  const refreshCount = React.useCallback(async () => {
    const requestId = countRequestRef.current + 1;
    countRequestRef.current = requestId;
    try {
      const res = await trpc.notifications.unreadCount.query();
      if (!mountedRef.current || countRequestRef.current !== requestId) return;
      setUnreadCount(safeNotificationCount((res as { count?: unknown }).count));
    } catch {
      // Network blip — keep last value, retry next tick.
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void refreshCount();
    const id = window.setInterval(() => void refreshCount(), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      countRequestRef.current += 1;
      listRequestRef.current += 1;
      window.clearInterval(id);
    };
  }, [refreshCount]);

  // Outside-click + Esc dismissal when the dropdown is open.
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fetchList = React.useCallback(async () => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setLoading(true);
    try {
      const res = await trpc.notifications.list.query({ limit: 50 });
      if (!mountedRef.current || listRequestRef.current !== requestId) return;
      setItems(normalizeNotificationRows(res));
      setListError(null);
    } catch (err) {
      if (!mountedRef.current || listRequestRef.current !== requestId) return;
      setListError(notificationErrorMessage(err, '通知暂时无法加载，请稍后重试。'));
    } finally {
      if (mountedRef.current && listRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const handleToggle = React.useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) void fetchList();
      return next;
    });
  }, [fetchList]);

  const handleItemClick = React.useCallback(
    async (row: NotificationRow) => {
      const href = scheduledNotificationHref(row.scheduledTaskInternalId);
      if (href) {
        setOpen(false);
        navigate(href);
      }

      setActionError(null);
      // Mark read optimistically so the bell badge ticks down
      // before the round-trip resolves; reconcile on next poll
      // if the mutation fails. Navigation happens first so a slow
      // mark-read request never makes a notification feel dead.
      if (!row.isRead) {
        setItems((prev) =>
          prev.map((r) =>
            r.notificationId === row.notificationId ? { ...r, isRead: true } : r,
          ),
        );
        setUnreadCount((c) => Math.max(0, safeNotificationCount(c) - 1));
        try {
          await trpc.notifications.markRead.mutate({
            notificationId: row.notificationId,
          });
        } catch {
          setActionError('未能标记为已读，稍后会自动重新同步。');
          void refreshCount();
          if (open) void fetchList();
        }
      }
    },
    [fetchList, navigate, open, refreshCount],
  );

  const handleMarkAll = React.useCallback(async () => {
    if (markingAll || safeNotificationCount(unreadCount) <= 0) return;
    setActionError(null);
    setMarkingAll(true);
    setItems((prev) => prev.map((r) => ({ ...r, isRead: true })));
    setUnreadCount(0);
    try {
      await trpc.notifications.markAllRead.mutate();
    } catch {
      setActionError('全部已读失败，已恢复最新通知状态。');
      void refreshCount();
      void fetchList();
    } finally {
      setMarkingAll(false);
    }
  }, [fetchList, markingAll, refreshCount, unreadCount]);

  const safeUnreadCount = safeNotificationCount(unreadCount);
  const badge = notificationBadgeText(safeUnreadCount, placement);
  const hasUnread = safeUnreadCount > 0;
  const compactBadge = shouldRenderCompactNotificationDot(safeUnreadCount, placement);
  const summary = notificationListSummary({
    loading,
    error: listError,
    count: items.length,
  });
  const statusCopy = notificationListStatusCopy({
    loading,
    error: listError,
    count: items.length,
  });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-label={hasUnread ? `通知，${safeUnreadCount} 条未读` : '通知'}
        title={hasUnread ? `通知，${safeUnreadCount} 条未读` : '通知'}
        aria-expanded={open}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#DCDDDD]/60 bg-white/45 text-[#595757] shadow-[0_8px_22px_rgba(89,87,87,0.035)] transition-colors hover:border-[#EA1F59]/20 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] dark:border-white/10 dark:bg-white/[0.04] dark:text-foreground/70 dark:hover:border-[#EA1F59]/35 dark:hover:bg-[#EA1F59]/10',
          open && 'border-[#EA1F59]/25 bg-[#EA1F59]/5 text-[#EA1F59] shadow-[0_10px_26px_rgba(234,31,89,0.08)] dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10',
        )}
      >
        <Bell className="h-4 w-4" />
        {hasUnread && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute flex items-center justify-center rounded-full font-semibold text-white',
              compactBadge
                ? 'right-1 top-1 h-2 w-2'
                : '-right-0.5 -top-0.5 h-4 min-w-[16px] px-1 text-[10px]',
            )}
            style={{ backgroundColor: '#EA1F59' }}
          >
            {compactBadge ? null : badge}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'hd-popover-enter absolute z-50 overflow-hidden rounded-[8px] border border-[#DCDDDD]/85 bg-white shadow-[0_12px_32px_rgba(17,24,39,0.12)] dark:border-white/10 dark:bg-card',
            placement === 'mobile-header'
              ? 'right-0 top-full mt-1 w-[min(calc(100vw-24px),360px)] origin-top-right'
              : 'bottom-full left-full mb-1 ml-2 w-[360px] origin-bottom-left',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#DCDDDD]/80 px-3 py-2.5 dark:border-white/10">
            <div className="min-w-0">
              <span className="text-sm font-medium">通知</span>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{summary}</div>
            </div>
            {hasUnread && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void handleMarkAll()}
                disabled={markingAll}
                className="h-7 rounded-[6px] px-2 text-xs hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] dark:hover:bg-white/10"
              >
                {markingAll ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <CheckCheck className="mr-1 h-3 w-3" aria-hidden />
                )}
                {markingAll ? '同步中…' : '全部已读'}
              </Button>
            )}
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {actionError && (
              <div className="border-b border-[#EA1F59]/20 bg-[#EA1F59]/10 px-3 py-2 text-xs leading-5 text-[#EA1F59] dark:border-[#EA1F59]/30">
                {actionError}
              </div>
            )}
            {statusCopy && (
              <NotificationStatusNotice
                copy={statusCopy}
                loading={loading}
                onRetry={() => void fetchList()}
              />
            )}
            {loading && items.length === 0 ? (
              <NotificationSkeleton />
            ) : items.length === 0 ? (
              listError ? (
                <NotificationHardError
                  message={listError}
                  onRetry={() => void fetchList()}
                />
              ) : (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  还没有通知
                </div>
              )
            ) : (
              items.map((row) => (
                <NotificationItem
                  key={row.notificationId}
                  row={row}
                  onClick={() => void handleItemClick(row)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeNotificationRows(value: unknown): NotificationRow[] {
  if (!Array.isArray(value)) {
    throw new Error('通知暂时无法读取，请刷新后重试。');
  }
  return value.flatMap((row, index): NotificationRow[] => {
    if (typeof row !== 'object' || row === null) return [];
    const raw = row as Record<string, unknown>;
    const notificationId =
      typeof raw.notificationId === 'string' && raw.notificationId.trim()
        ? raw.notificationId
        : null;
    if (!notificationId) return [];
    const scheduledTaskInternalId =
      typeof raw.scheduledTaskInternalId === 'number' &&
      Number.isSafeInteger(raw.scheduledTaskInternalId) &&
      raw.scheduledTaskInternalId > 0
        ? raw.scheduledTaskInternalId
        : null;
    const createdAt =
      typeof raw.createdAt === 'string' || raw.createdAt instanceof Date
        ? raw.createdAt
        : '';
    return [
      {
        notificationId,
        type: typeof raw.type === 'string' ? raw.type : 'unknown',
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : `通知 ${index + 1}`,
        message: typeof raw.message === 'string' ? raw.message : '',
        isRead: raw.isRead === true,
        createdAt,
        scheduledTaskInternalId,
      },
    ];
  });
}

function NotificationStatusNotice({
  copy,
  loading,
  onRetry,
}: {
  copy: { readonly title: string; readonly body: string };
  loading: boolean;
  onRetry(): void;
}): JSX.Element {
  const isError = copy.title.includes('失败');
  return (
    <div className="border-b border-[#DCDDDD]/70 px-3 py-2.5 dark:border-white/10">
      <div className="flex items-start gap-2">
        {isError ? (
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EA1F59]" aria-hidden />
        ) : (
          <Loader2
            className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground/85">{copy.title}</div>
          <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{copy.body}</div>
        </div>
        {isError && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={loading}
            className="h-7 rounded-[6px] border-[#DCDDDD]/75 px-2 text-xs text-[#595757] hover:border-[#EA1F59]/25 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59]"
          >
            {loading ? '重试中…' : '重试'}
          </Button>
        )}
      </div>
    </div>
  );
}

function NotificationHardError({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}): JSX.Element {
  return (
    <div className="px-3 py-8 text-center">
      <AlertCircle className="mx-auto h-7 w-7 text-[#EA1F59]" aria-hidden />
      <div className="mt-2 text-sm font-medium text-foreground/85">通知暂时无法加载</div>
      <div className="mx-auto mt-1 max-w-[260px] text-xs leading-5 text-muted-foreground">
        {message}
      </div>
      <Button type="button" size="sm" className="mt-3" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

function NotificationSkeleton(): JSX.Element {
  return (
    <div className="space-y-3 px-3 py-4">
      {[0, 1, 2].map((idx) => (
        <div key={idx} className="flex items-start gap-2.5">
          <div className="h-5 w-5 shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-3 w-56 max-w-full rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationItem({
  row,
  onClick,
}: {
  row: NotificationRow;
  onClick: () => void;
}): JSX.Element {
  const icon = TYPE_ICON[row.type] ?? <Bell className="h-3 w-3" />;
  const color = notificationColor(row.type);
  // BOSS bug fix — row was tinted with bg-accent/30 (pink in this
  // theme) for unread, which clashed with the popover's neutral
  // card background. Switched to a tiny leading magenta dot for
  // the unread indicator + a neutral hover state. Matches the
  // Cmd+K / DropdownMenu visual language in the rest of the app.
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 border-b border-[#DCDDDD]/70 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[#EA1F59]/5 dark:border-white/10 dark:hover:bg-white/10"
    >
      <span
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] text-white"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm text-foreground',
              !row.isRead && 'font-semibold',
            )}
          >
            {row.title}
          </span>
          <span className="flex-shrink-0 text-[11px] text-muted-foreground">
            {formatRelative(row.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {row.message}
        </p>
      </div>
      {!row.isRead && (
        <span
          className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: '#EA1F59' }}
          aria-label="未读"
        />
      )}
    </button>
  );
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  task_started: <Play className="h-3 w-3" />,
  task_complete: <CheckCircle2 className="h-3 w-3" />,
  task_failed: <XCircle className="h-3 w-3" />,
  task_reminder: <BellRing className="h-3 w-3" />,
};

export function notificationColor(type: string): string {
  if (type === 'task_failed') return '#EA1F59';
  if (type === 'task_complete') return '#42C0EF';
  if (type === 'task_reminder') return '#EA1F59';
  if (type === 'task_started') return '#FFC910';
  return '#ADADAD';
}

export function scheduledNotificationHref(
  scheduledTaskInternalId: number | null,
): string | null {
  if (scheduledTaskInternalId === null) return null;
  if (!Number.isSafeInteger(scheduledTaskInternalId) || scheduledTaskInternalId <= 0) {
    return null;
  }
  return `/scheduled?focusScheduledTaskInternalId=${encodeURIComponent(
    String(scheduledTaskInternalId),
  )}`;
}

/**
 * Format an ISO timestamp as a Chinese relative time. Pure function.
 * Exported via the test file for unit coverage.
 */
export function formatRelative(at: string | Date, now: Date = new Date()): string {
  const t = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(t.getTime())) return '';
  const diffMs = now.getTime() - t.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 30) return '刚刚';
  if (diffSec < 60) return `${diffSec}秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return `${diffDay}天前`;
  return t.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

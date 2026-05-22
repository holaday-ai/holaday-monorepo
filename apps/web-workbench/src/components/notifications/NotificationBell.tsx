/**
 * Phase 26B — global notification bell.
 *
 * Phase 26B follow-up — moved from a fixed top-right viewport
 * position to an INLINE mount inside Sidebar's footer (next to the
 * UserMenu). The previous fixed position collided with per-page
 * CTAs (notably /scheduled's "新建定时任务" button). Inline + sidebar
 * means the bell is global (every page renders the sidebar) and
 * can't overlap page content.
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

import { Bell, CheckCheck } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';

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

export function NotificationBell(): JSX.Element {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = React.useState<number>(0);
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  // Poll the cheap COUNT query every 30s, plus an immediate fetch
  // on mount so the badge isn't stale on first render.
  const refreshCount = React.useCallback(async () => {
    try {
      const res = await trpc.notifications.unreadCount.query();
      setUnreadCount(res.count);
    } catch {
      // Network blip — keep last value, retry next tick.
    }
  }, []);

  React.useEffect(() => {
    void refreshCount();
    const id = window.setInterval(() => void refreshCount(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
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
    setLoading(true);
    try {
      const res = await trpc.notifications.list.query({ limit: 50 });
      setItems(res as NotificationRow[]);
    } catch {
      // Surface nothing — empty list is the worst case.
    } finally {
      setLoading(false);
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
      // Mark read optimistically so the bell badge ticks down
      // before the round-trip resolves; reconcile on next poll
      // if the mutation fails.
      if (!row.isRead) {
        setItems((prev) =>
          prev.map((r) =>
            r.notificationId === row.notificationId ? { ...r, isRead: true } : r,
          ),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
        try {
          await trpc.notifications.markRead.mutate({
            notificationId: row.notificationId,
          });
        } catch {
          void refreshCount();
        }
      }
      const href = scheduledNotificationHref(row.scheduledTaskInternalId);
      if (href) {
        setOpen(false);
        navigate(href);
      }
    },
    [navigate, refreshCount],
  );

  const handleMarkAll = React.useCallback(async () => {
    setItems((prev) => prev.map((r) => ({ ...r, isRead: true })));
    setUnreadCount(0);
    try {
      await trpc.notifications.markAllRead.mutate();
    } catch {
      void refreshCount();
      void fetchList();
    }
  }, [fetchList, refreshCount]);

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);
  const hasUnread = unreadCount > 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        aria-label="通知"
        aria-expanded={open}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground',
          open && 'bg-foreground/5 text-foreground',
        )}
      >
        <Bell className="h-4 w-4" />
        {hasUnread && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
            style={{ backgroundColor: '#E50B6B' }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          /* Bell lives in the sidebar footer (bottom-left of the
             viewport); open the dropdown to the RIGHT of the button
             and anchored to the bell's vertical position. left-full
             ml-2 places it just outside the sidebar boundary. */
          className="hd-popover-enter absolute bottom-full left-full z-50 mb-1 ml-2 w-[360px] origin-bottom-left rounded-lg border border-border bg-popover shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">通知</span>
            {hasUnread && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void handleMarkAll()}
                className="h-7 px-2 text-xs"
              >
                <CheckCheck className="mr-1 h-3 w-3" />
                全部已读
              </Button>
            )}
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                加载中…
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                还没有通知
              </div>
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

function NotificationItem({
  row,
  onClick,
}: {
  row: NotificationRow;
  onClick: () => void;
}): JSX.Element {
  const icon = TYPE_ICON[row.type] ?? '·';
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
      className="flex w-full items-start gap-2.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-foreground/[0.04]"
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
          style={{ backgroundColor: '#E50B6B' }}
          aria-label="未读"
        />
      )}
    </button>
  );
}

const TYPE_ICON: Record<string, string> = {
  task_started: '▶',
  task_complete: '✓',
  task_failed: '✗',
  task_reminder: '⏰',
};

export function notificationColor(type: string): string {
  if (type === 'task_failed') return '#EF4444';
  if (type === 'task_complete') return '#10B981';
  if (type === 'task_reminder') return '#E50B6B';
  if (type === 'task_started') return '#F59E0B';
  return '#94A3B8';
}

export function scheduledNotificationHref(
  scheduledTaskInternalId: number | null,
): string | null {
  if (scheduledTaskInternalId === null) return null;
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

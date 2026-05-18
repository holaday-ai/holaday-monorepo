/**
 * Phase 27 — shared helpers for admin pages.
 *
 * Status badge tokens deliberately mirror the calendar event-mapping
 * palette so an admin reading the dashboard recognises the same
 * color language they see on /scheduled.
 */

export const ADMIN_MAGENTA = '#E50B6B';
export const ADMIN_MAGENTA_SOFT = 'rgba(229,11,107,0.12)';

interface StatusToken {
  label: string;
  textClass: string;
  bgClass: string;
}

const STATUS_MAP: Record<string, StatusToken> = {
  completed: {
    label: '已完成',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    bgClass: 'bg-emerald-50 dark:bg-emerald-500/15',
  },
  failed: {
    label: '失败',
    textClass: 'text-red-700 dark:text-red-300',
    bgClass: 'bg-red-50 dark:bg-red-500/15',
  },
  cancelled: {
    label: '已取消',
    textClass: 'text-zinc-600 dark:text-zinc-300',
    bgClass: 'bg-zinc-100 dark:bg-zinc-500/15',
  },
  running: {
    label: '执行中',
    textClass: 'text-amber-700 dark:text-amber-300',
    bgClass: 'bg-amber-50 dark:bg-amber-500/15',
  },
  executing: {
    label: '执行中',
    textClass: 'text-amber-700 dark:text-amber-300',
    bgClass: 'bg-amber-50 dark:bg-amber-500/15',
  },
  planning: {
    label: '规划中',
    textClass: 'text-blue-700 dark:text-blue-300',
    bgClass: 'bg-blue-50 dark:bg-blue-500/15',
  },
  awaiting_user: {
    label: '等待用户',
    textClass: 'text-purple-700 dark:text-purple-300',
    bgClass: 'bg-purple-50 dark:bg-purple-500/15',
  },
  paused: {
    label: '已暂停',
    textClass: 'text-zinc-600 dark:text-zinc-300',
    bgClass: 'bg-zinc-100 dark:bg-zinc-500/15',
  },
  pending: {
    label: '排队中',
    textClass: 'text-zinc-600 dark:text-zinc-300',
    bgClass: 'bg-zinc-100 dark:bg-zinc-500/15',
  },
};

export function statusToken(status: string): StatusToken {
  return (
    STATUS_MAP[status] ?? {
      label: status,
      textClass: 'text-zinc-600 dark:text-zinc-300',
      bgClass: 'bg-zinc-100 dark:bg-zinc-500/15',
    }
  );
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return remSec ? `${minutes}分${remSec}秒` : `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin ? `${hours}小时${remMin}分` : `${hours}小时`;
}

export function formatDateTime(at: string | Date | null): string {
  if (!at) return '—';
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDate(at: string | Date | null): string {
  if (!at) return '—';
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
}

/** Truncate a string to `max` chars with an ellipsis. */
export function truncate(s: string | null | undefined, max = 60): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Day-over-day delta percentage. Returns null when prev is unset or zero. */
export function dayDelta(value: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  return ((value - prev) / prev) * 100;
}

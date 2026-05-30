/**
 * Phase 27 — shared helpers for admin pages.
 *
 * Status badge tokens deliberately mirror the calendar event-mapping
 * palette so an admin reading the dashboard recognises the same
 * color language they see on /scheduled.
 */

import * as React from 'react';

export const ADMIN_MAGENTA = '#EA1F59';
export const ADMIN_MAGENTA_SOFT = 'rgba(234,31,89,0.12)';
export const ADMIN_BORDER = '#DCDDDD';
export const ADMIN_DIVIDER = '#EFEFEF';
export const ADMIN_TEXT_MUTED = '#595757';

type UnknownRecord = Record<string, unknown>;

interface StatusToken {
  label: string;
  textClass: string;
  bgClass: string;
}

const STATUS_MAP: Record<string, StatusToken> = {
  completed: {
    label: '已完成',
    textClass: 'text-[#1688AA]',
    bgClass: 'bg-[#42C0EF]/10',
  },
  partial_success: {
    label: '部分完成',
    textClass: 'text-[#8A6A00]',
    bgClass: 'bg-[#FFC910]/20',
  },
  failed: {
    label: '失败',
    textClass: 'text-[#EA1F59]',
    bgClass: 'bg-[#EA1F59]/10',
  },
  cancelled: {
    label: '已取消',
    textClass: 'text-[#595757]',
    bgClass: 'bg-[#EFEFEF]',
  },
  running: {
    label: '执行中',
    textClass: 'text-[#8A6A00]',
    bgClass: 'bg-[#FFC910]/20',
  },
  executing: {
    label: '执行中',
    textClass: 'text-[#8A6A00]',
    bgClass: 'bg-[#FFC910]/20',
  },
  planning: {
    label: '规划中',
    textClass: 'text-[#57479C]',
    bgClass: 'bg-[#57479C]/10',
  },
  awaiting_user: {
    label: '等待用户',
    textClass: 'text-[#57479C]',
    bgClass: 'bg-[#57479C]/10',
  },
  paused: {
    label: '已暂停',
    textClass: 'text-[#595757]',
    bgClass: 'bg-[#EFEFEF]',
  },
  pending: {
    label: '排队中',
    textClass: 'text-[#595757]',
    bgClass: 'bg-[#EFEFEF]',
  },
};

export function statusToken(status: string): StatusToken {
  if (!status) {
    return {
      label: '未知',
      textClass: 'text-[#595757]',
      bgClass: 'bg-[#EFEFEF]',
    };
  }
  return (
    STATUS_MAP[status] ?? {
      label: status,
      textClass: 'text-[#595757]',
      bgClass: 'bg-[#EFEFEF]',
    }
  );
}

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function safeArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function finiteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function nullableFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = finiteNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nonNegativeNumber(value: unknown, fallback = 0): number {
  return Math.max(0, finiteNumber(value, fallback));
}

export function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  const parsed = finiteNumber(value, fallback);
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

export function safeText(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function formatInteger(value: unknown): string {
  return nonNegativeNumber(value).toLocaleString('zh-CN');
}

export function formatDurationMs(ms: number | null): string {
  const parsed = nullableFiniteNumber(ms);
  if (parsed == null || parsed <= 0) return '—';
  const seconds = Math.round(parsed / 1000);
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
  const value = typeof s === 'string' ? s : '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Day-over-day delta percentage. Returns null when prev is unset or zero. */
export function dayDelta(value: number, prev: number | null | undefined): number | null {
  const current = finiteNumber(value, 0);
  const previous = nullableFiniteNumber(prev);
  if (previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function useMountedRef(): React.MutableRefObject<boolean> {
  const mountedRef = React.useRef(false);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

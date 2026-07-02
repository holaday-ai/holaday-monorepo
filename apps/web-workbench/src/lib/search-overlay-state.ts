import { pageErrorMessage } from './page-error-copy';
import type { AwaitingKind } from './awaiting-user-copy';
import { deriveTaskProductState } from './task-product-state';

export interface SearchOverlayRow {
  readonly taskId: string;
  readonly intent: string;
  readonly title: string | null;
  readonly status: string;
  readonly awaitingKind: AwaitingKind | null;
}

export function searchOverlayErrorMessage(
  err: unknown,
  fallback = '搜索暂时不可用，请稍后重试。',
): string {
  return pageErrorMessage(err, fallback);
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

export function searchOverlayRowCopy(
  row: Pick<SearchOverlayRow, 'awaitingKind' | 'intent' | 'status' | 'title'>,
): { readonly title: string; readonly secondary: string } {
  const title = row.title && row.title.trim().length > 0 ? row.title : row.intent;
  return {
    title,
    secondary: title === row.intent ? '' : row.intent,
  };
}

type SearchOverlayProductStateInput =
  | string
  | {
      readonly status: string;
      readonly awaitingKind?: AwaitingKind | null;
    };

function toSearchOverlayProductState(input: SearchOverlayProductStateInput) {
  return typeof input === 'string'
    ? deriveTaskProductState({ status: input })
    : deriveTaskProductState({
        status: input.status,
        awaitingKind: input.awaitingKind ?? null,
      });
}

export function searchOverlayNeedsAttention(
  input: SearchOverlayProductStateInput,
): boolean {
  return toSearchOverlayProductState(input).lifecycle === 'waiting_user';
}

/**
 * Subtle resting tone (faint left border + tint) so a failed / partial /
 * cancelled row is scannable without the strong awaiting highlight. Applied
 * only when the row is NOT the active (keyboard-focused) row and NOT
 * awaiting_user — those two keep their existing stronger styles. Empty
 * string for completed / running so they stay neutral. P2-B.
 */
export function searchOverlayRowTone(input: SearchOverlayProductStateInput): string {
  const state = toSearchOverlayProductState(input);
  if (state.lifecycle !== 'terminal') return '';
  if (state.outcome === 'failed') {
    return 'bg-[#EA1F59]/[0.035] shadow-[inset_3px_0_0_rgba(234,31,89,0.4)]';
  }
  if (state.outcome === 'partial_success') {
    return 'bg-[#FFC910]/[0.05] shadow-[inset_3px_0_0_rgba(255,201,16,0.5)]';
  }
  if (state.outcome === 'cancelled') {
    return 'shadow-[inset_3px_0_0_rgba(89,87,87,0.28)]';
  }
  return '';
}

export function searchOverlayStatusTone(input: SearchOverlayProductStateInput): string {
  const state = toSearchOverlayProductState(input);
  if (state.lifecycle === 'waiting_user') return 'bg-[#FFC910]/20 text-[#8A6A00]';
  if (state.lifecycle === 'paused') return 'bg-[#EFEFEF] text-[#595757]';
  if (state.lifecycle === 'unknown') return 'bg-[#EFEFEF] text-[#595757]';
  if (state.lifecycle !== 'terminal') return 'bg-[#57479C]/10 text-[#57479C]';
  if (state.outcome === 'completed') return 'bg-[#42C0EF]/10 text-[#1688AA]';
  if (state.outcome === 'failed') return 'bg-[#EA1F59]/10 text-[#EA1F59]';
  if (state.outcome === 'partial_success') return 'bg-[#FFC910]/20 text-[#8A6A00]';
  if (state.outcome === 'cancelled') return 'bg-[#EFEFEF] text-[#595757]';
  return 'bg-[#EFEFEF] text-[#595757]';
}

/**
 * Whether the search overlay's "retry" affordance may fire. A retry is
 * only meaningful once the in-flight request has settled — firing it
 * mid-search just bumps the request nonce, which resets the 300ms
 * debounce and pushes the result further out, so on a flaky connection
 * impatient re-taps make the search feel *more* stuck. Gate both the
 * button (`disabled`) and the handler on this, matching the
 * `disabled={loading}` guard every other retry / load-more button in
 * the app already uses.
 */
export function searchOverlayCanRetry(searching: boolean): boolean {
  return !searching;
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
    awaitingKind: normalizeAwaitingKind(value.awaitingKind),
  };
}

function normalizeSearchStatus(value: unknown): string {
  const status = safeSearchText(value);
  return status || 'unknown';
}

function safeNullableSearchText(value: unknown): string | null {
  const text = safeSearchText(value);
  return text || null;
}

function normalizeAwaitingKind(value: unknown): AwaitingKind | null {
  return value === 'clarification' ||
    value === 'login' ||
    value === 'captcha' ||
    value === 'permission' ||
    value === 'browser_action' ||
    value === 'video_quote'
    ? value
    : null;
}

function safeSearchText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

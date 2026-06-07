import { AlertCircle, Loader2, RotateCw, Search, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  nextSearchActiveIndex,
  normalizeSearchOverlayRows,
  searchOverlayCanRetry,
  searchOverlayErrorMessage,
  searchOverlayNeedsAttention,
  searchOverlayRowCopy,
  searchOverlayStatusCopy,
  type SearchOverlayRow,
} from '@/lib/search-overlay-state';
import {
  taskSearchEmptyCopy,
  taskStatusLabel,
} from '@/lib/task-status-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { UiTask } from '@/types/task';

interface Props {
  open: boolean;
  /**
   * Recent task list from the store — used as the initial cold-state
   * when the user opens the palette without typing. Once a query lands,
   * the server-side search results take over.
   */
  tasks: UiTask[];
  onClose(): void;
  onPick(taskId: string): void;
}

/**
 * Cmd/Ctrl+K palette — a modal list over the whole app. Empty input
 * shows the recent task list from the store; typing kicks off a 300 ms
 * debounced server-side search via `tasks.list({ query, limit: 20 })`
 * so matches outside the sidebar's first-50 slice are still findable.
 */
export function SearchOverlay({ open, tasks, onClose, onPick }: Props): JSX.Element | null {
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [serverResults, setServerResults] = React.useState<SearchOverlayRow[]>([]);
  const [resultQuery, setResultQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchNonce, setSearchNonce] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const resultQueryRef = React.useRef('');

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setServerResults([]);
    setResultQuery('');
    resultQueryRef.current = '';
    setSearching(false);
    setSearchError(null);
    setSearchNonce(0);
    // Focus after mount so the browser accepts the focus call.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Debounce server-side search by 300 ms so each keystroke isn't a
  // network round-trip. Bumping the request token in the trailing
  // closure lets a stale response silently lose to a newer one — tRPC
  // doesn't ship cancellation through query() so we gate the setState
  // on token equality instead.
  const requestToken = React.useRef(0);
  React.useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setServerResults([]);
      setResultQuery('');
      resultQueryRef.current = '';
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const myToken = ++requestToken.current;
    const handle = window.setTimeout(() => {
      void trpc.tasks.list
        .query({ query: trimmed, limit: 20 })
        .then((res) => {
          if (myToken !== requestToken.current) return;
          setServerResults(normalizeSearchOverlayRows(res?.tasks));
          setResultQuery(trimmed);
          resultQueryRef.current = trimmed;
          setSearching(false);
          setSearchError(null);
        })
        .catch((err) => {
          if (myToken !== requestToken.current) return;
          if (resultQueryRef.current !== trimmed) {
            setServerResults([]);
            setResultQuery('');
            resultQueryRef.current = '';
          }
          setSearching(false);
          setSearchError(searchOverlayErrorMessage(err));
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [open, query, searchNonce]);

  const filtered: SearchOverlayRow[] = React.useMemo(() => {
    if (!query.trim()) {
      // Cold palette: show the most recent loaded tasks so the user
      // has somewhere to land before typing.
      return tasks.slice(0, 30).map((t) => ({
        taskId: t.taskId,
        intent: t.intent,
        title: t.title,
        status: t.status,
        awaitingKind: t.awaitingKind ?? null,
      }));
    }
    return resultQuery === query.trim() ? serverResults : [];
  }, [query, tasks, serverResults, resultQuery]);

  React.useEffect(() => {
    if (filtered.length === 0 && active !== 0) setActive(0);
    else if (active < 0 || active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  if (!open) return null;
  const emptyCopy = taskSearchEmptyCopy({
    query,
    searching,
    error: searchError !== null,
  });
  const statusCopy = searchOverlayStatusCopy({
    query,
    searching,
    error: searchError,
    resultCount: filtered.length,
  });
  // Only let a retry fire once the in-flight search has settled —
  // re-firing mid-search resets the 300ms debounce and delays the
  // result, matching the disabled={loading} guard used elsewhere.
  const canRetry = searchOverlayCanRetry(searching);
  const retrySearch = (): void => {
    if (!canRetry) return;
    setSearchNonce((n) => n + 1);
  };

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) =>
        nextSearchActiveIndex({ current: i, direction: 'down', count: filtered.length }),
      );
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) =>
        nextSearchActiveIndex({ current: i, direction: 'up', count: filtered.length }),
      );
      return;
    }
    if (e.key === 'Enter') {
      // Phase 4 R2 4c — composing-Enter guard. Without it, a Chinese
      // search like "复盘" would fire the picker as soon as the IME
      // commits the first 复, losing 盘.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      const pick = filtered[active];
      if (pick) {
        onPick(pick.taskId);
        onClose();
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/25 p-4 pt-20 backdrop-blur-sm animate-fade-in sm:pt-24"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-center gap-2 border-b border-[#EFEFEF] px-3 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#EA1F59]/10 text-[#EA1F59]">
            <Search className="h-4 w-4" />
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="搜索任务…"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#EA1F59]" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-1.5">
          {statusCopy && filtered.length > 0 && (
            <li className="mb-1.5 rounded-[8px] border border-[#EA1F59]/20 bg-[#EA1F59]/5 px-3 py-2 text-xs text-[#EA1F59]">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{statusCopy.title}</div>
                  <div className="mt-0.5 truncate opacity-80" title={statusCopy.body}>
                    {statusCopy.body}
                  </div>
                </div>
                {statusCopy.retry && (
                  <button
                    type="button"
                    onClick={retrySearch}
                    disabled={!canRetry}
                    aria-label="重试搜索"
                    title="重试搜索"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#EA1F59]/20 text-[#EA1F59] transition-colors hover:bg-[#EA1F59]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          )}
          {filtered.length === 0 && (
            <li className="px-4 py-7 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#EFEFEF] text-muted-foreground">
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </div>
              <div className="mt-3 text-sm font-medium text-foreground/80">
                {searching ? '正在搜索…' : emptyCopy.title}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {emptyCopy.body}
              </div>
              {statusCopy?.retry && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={retrySearch}
                  disabled={!canRetry}
                  aria-label="重试搜索"
                  title="重试搜索"
                  className="mt-3 h-8 w-8 rounded-[8px] border-[#DCDDDD] hover:border-[#EA1F59]/40 hover:text-[#EA1F59]"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </li>
          )}
          {filtered.map((t, i) => {
            const copy = searchOverlayRowCopy(t);
            const needsAttention = searchOverlayNeedsAttention(t.status);
            return (
              <li key={t.taskId}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onPick(t.taskId);
                    onClose();
                  }}
                  className={cn(
                    'group flex w-full items-start gap-3 rounded-[8px] border border-transparent px-3 py-2.5 text-left transition-colors',
                    needsAttention &&
                      'border-[#FFC910]/35 bg-[#FFC910]/[0.07] shadow-[inset_3px_0_0_rgba(255,201,16,0.75)]',
                    i === active && !needsAttention
                      ? 'border-[#EA1F59]/20 bg-[#EA1F59]/10 shadow-[inset_3px_0_0_#EA1F59]'
                      : needsAttention
                        ? 'hover:bg-[#FFC910]/[0.12]'
                        : 'hover:bg-[#EFEFEF]/60',
                    i === active &&
                      needsAttention &&
                      'border-[#FFC910]/60 bg-[#FFC910]/[0.13]',
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#EFEFEF] text-muted-foreground transition-colors group-hover:text-[#EA1F59]',
                      needsAttention && 'bg-[#FFC910]/20 text-[#8A6A00] group-hover:text-[#8A6A00]',
                    )}
                  >
                    <Search className="h-3.5 w-3.5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {copy.title}
                    </span>
                    {copy.secondary && (
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {copy.secondary}
                      </span>
                    )}
                  </div>
                  <SearchStatusBadge status={t.status} awaitingKind={t.awaitingKind} />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-end gap-2 border-t border-[#EFEFEF] bg-[#EFEFEF]/35 px-3 py-2 text-[10px] text-muted-foreground">
          {filtered.length > 0 && (
            <>
              <KeyHint>↑↓ 选择</KeyHint>
              <KeyHint>Enter 打开</KeyHint>
            </>
          )}
          <KeyHint>Esc 关闭</KeyHint>
        </div>
      </div>
    </div>
  );
}

function SearchStatusBadge({
  status,
  awaitingKind,
}: {
  status: string;
  awaitingKind?: SearchOverlayRow['awaitingKind'];
}): JSX.Element {
  return (
    <span
      className={cn(
        'mt-0.5 inline-flex min-h-6 shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        searchStatusTone(status),
      )}
    >
      {taskStatusLabel(status, awaitingKind)}
    </span>
  );
}

function searchStatusTone(status: string): string {
  if (status === 'completed') return 'bg-[#42C0EF]/10 text-[#1688AA]';
  if (status === 'failed') return 'bg-[#EA1F59]/10 text-[#EA1F59]';
  if (status === 'partial_success') return 'bg-[#FFC910]/20 text-[#8A6A00]';
  if (status === 'awaiting_user') return 'bg-[#FFC910]/20 text-[#8A6A00]';
  if (status === 'cancelled') return 'bg-[#EFEFEF] text-[#595757]';
  if (status === 'executing' || status === 'queued') {
    return 'bg-[#57479C]/10 text-[#57479C]';
  }
  return 'bg-[#EFEFEF] text-[#595757]';
}

function KeyHint({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="rounded-[6px] border border-[#DCDDDD] bg-white px-1.5 py-0.5">
      {children}
    </span>
  );
}

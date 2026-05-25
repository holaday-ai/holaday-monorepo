import { AlertCircle, Loader2, RotateCw, Search, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  nextSearchActiveIndex,
  normalizeSearchOverlayRows,
  searchOverlayErrorMessage,
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
  const retrySearch = (): void => setSearchNonce((n) => n + 1);

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
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-4 pt-24 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="搜索任务…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-0.5 text-muted-foreground hover:bg-foreground/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1">
          {statusCopy && filtered.length > 0 && (
            <li className="mb-1 rounded-md border border-border/60 bg-primary/5 px-3 py-2 text-xs text-primary">
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
                    className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-primary/20 px-2 text-[11px] hover:bg-primary/10"
                  >
                    <RotateCw className="h-3 w-3" />
                    重试
                  </button>
                )}
              </div>
            </li>
          )}
          {filtered.length === 0 && (
            <li className="px-4 py-7 text-center">
              <div className="text-sm font-medium text-foreground/80">
                {emptyCopy.title}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {emptyCopy.body}
              </div>
              {statusCopy?.retry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retrySearch}
                  className="mt-3 h-8"
                >
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                  重试搜索
                </Button>
              )}
            </li>
          )}
          {filtered.map((t, i) => (
            <li key={t.taskId}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onPick(t.taskId);
                  onClose();
                }}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors',
                  i === active ? 'bg-foreground/5' : 'hover:bg-foreground/5',
                )}
              >
                <span className="truncate text-sm text-foreground">
                  {t.title && t.title.trim().length > 0 ? t.title : t.intent}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {taskStatusLabel(t.status)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-3 border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          {filtered.length > 0 && (
            <>
              <span>↑↓ 选择</span>
              <span>Enter 打开</span>
            </>
          )}
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}

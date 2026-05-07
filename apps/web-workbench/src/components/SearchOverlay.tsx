import { Loader2, Search, X } from 'lucide-react';
import * as React from 'react';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { UiTask, UiTaskStatus } from '@/types/task';

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

interface ServerTaskRow {
  taskId: string;
  intent: string;
  title: string | null;
  status: UiTaskStatus;
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
  const [serverResults, setServerResults] = React.useState<ServerTaskRow[]>([]);
  const [searching, setSearching] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setServerResults([]);
    setSearching(false);
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
      setSearching(false);
      return;
    }
    setSearching(true);
    const myToken = ++requestToken.current;
    const handle = window.setTimeout(() => {
      void trpc.tasks.list
        .query({ query: trimmed, limit: 20 })
        .then((res) => {
          if (myToken !== requestToken.current) return;
          setServerResults(
            res.tasks.map((t) => ({
              taskId: t.taskId,
              intent: t.intent,
              title: t.title,
              status: t.status as UiTaskStatus,
            })),
          );
          setSearching(false);
        })
        .catch(() => {
          if (myToken !== requestToken.current) return;
          setServerResults([]);
          setSearching(false);
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [open, query]);

  const filtered: ServerTaskRow[] = React.useMemo(() => {
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
    return serverResults;
  }, [query, tasks, serverResults]);

  React.useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
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
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">
              没有匹配的任务
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
                  {statusLabel(t.status)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-3 border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: UiTask['status']): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'executing':
      return '执行中';
    case 'awaiting_user':
      return '等待你回复';
    case 'paused':
      return '已暂停';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return '';
  }
}

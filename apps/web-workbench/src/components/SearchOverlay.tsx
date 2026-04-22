import { Search, X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { UiTask } from '@/types/task';

interface Props {
  open: boolean;
  tasks: UiTask[];
  onClose(): void;
  onPick(taskId: string): void;
}

/**
 * Cmd/Ctrl+K palette — a modal list over the whole app. Searches the
 * current task list's intent text (plain substring, case-insensitive)
 * and lets the user jump to the first match with Enter or click a row.
 * Small on-purpose: we don't paginate or fetch server-side yet.
 */
export function SearchOverlay({ open, tasks, onClose, onPick }: Props): JSX.Element | null {
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    // Focus after mount so the browser accepts the focus call.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return tasks.slice(0, 30);
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => t.intent.toLowerCase().includes(q)).slice(0, 30);
  }, [query, tasks]);

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
                <span className="truncate text-sm text-foreground">{t.intent}</span>
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
    case 'executing':
      return '执行中';
    case 'paused':
      return '已暂停';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
  }
}

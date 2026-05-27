import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import * as React from 'react';
import {
  enqueueToastItem,
  type ToastItem,
  type ToastKind,
} from '@/lib/toast-state';
import { cn } from '@/lib/utils';

interface ToastCtx {
  /**
   * Show a toast. `durationMs` defaults to 4000; pass a shorter
   * value for low-priority confirmations (e.g. "实时连接已恢复" at
   * 3000ms).
   */
  show(text: string, kind?: ToastKind, durationMs?: number): void;
}

/**
 * Minimal in-app toast: no router, no portal gymnastics — a fixed
 * bottom-right stack driven by a context. Errors auto-dismiss after
 * 4s; the user can also tap to dismiss. Info toasts follow the same
 * timing. Kept deliberately sparse so it doesn't crowd the workbench;
 * the conversation stream is the primary surface for feedback.
 */
const Ctx = React.createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);

  const show = React.useCallback<ToastCtx['show']>(
    (text, kind = 'info', durationMs = 4000) => {
      const id = ++idRef.current;
      setItems((prev) => enqueueToastItem(prev, { id, text, kind }));
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
    },
    [],
  );

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const ctx = React.useMemo<ToastCtx>(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[100] flex flex-col gap-2 sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm"
      >
        {items.map((t) => (
          <button
            type="button"
            key={t.id}
            aria-label={`关闭提示：${t.text}`}
            onClick={() => dismiss(t.id)}
            className={cn(
              'pointer-events-auto group relative flex w-full items-start gap-3 overflow-hidden rounded-[8px] border bg-white/96 px-3.5 py-3 text-left text-sm text-foreground shadow-[0_14px_36px_rgba(15,23,42,0.13)] backdrop-blur-md transition-[border-color,box-shadow,transform] animate-fade-in hover:-translate-y-0.5 hover:shadow-[0_16px_42px_rgba(15,23,42,0.16)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:bg-card/95',
              t.kind === 'error'
                ? 'border-[#EA1F59]/28 dark:border-[#EA1F59]/35'
                : 'border-[#DCDDDD] dark:border-white/10',
            )}
          >
            <span
              className={cn(
                'absolute inset-y-0 left-0 w-0.5',
                t.kind === 'error' ? 'bg-[#EA1F59]' : 'bg-[#42C0EF]',
              )}
              aria-hidden
            />
            <span
              className={cn(
                'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border bg-white',
                t.kind === 'error'
                  ? 'border-[#EA1F59]/25 text-[#EA1F59]'
                  : 'border-[#42C0EF]/30 text-[#1688AA]',
              )}
              aria-hidden
            >
              {t.kind === 'error' ? (
                <AlertCircle className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1 break-words pr-1 leading-5">
              {t.text}
            </span>
            <X className="mt-1 h-3.5 w-3.5 shrink-0 text-[#ADADAD] transition-colors group-hover:text-[#595757]" />
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    // Render without a provider: return a silent no-op so components
    // don't crash if mounted outside the app shell (test harness, etc.).
    return { show: () => undefined };
  }
  return ctx;
}

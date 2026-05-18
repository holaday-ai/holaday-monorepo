import { AlertCircle, X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

type ToastKind = 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

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
  const [items, setItems] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const show = React.useCallback<ToastCtx['show']>(
    (text, kind = 'info', durationMs = 4000) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, text, kind }]);
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
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2"
      >
        {items.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm shadow-lg backdrop-blur-md animate-fade-in',
              t.kind === 'error'
                ? 'border-red-200 bg-red-50/95 text-red-900 dark:border-red-500/40 dark:bg-red-950/90 dark:text-red-100'
                : 'border-border bg-popover/95 text-popover-foreground',
            )}
          >
            <AlertCircle
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                t.kind === 'error' ? 'text-red-500' : 'text-muted-foreground',
              )}
            />
            <span className="min-w-0 flex-1">{t.text}</span>
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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

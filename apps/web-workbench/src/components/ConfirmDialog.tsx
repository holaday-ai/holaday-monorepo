import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  /** Button label for the confirm action. Defaults to "确定". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "取消". */
  cancelLabel?: string;
  /**
   * Destructive styling paints the confirm button red and the close-on-
   * backdrop focus trap so keyboard users land on "取消" by default.
   */
  destructive?: boolean;
  onConfirm(): void | Promise<void>;
  onClose(): void;
}

/**
 * Centered modal replacing `window.confirm`. Backdrop blurs the
 * workbench, Escape + backdrop click cancel, Enter on the confirm
 * button commits. Matches the rest of the dark-capable theme via
 * shadcn CSS tokens — no bespoke colors beyond destructive red.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  destructive = false,
  onConfirm,
  onClose,
}: Props): JSX.Element | null {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        // Close on backdrop click (not on dialog body clicks).
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl">
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold tracking-tight"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={busy}
            className={cn(
              destructive &&
                'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500',
            )}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  /** Optional overlay override for nested dialogs that need to sit above another modal. */
  overlayClassName?: string;
  /** Button label for the confirm action. Defaults to "确定". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "取消". */
  cancelLabel?: string;
  /**
   * Destructive styling paints the confirm button with the brand pink
   * warning tone while the focus trap lands on "取消" by default.
   */
  destructive?: boolean;
  onConfirm(): void | Promise<void>;
  onClose(): void;
}

function subscribeToFullscreen(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}

function fullscreenPortalTarget(): Element | null {
  return document.fullscreenElement;
}

/**
 * Centered modal replacing `window.confirm`. Backdrop blurs the
 * workbench, Escape + backdrop click cancel, Enter on the confirm
 * button commits. Shared trust surface for delete / external-link
 * confirms, so it stays quiet and brand-consistent.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  overlayClassName,
  confirmLabel = '确定',
  cancelLabel = '取消',
  destructive = false,
  onConfirm,
  onClose,
}: Props): JSX.Element | null {
  // Native fullscreen hides body siblings; the dialog must remain inside its top layer.
  const fullscreenElement = React.useSyncExternalStore(
    subscribeToFullscreen,
    fullscreenPortalTarget,
    () => null,
  );
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const mountedRef = React.useRef(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const dialogs = document.querySelectorAll('[data-confirm-dialog]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handleConfirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  return createPortal(
    <div
      ref={dialogRef}
      data-confirm-dialog="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={cn(
        'fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm animate-fade-in',
        overlayClassName,
      )}
      onMouseDown={(e) => {
        // Close on backdrop click (not on dialog body clicks).
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-[#DCDDDD] bg-white p-5 text-card-foreground shadow-[0_16px_48px_rgba(17,24,39,0.16)] dark:border-white/10 dark:bg-card">
        <h2
          id={titleId}
          className="text-base font-semibold tracking-tight text-[#2F2F2F] dark:text-foreground"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#595757] dark:text-muted-foreground">
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
            className="hover:bg-[#EFEFEF]/70 dark:hover:bg-white/10"
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={busy}
            className={cn(
              'shadow-[0_4px_12px_rgba(255,0,97,0.16)] focus-visible:ring-[#FF0061]/25',
              destructive
                ? 'bg-[#FF0061] text-white hover:bg-[#FF0061]/90'
                : 'bg-[#57479C] text-white hover:bg-[#57479C]/90',
            )}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    fullscreenElement ?? document.body,
  );
}

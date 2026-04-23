import { Loader2, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onClose(): void;
  onSubmit(message: string): Promise<{ ok: true } | { error: string }>;
}

/**
 * Minimal feedback dialog — a textarea + submit button over a dimmed
 * backdrop. No rich categorisation; the goal is to lower the friction
 * to "send me any thought". Max length matches the router's zod
 * validator. Closes on backdrop click + Escape.
 */
export function FeedbackDialog({ open, onClose, onSubmit }: Props): JSX.Element | null {
  const [value, setValue] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setValue('');
    setNotice(null);
    setError(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, pending]);

  if (!open) return null;

  async function handleSubmit(): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await onSubmit(trimmed);
      if ('error' in res) {
        setError(res.error);
      } else {
        setNotice('谢谢你的反馈，我们会认真看。');
        setValue('');
        setTimeout(() => onClose(), 1200);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-xl border border-border bg-popover p-5 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label="关闭"
          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/5"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold text-foreground">给 HOLA DAY 留言</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Bug、建议、吐槽都欢迎。我们会跟你邮箱回复。
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="你发现了什么？或者希望我们做什么？"
          rows={5}
          maxLength={4000}
          disabled={pending}
          className="mt-3 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {notice && <div className="mt-2 text-xs text-blue-700 dark:text-blue-400">{notice}</div>}
        {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={pending || value.trim().length === 0}
          >
            {pending ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> 发送中…
              </>
            ) : (
              '发送'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { Loader2, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  FEEDBACK_AUTOCLOSE_MS,
  MAX_FEEDBACK_MESSAGE_LENGTH,
  feedbackCounterLabel,
  feedbackMessageState,
  feedbackSubmitError,
} from '@/lib/feedback-dialog-state';
import { cn } from '@/lib/utils';

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
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = React.useRef<number | null>(null);
  const mountedRef = React.useRef(false);
  const messageState = feedbackMessageState(value);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setValue('');
    setNotice(null);
    setError(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, pending]);

  if (!open) return null;

  async function handleSubmit(): Promise<void> {
    if (!messageState.canSubmit || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await onSubmit(messageState.trimmed);
      if ('error' in res) {
        setError(feedbackSubmitError(res.error));
      } else {
        setNotice('谢谢你的反馈，我们会认真看。');
        setValue('');
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          onClose();
        }, FEEDBACK_AUTOCLOSE_MS);
      }
    } catch (err) {
      setError(feedbackSubmitError(err));
    } finally {
      if (mountedRef.current) {
        setPending(false);
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-dialog-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm animate-fade-in"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-lg border border-[#DCDDDD] bg-white p-5 shadow-[0_16px_48px_rgba(17,24,39,0.16)] dark:border-white/10 dark:bg-card"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label="关闭"
          title="关闭"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#EFEFEF]/70 hover:text-foreground dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 id="feedback-dialog-title" className="text-base font-semibold text-[#2F2F2F] dark:text-foreground">
          给 HOLA DAY 留言
        </h2>
        <p id="feedback-dialog-hint" className="mt-1 text-xs text-[#595757] dark:text-muted-foreground">
          Bug、建议、吐槽都欢迎。我们会跟你邮箱回复。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            aria-label="反馈内容"
            aria-describedby="feedback-dialog-hint feedback-dialog-counter feedback-dialog-state"
            placeholder="你发现了什么？或者希望我们做什么？"
            rows={5}
            maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
            disabled={pending}
            className="mt-3 w-full resize-none rounded-md border border-[#DCDDDD] bg-white px-3 py-2 text-sm shadow-none placeholder:text-muted-foreground/55 focus-visible:border-[#EA1F59]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10 dark:border-white/10 dark:bg-card"
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            <span
              id="feedback-dialog-counter"
              className={cn(
                'text-[11px] text-muted-foreground',
                messageState.remaining <= 80 && 'text-[#EA1F59]',
              )}
            >
              {feedbackCounterLabel(value)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              最多 {MAX_FEEDBACK_MESSAGE_LENGTH} 字
            </span>
          </div>
          <div id="feedback-dialog-state" className="min-h-5">
            {notice && (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 rounded-md border border-[#42C0EF]/35 bg-[#42C0EF]/10 px-3 py-2 text-xs text-[#595757] dark:text-foreground"
              >
                {notice}
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mt-2 rounded-md border border-[#EA1F59]/30 bg-[#EA1F59]/10 px-3 py-2 text-xs text-[#EA1F59]"
              >
                {error}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={pending}
              className="hover:bg-[#EFEFEF]/70 dark:hover:bg-white/10"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={pending || !messageState.canSubmit}
              className="bg-[#EA1F59] text-white shadow-[0_4px_12px_rgba(234,31,89,0.16)] hover:bg-[#EA1F59]/90"
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
        </form>
      </div>
    </div>
  );
}

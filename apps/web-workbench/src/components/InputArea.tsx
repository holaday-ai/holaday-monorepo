import { ArrowUp, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  onSubmit: (intent: string) => Promise<void> | void;
  busy?: boolean;
}

/**
 * Bottom-of-panel composer. Enter submits, Shift+Enter inserts a
 * newline. Textarea auto-grows to ~6 lines before scrolling. The
 * circular send button sits in the bottom-right corner of the card
 * so the user can click it OR just hit Enter.
 */
export function InputArea({ onSubmit, busy }: Props): JSX.Element {
  const [value, setValue] = React.useState('');
  // Local submitting flag — decouples the button spinner from the
  // global `busy` prop (which is driven by the store-level `loading`
  // flag that covers list refresh too). We flip this while the
  // mutation is in flight so the spinner is tied specifically to
  // *this* submit.
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed || submitting || busy) return;
    setSubmitting(true);
    setValue('');
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const disabled = submitting || Boolean(busy);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6">
      <div className="relative rounded-2xl border border-input bg-background shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:border-foreground/20 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你想让 HOLA DAY 做什么..."
          rows={2}
          className="resize-none border-0 bg-transparent px-4 py-3 pr-14 text-sm shadow-none focus-visible:ring-0"
          style={{ maxHeight: '10rem' }}
          disabled={disabled}
        />
        <Button
          size="icon"
          onClick={() => void handleSubmit()}
          disabled={disabled || value.trim().length === 0}
          className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-full"
          aria-label={submitting ? '发送中' : '发送'}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
        <span>claude-opus-4 · 自动模式</span>
        <span>Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}

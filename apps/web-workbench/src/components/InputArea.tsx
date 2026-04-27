import { ArrowUp, Loader2, Plus, Sparkles } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  onSubmit: (intent: string) => Promise<void> | void;
  busy?: boolean;
  /** Forwarded ref for keyboard-shortcut focus (Cmd+N / slash). */
  inputRef?: React.Ref<HTMLTextAreaElement>;
  /**
   * Supercar: flips the placeholder + shortcut hint to reply mode.
   * Doesn't change submit behaviour — App's onSubmit already branches
   * to tasks.reply when the current task is awaiting a user reply.
   */
  replyMode?: boolean;
  /**
   * Phase 10 polish — when set, renders the quota-exhausted card
   * INSTEAD of the composer. The textarea + send button are gated
   * client-side so a free user who hammers Enter doesn't have to
   * wait for the server's TOO_MANY_REQUESTS to know they're capped.
   */
  quotaExhausted?: boolean;
  /**
   * Plan id — drives the exhausted-state copy (different message
   * for free's daily cap vs. paid's monthly cap, different button
   * choices since free can't buy add-on packs).
   */
  quotaPlan?: string;
}

/**
 * Bottom-of-panel composer. Enter submits, Shift+Enter inserts a
 * newline. Textarea auto-grows to ~6 lines before scrolling. The
 * circular send button sits in the bottom-right corner of the card
 * so the user can click it OR just hit Enter. We deliberately keep
 * the footer minimal — the model / mode selector is product-team UI,
 * not useful to end users, so it's gone.
 */
export function InputArea({
  onSubmit,
  busy,
  inputRef,
  replyMode,
  quotaExhausted,
  quotaPlan,
}: Props): JSX.Element {
  const [value, setValue] = React.useState('');
  const navigate = useNavigate();
  if (quotaExhausted) {
    return (
      <QuotaExhaustedCard plan={quotaPlan ?? 'free'} navigate={navigate} />
    );
  }
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
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={replyMode ? '回复 HOLA DAY...' : '描述你想让 HOLA DAY 做什么...'}
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
      <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
        <span className="hidden md:inline">
          按 <Kbd>/</Kbd> 聚焦 · <Kbd>⌘K</Kbd> 搜索任务
        </span>
        <span>Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <kbd className="rounded border border-border bg-muted/40 px-1 py-0.5 font-sans text-[10px] text-foreground/80">
      {children}
    </kbd>
  );
}

/**
 * Replaces the composer when the user has hit their period cap.
 * Three flavours of plan, each with a different button row:
 *
 *   free  → "升级到基础版" only (free has no add-on packs)
 *   basic → "购买加量包" + "升级专业版"
 *   pro   → "购买加量包" only (pro is the top tier; nothing to upgrade)
 *
 * Both buttons just navigate to /plan today. A future polish could
 * deep-link to the addon section via a hash anchor; for MVP a single
 * landing target is fine — the page already shows both plan tiers
 * and the addon block, and the user lands above whichever they
 * came for.
 */
function QuotaExhaustedCard({
  plan,
  navigate,
}: {
  plan: string;
  navigate: (path: string) => void;
}): JSX.Element {
  const isFree = plan === 'free';
  const isPro = plan === 'pro';
  const headline = isFree ? '今日额度已用完' : '本月额度已用完';
  const subline = isFree
    ? '免费版每天 3 次任务，明天再来或升级基础版立即解锁'
    : '购买加量包当月立即生效，或升级套餐拿更高月度额度';
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6">
      <div className="rounded-2xl border border-amber-300/40 bg-amber-50/40 px-5 py-4 dark:border-amber-700/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              {headline}
            </div>
            <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
              {subline}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!isFree && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/plan')}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  购买加量包
                </Button>
              )}
              {!isPro && (
                <Button size="sm" onClick={() => navigate('/plan')}>
                  {isFree ? '升级到基础版' : '升级到专业版'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { AttachmentChip, type DraftAttachment } from '@/components/AttachmentChip';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { isUploadError, uploadFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';

interface Props {
  onSubmit: (
    intent: string,
    fileIds: string[],
    mode?: 'auto' | 'plan',
  ) => Promise<void> | void;
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
   * Phase 14 audit follow-up — when a terminal task is selected,
   * the next message defaults to a 追问 of that task (server skips
   * quota and feeds the parent context to the agent). User can
   * dismiss via the chip's ✕ to start a fresh task instead.
   * Caller (WorkbenchApp) computes both the target id + chip label.
   */
  followUpTarget?: { taskId: string; title: string } | null;
  onCancelFollowUp?: () => void;
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
  /**
   * Phase 10 Tier 3 — plan-level attachment ability. 'free' shows the
   * button greyed with an upsell tooltip; 'basic'/'pro' enables it.
   * Drives the BYTE_CAP_HINT copy too.
   */
  attachmentsAllowed?: boolean;
  /** Plan-specific size cap for the inline hint and pre-flight check. */
  attachmentByteCap?: number;
}

const ACCEPT_FILES = '.csv,.xlsx,.xls,.pdf,.txt,.json,.md';
const ACCEPT_IMAGES = '.png,.jpg,.jpeg,.webp,.gif,image/*';
const MAX_ATTACHMENTS = 5;

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
  followUpTarget,
  onCancelFollowUp,
  quotaExhausted,
  quotaPlan,
  attachmentsAllowed,
  attachmentByteCap,
}: Props): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [value, setValue] = React.useState('');
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const [dragActive, setDragActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  // O14 — + button menu state. Closes on outside click and after
  // an option fires. Only relevant when attachmentsAllowed; the
  // free-plan path returns the same upgrade toast on either option.
  const [plusMenuOpen, setPlusMenuOpen] = React.useState(false);
  const plusMenuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!plusMenuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      if (plusMenuRef.current?.contains(e.target as Node)) return;
      setPlusMenuOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [plusMenuOpen]);
  // Local submitting flag — decouples the button spinner from the
  // global `busy` prop (which is driven by the store-level `loading`
  // flag that covers list refresh too). We flip this while the
  // mutation is in flight so the spinner is tied specifically to
  // *this* submit.
  const [submitting, setSubmitting] = React.useState(false);
  // O4 — Auto/Plan toggle. Default Auto. Persisted in localStorage so
  // the user's last choice sticks across page reloads.
  const [taskMode, setTaskMode] = React.useState<'auto' | 'plan'>(() => {
    if (typeof window === 'undefined') return 'auto';
    return window.localStorage.getItem('holaday.taskMode') === 'plan' ? 'plan' : 'auto';
  });
  const setTaskModePersist = React.useCallback((m: 'auto' | 'plan') => {
    setTaskMode(m);
    try {
      window.localStorage.setItem('holaday.taskMode', m);
    } catch {
      /* private mode / quota — ignore */
    }
  }, []);

  if (quotaExhausted) {
    return (
      <QuotaExhaustedCard plan={quotaPlan ?? 'free'} navigate={navigate} />
    );
  }


  async function ingestFiles(files: FileList | File[]): Promise<void> {
    if (!attachmentsAllowed) {
      toast.show('免费版不支持文件上传，升级到基础版即可使用');
      return;
    }
    const list = Array.from(files);
    if (list.length === 0) return;
    if (attachments.length + list.length > MAX_ATTACHMENTS) {
      toast.show(`最多附 ${MAX_ATTACHMENTS} 个文件`);
      return;
    }
    for (const file of list) {
      // Pre-flight size check — fail-fast client-side before the
      // multipart roundtrip so the user gets immediate feedback.
      if (attachmentByteCap && file.size > attachmentByteCap) {
        toast.show(`文件 "${file.name}" 超过 ${(attachmentByteCap / (1024 * 1024)).toFixed(0)}MB 上限`);
        continue;
      }
      const draft: DraftAttachment = {
        fileId: '',
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
        status: 'uploading',
      };
      // O17 — read image bytes locally for a thumbnail preview while
      // upload runs in parallel. Fire-and-forget; if the read fails
      // (rare for browser-supplied File objects) the chip just shows
      // the generic image icon. Cap at ~2MB worth of base64 so we
      // don't blow up React state on a 10MB photo upload — bigger
      // images render via mime-type icon only.
      if (draft.mimetype.startsWith('image/') && file.size < 2_000_000) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== 'string') return;
          const url = reader.result;
          setAttachments((prev) =>
            prev.map((a) =>
              a.filename === draft.filename && a.size === draft.size && !a.previewDataUrl
                ? { ...a, previewDataUrl: url }
                : a,
            ),
          );
        };
        reader.readAsDataURL(file);
      }
      setAttachments((prev) => [...prev, draft]);
      try {
        const meta = await uploadFile(file);
        setAttachments((prev) =>
          prev.map((a) =>
            a === draft || (a.filename === draft.filename && a.fileId === '')
              ? { ...a, fileId: meta.fileId, status: 'ready' as const }
              : a,
          ),
        );
      } catch (err) {
        const msg = isUploadError(err) ? err.message : err instanceof Error ? err.message : '上传失败';
        setAttachments((prev) =>
          prev.map((a) =>
            a.filename === draft.filename && a.fileId === ''
              ? { ...a, status: 'error' as const, errorMessage: msg }
              : a,
          ),
        );
        toast.show(msg);
      }
    }
  }

  function removeAttachment(index: number): void {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  // O6 — 3-second undo countdown. The pending dispatch state holds the
  // actual onSubmit invocation behind a 3 s timer; user clicking the
  // undo button or pressing the input again cancels before any API
  // call happens. After the timer fires, normal submission proceeds.
  const [pendingSend, setPendingSend] = React.useState<{
    intent: string;
    fileIds: string[];
    secondsLeft: number;
  } | null>(null);
  const pendingTimerRef = React.useRef<number | null>(null);
  const cancelPendingSend = React.useCallback((): void => {
    if (pendingTimerRef.current != null) {
      window.clearInterval(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setPendingSend(null);
  }, []);
  React.useEffect(() => () => cancelPendingSend(), [cancelPendingSend]);

  async function handleSubmit(): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed || submitting || busy || pendingSend) return;
    // Block submit while any attachment is still uploading; let
    // failed ones submit (they'll just be ignored server-side).
    if (attachments.some((a) => a.status === 'uploading')) {
      toast.show('文件上传中，请稍候');
      return;
    }
    const fileIds = attachments
      .filter((a) => a.status === 'ready' && a.fileId)
      .map((a) => a.fileId);
    // Stash the input + clear the composer immediately so the user
    // sees their message land in the conversation while the 3 s
    // countdown runs. Timer counts down in 1 s ticks; on hit 0 it
    // dispatches the actual onSubmit. User cancel removes the
    // pending state without ever calling onSubmit (no quota burn).
    setValue('');
    setAttachments([]);
    setPendingSend({ intent: trimmed, fileIds, secondsLeft: 3 });
    pendingTimerRef.current = window.setInterval(() => {
      setPendingSend((cur) => {
        if (!cur) return null;
        if (cur.secondsLeft <= 1) {
          if (pendingTimerRef.current != null) {
            window.clearInterval(pendingTimerRef.current);
            pendingTimerRef.current = null;
          }
          // Fire the actual submission. Fire-and-forget so React's
          // setState batching doesn't deadlock — onSubmit's own
          // error path surfaces toasts already.
          setSubmitting(true);
          void Promise.resolve(onSubmit(cur.intent, cur.fileIds, taskMode)).finally(() => {
            setSubmitting(false);
          });
          return null;
        }
        return { ...cur, secondsLeft: cur.secondsLeft - 1 };
      });
    }, 1_000);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const disabled = submitting || Boolean(busy) || pendingSend != null;

  return (
    <div
      className="mx-auto w-full max-w-3xl px-6 pb-6"
      onDragEnter={(e) => {
        if (!attachmentsAllowed) return;
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragActive(true);
        }
      }}
      onDragOver={(e) => {
        if (dragActive) e.preventDefault();
      }}
      onDragLeave={(e) => {
        // dragLeave fires on every child; only clear when leaving
        // the outer container.
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        if (!attachmentsAllowed) return;
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          void ingestFiles(e.dataTransfer.files);
        }
      }}
    >
      <div
        className={cn(
          'relative rounded-2xl border bg-background shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:border-foreground/20 focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.08)]',
          dragActive
            ? 'border-foreground/30 ring-2 ring-foreground/10'
            : 'border-input',
        )}
      >
        {pendingSend && (
          <div className="flex items-center gap-2 border-b-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500 dark:bg-amber-500/15 dark:text-amber-100">
            <span className="shrink-0 font-semibold">即将发送</span>
            <span className="min-w-0 flex-1 truncate">"{pendingSend.intent}"</span>
            <span className="shrink-0 tabular-nums">{pendingSend.secondsLeft}s</span>
            <button
              type="button"
              onClick={() => {
                // Restore the composer + drop the pending dispatch.
                // No API call happened, no quota burned.
                setValue(pendingSend.intent);
                cancelPendingSend();
              }}
              className="shrink-0 rounded px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-200 dark:text-amber-100 dark:hover:bg-amber-500/30"
            >
              撤回
            </button>
          </div>
        )}
        {followUpTarget && !replyMode && !pendingSend && (
          <div className="flex items-center gap-2 border-b-2 border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500 dark:bg-sky-500/15 dark:text-sky-100">
            <span className="shrink-0 font-semibold">追问</span>
            <span className="min-w-0 flex-1 truncate">"{followUpTarget.title}"</span>
            <button
              type="button"
              onClick={onCancelFollowUp}
              aria-label="取消追问，发新任务"
              title="取消追问，发新任务"
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-sky-900/70 hover:bg-sky-200 hover:text-sky-900 dark:text-sky-100/70 dark:hover:bg-sky-500/30 dark:hover:text-sky-100"
            >
              <X className="h-3 w-3" aria-hidden />
              发新任务
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
            {attachments.map((a, i) => (
              <AttachmentChip
                key={`${a.filename}-${i}`}
                attachment={a}
                onRemove={() => removeAttachment(i)}
              />
            ))}
          </div>
        )}
        <Textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            replyMode
              ? '回复 HOLA DAY...'
              : followUpTarget
                ? '追问这个任务...'
                : '描述你想让 HOLA DAY 做什么...'
          }
          rows={2}
          className="resize-none border-0 bg-transparent px-4 py-3 pr-14 text-sm shadow-none focus-visible:ring-0"
          style={{ maxHeight: '10rem' }}
          disabled={disabled}
        />
        {!replyMode && (
          <div ref={plusMenuRef} className="absolute bottom-2.5 left-2.5">
            <button
              type="button"
              onClick={() => {
                if (!attachmentsAllowed) {
                  toast.show('免费版不支持附件，升级基础版可上传文件 / 图片');
                  return;
                }
                setPlusMenuOpen((v) => !v);
              }}
              aria-label={attachmentsAllowed ? '添加附件' : '升级基础版可添加附件'}
              aria-expanded={plusMenuOpen}
              title={attachmentsAllowed ? '添加附件' : '升级基础版可添加附件'}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                attachmentsAllowed
                  ? 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
                  : 'cursor-not-allowed text-muted-foreground/40',
                plusMenuOpen && 'bg-foreground/[0.05] text-foreground',
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
            {plusMenuOpen && attachmentsAllowed && (
              <div
                role="menu"
                className="absolute bottom-10 left-0 z-30 w-40 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-foreground/[0.05]"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>上传文件</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    imageInputRef.current?.click();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-foreground/[0.05]"
                >
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>上传图片</span>
                </button>
              </div>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_FILES}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept={ACCEPT_IMAGES}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            e.target.value = '';
          }}
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
        <div className="flex items-center gap-2">
          <TaskModeSelector mode={taskMode} onChange={setTaskModePersist} />
          <span className="hidden md:inline">
            按 <Kbd>/</Kbd> 聚焦 · <Kbd>⌘K</Kbd> 搜索任务
          </span>
        </div>
        <span>Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  );
}

/**
 * Single ghost-button + popover dropdown for picking the task mode.
 * Replaces the prior pair of emoji pill buttons. Click the button →
 * popover with two options, each a row carrying title + small
 * sub-label and a leading check mark on the active choice.
 *
 * Closes on outside click, Escape, or option pick. Persists mode
 * via the parent's onChange (already writes localStorage).
 */
function TaskModeSelector({
  mode,
  onChange,
}: {
  mode: 'auto' | 'plan';
  onChange: (m: 'auto' | 'plan') => void;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const label = mode === 'auto' ? '自动执行' : '先出方案';
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground',
          open && 'bg-foreground/[0.05] text-foreground',
        )}
      >
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-7 left-0 z-30 w-56 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          <ModeOption
            active={mode === 'auto'}
            onPick={() => {
              onChange('auto');
              setOpen(false);
            }}
            title="自动执行"
            sub="AI 直接执行任务"
          />
          <ModeOption
            active={mode === 'plan'}
            onPick={() => {
              onChange('plan');
              setOpen(false);
            }}
            title="先出方案"
            sub="AI 先列计划，你确认后再执行"
          />
        </div>
      )}
    </div>
  );
}

function ModeOption({
  active,
  onPick,
  title,
  sub,
}: {
  active: boolean;
  onPick: () => void;
  title: string;
  sub: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] hover:bg-foreground/[0.05]"
    >
      <Check
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          active ? 'text-foreground' : 'opacity-0',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </button>
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

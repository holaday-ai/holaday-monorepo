import { ArrowUp, Loader2, Paperclip, Plus, Sparkles } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { AttachmentChip, type DraftAttachment } from '@/components/AttachmentChip';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { isUploadError, uploadFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';

interface Props {
  onSubmit: (intent: string, fileIds: string[]) => Promise<void> | void;
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

const ACCEPT = '.csv,.xlsx,.xls,.pdf,.txt,.json,.md,.png,.jpg,.jpeg,.webp,.gif';
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
  // Local submitting flag — decouples the button spinner from the
  // global `busy` prop (which is driven by the store-level `loading`
  // flag that covers list refresh too). We flip this while the
  // mutation is in flight so the spinner is tied specifically to
  // *this* submit.
  const [submitting, setSubmitting] = React.useState(false);

  if (quotaExhausted) {
    return (
      <QuotaExhaustedCard plan={quotaPlan ?? 'free'} navigate={navigate} />
    );
  }

  function pickFiles(): void {
    if (!attachmentsAllowed) {
      toast.show('免费版不支持文件上传，升级到基础版即可使用');
      return;
    }
    fileInputRef.current?.click();
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

  async function handleSubmit(): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed || submitting || busy) return;
    // Block submit while any attachment is still uploading; let
    // failed ones submit (they'll just be ignored server-side).
    if (attachments.some((a) => a.status === 'uploading')) {
      toast.show('文件上传中，请稍候');
      return;
    }
    const fileIds = attachments
      .filter((a) => a.status === 'ready' && a.fileId)
      .map((a) => a.fileId);
    setSubmitting(true);
    setValue('');
    setAttachments([]);
    try {
      await onSubmit(trimmed, fileIds);
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
        {followUpTarget && !replyMode && (
          <div className="flex items-center gap-2 border-b-2 border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500 dark:bg-sky-500/15 dark:text-sky-100">
            <span aria-hidden className="shrink-0 text-sm">↪</span>
            <span className="shrink-0 font-semibold">追问</span>
            <span className="min-w-0 flex-1 truncate">"{followUpTarget.title}"</span>
            <button
              type="button"
              onClick={onCancelFollowUp}
              aria-label="取消追问，发新任务"
              title="取消追问，发新任务"
              className="shrink-0 rounded px-1.5 py-0.5 text-sky-900/70 hover:bg-sky-200 hover:text-sky-900 dark:text-sky-100/70 dark:hover:bg-sky-500/30 dark:hover:text-sky-100"
            >
              ✕ 发新任务
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
          <button
            type="button"
            onClick={pickFiles}
            aria-label={attachmentsAllowed ? '附加文件' : '升级基础版可附加文件'}
            title={attachmentsAllowed ? '附加文件' : '升级基础版可附加文件'}
            className={cn(
              'absolute bottom-2.5 left-2.5 inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
              attachmentsAllowed
                ? 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
                : 'cursor-not-allowed text-muted-foreground/40',
            )}
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            // Reset so picking the same file twice still fires.
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

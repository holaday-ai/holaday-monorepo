import {
  ArrowUp,
  ListChecks,
  Loader2,
  Paperclip,
  Plus,
  Puzzle,
  Sparkles,
  Target,
} from 'lucide-react';
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AttachmentChip, type DraftAttachment } from '@/components/AttachmentChip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  composerSubmitErrorMessage,
  type ComposerSubmitResult,
  shouldClearComposerAfterSubmit,
} from '@/components/composer-submit';
import { pageErrorMessage } from '@/lib/page-error-copy';
import { quotaExhaustedCopy } from '@/lib/quota-exhausted-copy';
import { isUploadError, uploadFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';

interface Props {
  onSubmit: (
    intent: string,
    fileIds: string[],
    mode?: 'auto' | 'plan',
    expertMode?: 'normal' | 'expert' | 'auto',
  ) => Promise<ComposerSubmitResult> | ComposerSubmitResult;
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
  /**
   * Suggestion-chip prefill. When this string flips from null to a
   * value, the composer's text is replaced with it and the textarea
   * gains focus. The caller calls `onPrefillConsumed` so the next
   * identical chip click can re-trigger the effect.
   *
   * The chip path deliberately does NOT submit — clicking a
   * suggestion fills the composer so the user can edit it before
   * sending. The previous behaviour fired onSubmit directly and
   * burned quota on accidental taps, especially on mobile.
   */
  prefillIntent?: string | null;
  onPrefillConsumed?: () => void;
  /**
   * When true the composer drops its outer max-width + page padding
   * and renders flush with the parent. Used on the empty home where
   * MainPanel already centers the 720px column — the composer's
   * own padding would double-shrink it.
   */
  fullBleed?: boolean;
}

const ACCEPT_FILES = '.csv,.xlsx,.xls,.pdf,.txt,.json,.md';
const ACCEPT_IMAGES = '.png,.jpg,.jpeg,.webp,.gif,image/*';
const ACCEPT_ATTACHMENTS = `${ACCEPT_FILES},${ACCEPT_IMAGES}`;
const MAX_ATTACHMENTS = 5;
const COMPOSER_SURFACE =
  'border-[#DCDDDD] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/90';
const COMPOSER_FIELD_FOCUS =
  'focus-within:border-[#EA1F59]/40 focus-within:shadow-[0_8px_24px_rgba(17,24,39,0.08)] focus-within:ring-2 focus-within:ring-[#EA1F59]/10';
const COMPOSER_DIVIDER = 'border-[#DCDDDD]/80 dark:border-white/10';
const MODE_MENU_CLASS =
  'z-[80] rounded-[8px] border-[#DCDDDD] bg-white p-1.5 shadow-[0_12px_32px_rgba(17,24,39,0.12)] dark:border-white/10 dark:bg-card';
const MODE_MENU_ITEM_CLASS =
  'items-start rounded-[6px] py-2 text-[13px] focus:bg-[#EFEFEF]/70 data-[state=checked]:bg-[#EA1F59]/5 dark:focus:bg-white/10 dark:data-[state=checked]:bg-[#EA1F59]/10';
const ATTACHMENT_TRIGGER_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-transparent bg-transparent text-[#595757] transition-colors hover:bg-[#EFEFEF]/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20 dark:text-foreground/75 dark:hover:bg-white/10';
const ATTACHMENT_TRIGGER_ACTIVE =
  'bg-[#EA1F59]/5 text-[#EA1F59] dark:bg-[#EA1F59]/10';
const ATTACHMENT_MENU_ITEM_CLASS =
  'gap-2.5 rounded-[6px] px-2 py-2 text-[13px] focus:bg-[#EFEFEF]/70 dark:focus:bg-white/10';

type ComposerExpertWorkflow = {
  id: 'douyin-livestream-review';
  name: string;
  missingInputs: Array<'liveSession' | 'dataSource'>;
};

const DOUYIN_TERMS = ['抖音', 'douyin', 'tiktok', '千川', '巨量百应', '电商罗盘'];
const LIVE_TERMS = ['直播', '直播间', '带货', '主播', 'gmv', 'gpm', 'uv价值', '场次'];
const REVIEW_TERMS = ['复盘', '分析', '总结', '优化', '诊断', '报告', '策略', '改进'];
const SESSION_PATTERNS = [
  /昨天|今日|今天|前天|本周|上周|本月|上月|今晚|上午|下午|晚上/u,
  /近\s*\d+\s*[天日周月]/u,
  /最近\s*\d+\s*[天日周月]?/u,
  /上一场|最近一场|这场直播|该场直播/u,
  /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?/u,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/u,
  /\d{1,2}:\d{2}/u,
];
const DATA_SOURCE_PATTERNS = [
  /抖音电商罗盘|电商罗盘|罗盘/u,
  /巨量百应|巨量千川|千川|巨量引擎/u,
  /蝉妈妈|飞瓜|新抖|抖查查/u,
  /商家后台|店铺后台|后台|创作者中心/u,
  /上传|附件|表格|excel|xlsx|csv|截图|图片|数据文件|报表/u,
  /https?:\/\/|www\./iu,
];

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
  quotaExhausted,
  quotaPlan,
  attachmentsAllowed,
  attachmentByteCap,
  prefillIntent,
  onPrefillConsumed,
  fullBleed,
}: Props): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [value, setValue] = React.useState('');
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const [dragActive, setDragActive] = React.useState(false);
  // Local ref for the textarea so we can focus it from inside on
  // suggestion-chip prefill. The forwarded `inputRef` is also kept
  // up-to-date via a callback ref so external callers (Cmd+N
  // shortcut, FilesPage handoff) keep working.
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const setTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (typeof inputRef === 'function') inputRef(node);
      else if (inputRef && typeof inputRef === 'object') {
        (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
          node;
      }
    },
    [inputRef],
  );

  // Suggestion chip → composer prefill. The chip click sets
  // prefillIntent in MainPanel; this effect copies it into the local
  // value, focuses the textarea, and signals back so the prop can
  // reset (a second click on the same chip then re-pulses cleanly).
  React.useEffect(() => {
    if (prefillIntent == null) return;
    setValue(prefillIntent);
    // requestAnimationFrame ensures the value commit has flushed
    // before we move the caret — focusing into a stale textarea
    // sometimes drops the cursor at index 0 on mobile.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* setSelectionRange not supported on every input type */
      }
    });
    onPrefillConsumed?.();
  }, [prefillIntent, onPrefillConsumed]);

  // FilesPage → 用于新任务 hands off via location.state. WorkbenchApp's
  // bootstrap effect handles `newTask: true` (calls enterNewTaskMode);
  // here we only consume `attachFile` to pre-stage a DraftAttachment.
  // Single-shot: replaceState clears the state after pre-stage so a
  // refresh on `/` doesn't re-attach.
  React.useEffect(() => {
    const state = location.state as
      | {
          attachFile?: { fileId: string; filename: string; mimetype: string; sizeBytes: number };
        }
      | null;
    const handoff = state?.attachFile;
    if (!handoff) return;
    setAttachments((prev) => {
      if (prev.some((a) => a.fileId === handoff.fileId)) return prev;
      return [
        ...prev,
        {
          fileId: handoff.fileId,
          filename: handoff.filename,
          mimetype: handoff.mimetype,
          size: handoff.sizeBytes,
          status: 'ready' as const,
        },
      ];
    });
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location, navigate]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Product polish #6 — + button menu state. Radix DropdownMenu
  // owns the outside-click / escape close, focus management, and
  // keyboard navigation. We only keep `open` state for the
  // controlled `open` / `onOpenChange` API + to highlight the
  // trigger when the menu is open.
  const [plusMenuOpen, setPlusMenuOpen] = React.useState(false);
  // Local submitting flag — decouples the button spinner from the
  // global `busy` prop (which is driven by the store-level `loading`
  // flag that covers list refresh too). We flip this while the
  // mutation is in flight so the spinner is tied specifically to
  // *this* submit.
  const [submitting, setSubmitting] = React.useState(false);
  // Auto / Plan toggle. Default Auto. Resets to Auto after every
  // submit (and on page load) — Plan mode is a per-task opt-in
  // ("force a planning step for THIS message") rather than a sticky
  // preference. The previous localStorage persistence let users
  // unknowingly stay in Plan for days, paying the planning round-trip
  // on every subsequent task.
  const [taskMode, setTaskMode] = React.useState<'auto' | 'plan'>('auto');
  // Codex Pack C1 — task-level expert mode toggle. `auto` (default)
  // lets the orchestrator decide whether to load expert skills from
  // the user's settings + workflow registry; `expert` forces them
  // on (typed report tier, longer timeout, richer prompt); `normal`
  // forces them off (cheaper / faster general-purpose lane). Sent
  // on tasks.create as `expertMode`; the backend honours it when
  // not null.
  const [expertMode, setExpertMode] = React.useState<'normal' | 'expert' | 'auto'>('auto');
  // One-shot cleanup of the legacy persisted preference key. Older
  // builds wrote 'plan' here and read it on every mount; users
  // upgrading would otherwise stay stuck in Plan mode silently.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem('holaday.taskMode');
    } catch {
      /* private mode / quota — ignore */
    }
  }, []);

  /**
   * Phase 4 R2 4c — mobile keyboard scroll. When the soft keyboard
   * pops up, the textarea ends up hidden behind it on iOS Safari
   * and Android Chrome. visualViewport.height shrinks after keyboard
   * animation finishes; we listen for that and scroll the focused
   * textarea back into view. `block: 'end'` keeps the caret line
   * visible at the bottom of the available area (above the keyboard).
   *
   * Placed here (above any early returns) so the hook order stays
   * stable — react-hooks/rules-of-hooks would error otherwise.
   */
  React.useEffect(() => {
    const vv = (window as Window & {
      visualViewport?: {
        addEventListener: typeof window.addEventListener;
        removeEventListener: typeof window.removeEventListener;
        height: number;
      };
    }).visualViewport;
    if (!vv) return;
    const onResize = (): void => {
      const el = textareaRef.current;
      if (!el) return;
      if (document.activeElement !== el) return;
      if (vv.height < window.innerHeight * 0.75) {
        setTimeout(() => {
          el.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }, 60);
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  // F1 — quota gate exception for reply / follow-up paths. Replying
  // to a parked supercar task or following up on a recently-completed
  // task is NOT a "create new task" action; it does not consume quota.
  // Earlier the quota card replaced the composer the moment the user
  // hit zero, even when they were mid-reply on a paused task — a
  // clear UX dead-end (the agent stays parked, user can't unblock it).
  // tasks.reply has its own server-side gating, so showing the card
  // here is duplicate work that breaks the user.
  if (quotaExhausted && !replyMode && !followUpTarget) {
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
        const msg = isUploadError(err) ? err.message : pageErrorMessage(err, '上传失败');
        setAttachments((prev) =>
          prev.map((a) =>
            a.filename === draft.filename && a.fileId === ''
              ? { ...a, status: 'error' as const, errorMessage: msg }
              : a,
          ),
        );
        toast.show(msg, 'error');
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
    // F6 — clear the composer ONLY on success. Previous flow cleared
    // immediately ("optimistic dispatch") which felt instant but lost
    // user input on any submit failure (quota error, role-overflow,
    // network blip) — they had to retype the prompt + re-attach files.
    // Now: keep value + attachments visible until onSubmit returns;
    // on failure, toast.show + leave them in place to retry. The
    // textarea is `disabled` while `submitting=true`, so users see
    // the in-flight state without further loss. Plan mode flip-back
    // also gates on success.
    setSubmitting(true);
    let submitOk = false;
    try {
      const result = (await Promise.resolve(
        onSubmit(trimmed, fileIds, taskMode, expertMode),
      )) as unknown;
      // onSubmit may return void OR { ok: boolean } / { error: string }.
      // Treat undefined as success (legacy callers never threw and didn't
      // signal failure). If a structured `{ error }` came back, surface
      // it and keep the input.
      if (typeof result === 'object' && result != null) {
        const r = result as { error?: string };
        if (r.error) toast.show(composerSubmitErrorMessage(r.error), 'error');
      }
      submitOk = shouldClearComposerAfterSubmit(result);
    } catch (err) {
      const msg = pageErrorMessage(err);
      toast.show(composerSubmitErrorMessage(msg), 'error');
      submitOk = false;
    } finally {
      setSubmitting(false);
    }
    if (submitOk) {
      setValue('');
      setAttachments([]);
      // Plan mode is per-message intent, not a sticky preference —
      // flip back to Auto after a successful submit so the user
      // explicitly re-opts in for any subsequent Plan-required task.
      setTaskMode('auto');
      // Codex Pack C1 — expert mode is also per-message (matches
      // taskMode semantics). Reset to `auto` so the user has to
      // re-opt-in for every expert / normal forced task.
      setExpertMode('auto');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const disabled = submitting || Boolean(busy);
  const expertWorkflow =
    !replyMode && !followUpTarget
      ? detectComposerExpertWorkflow(value, attachments.some((a) => a.status === 'ready'))
      : null;

  function appendGuidance(text: string): void {
    setValue((prev) => {
      const trimmed = prev.trimEnd();
      if (!trimmed) return text;
      if (trimmed.includes(text)) return trimmed;
      return `${trimmed}，${text}`;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div
      className={cn(
        'w-full',
        fullBleed
          ? ''
          : 'mx-auto max-w-[760px] px-3 pb-4 sm:px-6 sm:pb-6',
      )}
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
          'relative overflow-hidden rounded-lg border transition-[border-color,box-shadow]',
          COMPOSER_SURFACE,
          COMPOSER_FIELD_FOCUS,
          dragActive
            ? 'border-[#42C0EF]/60 ring-2 ring-[#42C0EF]/15'
            : '',
        )}
      >
        {attachments.length > 0 && (
          <div className={cn('flex flex-wrap gap-1.5 border-b px-3 py-2', COMPOSER_DIVIDER)}>
            {attachments.map((a, i) => (
              <AttachmentChip
                key={`${a.filename}-${i}`}
                attachment={a}
                onRemove={() => removeAttachment(i)}
              />
            ))}
          </div>
        )}
        {expertWorkflow && (
          <ExpertWorkflowHint
            workflow={expertWorkflow}
            onPickText={appendGuidance}
            onPickUpload={() => {
              if (!attachmentsAllowed) {
                toast.show('免费版不支持附件，升级基础版可上传文件 / 图片');
                return;
              }
              fileInputRef.current?.click();
            }}
          />
        )}
        <Textarea
          ref={setTextareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            replyMode
              ? '回复 HOLA DAY...'
              : followUpTarget
                ? '补充问题或下一步指令...'
                : expertWorkflow
                  ? '补充直播场次、数据来源或你想要的报告形式...'
                  : '描述你想让 HOLA DAY 做什么...'
          }
          rows={2}
          className="min-h-[92px] resize-none border-0 bg-transparent px-4 pb-12 pt-4 pr-14 text-[15px] leading-relaxed shadow-none placeholder:text-muted-foreground/55 focus-visible:ring-0"
          style={{ maxHeight: '10rem' }}
          disabled={disabled}
        />
        {/* F2 — attachment + plus menu now available in replyMode too.
            Backend `tasks.reply` accepts `fileIds` and parses them
            into the supercar handle's pendingAttachmentBlocks (or the
            generate-resume runner's `attachments`), so users can
            paste a screenshot / drop an Excel as part of an "I gave
            you the data" reply on a parked task. */}
        {/* Product polish #6 — Radix DropdownMenu replaces the
            hand-rolled outside-click popover. Picks up focus
            management, escape-to-close, arrow-key navigation,
            and proper portal layering for free. */}
        <div className="absolute bottom-2.5 left-2.5">
          {attachmentsAllowed ? (
            <DropdownMenu open={plusMenuOpen} onOpenChange={setPlusMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="添加附件"
                  title="添加附件"
                  className={cn(
                    ATTACHMENT_TRIGGER_CLASS,
                    plusMenuOpen && ATTACHMENT_TRIGGER_ACTIVE,
                  )}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className={cn('w-[206px]', MODE_MENU_CLASS)}
              >
                <DropdownMenuItem
                  className={ATTACHMENT_MENU_ITEM_CLASS}
                  onSelect={() => {
                    setPlusMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip className="h-4 w-4 text-[#595757]" />
                  <span className="font-medium text-foreground">添加照片和文件</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 bg-[#DCDDDD]/80 dark:bg-white/10" />
                <DropdownMenuItem
                  className={ATTACHMENT_MENU_ITEM_CLASS}
                  onSelect={(event) => {
                    event.preventDefault();
                    setTaskMode('plan');
                  }}
                >
                  <ListChecks className="h-4 w-4 text-[#595757]" />
                  <span className="min-w-0 flex-1 font-medium text-foreground">
                    计划模式
                  </span>
                  <MiniSwitch checked={taskMode === 'plan'} />
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={ATTACHMENT_MENU_ITEM_CLASS}
                  onSelect={(event) => {
                    event.preventDefault();
                    setTaskMode('auto');
                  }}
                >
                  <Target className="h-4 w-4 text-[#595757]" />
                  <span className="min-w-0 flex-1 font-medium text-foreground">
                    追求目标
                  </span>
                  <MiniSwitch checked={taskMode === 'auto'} />
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 bg-[#DCDDDD]/80 dark:bg-white/10" />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2.5 rounded-[6px] px-2 py-2 text-[13px] focus:bg-[#EFEFEF]/70 data-[state=open]:bg-[#EFEFEF]/70 dark:focus:bg-white/10 dark:data-[state=open]:bg-white/10">
                    <Puzzle className="h-4 w-4 text-[#595757]" />
                    <span className="min-w-0 flex-1 font-medium text-foreground">
                      插件
                    </span>
                    <span className="mr-1 text-[11px] text-muted-foreground">
                      {pluginModeLabel(expertMode)}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    sideOffset={8}
                    className={cn('w-56', MODE_MENU_CLASS)}
                  >
                    <DropdownMenuRadioGroup
                      value={expertMode}
                      onValueChange={(v) => {
                        if (v === 'normal' || v === 'expert' || v === 'auto') {
                          setExpertMode(v);
                        }
                      }}
                    >
                      <DropdownMenuRadioItem value="auto" className={MODE_MENU_ITEM_CLASS}>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-[12px] font-medium text-foreground">自动</span>
                          <span className="text-[11px] text-muted-foreground">
                            需要时自动启用专家插件
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="expert" className={MODE_MENU_ITEM_CLASS}>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-[12px] font-medium text-foreground">开启</span>
                          <span className="text-[11px] text-muted-foreground">
                            强制使用专家插件
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="normal" className={MODE_MENU_ITEM_CLASS}>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-[12px] font-medium text-foreground">关闭</span>
                          <span className="text-[11px] text-muted-foreground">
                            跳过插件，优先速度
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              onClick={() => {
                toast.show('免费版不支持附件，升级基础版可上传文件 / 图片');
              }}
              aria-label="升级基础版可添加附件"
              title="升级基础版可添加附件"
              className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-[8px] border border-transparent bg-transparent text-[#ADADAD] dark:text-foreground/40"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTACHMENTS}
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
          className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-full bg-[#EA1F59] text-white shadow-[0_4px_12px_rgba(234,31,89,0.18)] hover:bg-[#EA1F59]/90 focus-visible:ring-[#EA1F59]/25"
          aria-label={submitting ? '发送中' : '发送'}
          title={submitting ? '发送中' : '发送'}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-end px-1 text-[11px] text-muted-foreground/70">
        <span className="hidden shrink-0 rounded-[6px] px-1.5 py-0.5 text-[#ADADAD] sm:inline">
          Enter 发送
        </span>
      </div>
      {/* Phase 5b — multi-line detect. When the composer holds 2+
          non-empty lines AND we're not in a reply / follow-up flow,
          surface a one-click "make this a batch" hint. Routes to
          /batch with the lines pre-filled into the BatchTaskDialog
          (the dialog reads `initialPrompts` from history state). */}
      {!replyMode &&
        !followUpTarget &&
        (() => {
          const lines = value.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length < 2) return null;
          return (
            <button
              type="button"
              onClick={() => {
                navigate('/batch', { state: { initialPrompts: lines } });
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#57479C]/25 bg-[#57479C]/10 px-3 py-1 text-[11px] font-medium text-[#57479C] transition hover:bg-[#57479C]/15 dark:border-[#57479C]/45 dark:text-[#DCDDDD]"
            >
              <span aria-hidden>≣</span>
              提交为批量任务（{lines.length} 项）
            </button>
          );
        })()}
    </div>
  );
}

function pluginModeLabel(mode: 'normal' | 'expert' | 'auto'): string {
  if (mode === 'expert') return '开启';
  if (mode === 'normal') return '关闭';
  return '自动';
}

function MiniSwitch({ checked }: { checked: boolean }): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
        checked
          ? 'border-[#EA1F59]/30 bg-[#EA1F59]'
          : 'border-[#DCDDDD] bg-[#EFEFEF] dark:border-white/15 dark:bg-white/10',
      )}
    >
      <span
        className={cn(
          'h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(17,24,39,0.18)] transition-transform',
          checked ? 'translate-x-[13px]' : 'translate-x-0.5',
        )}
      />
    </span>
  );
}

function ExpertWorkflowHint({
  workflow,
  onPickText,
  onPickUpload,
}: {
  workflow: ComposerExpertWorkflow;
  onPickText(text: string): void;
  /**
   * F3 — fired when the user clicks the upload-shortcut chip
   * ("我会上传表格或截图"). Caller opens the OS file picker; if the
   * user cancels without selecting a file, no text is appended and
   * no attachment exists — the data-source slot stays empty so the
   * agent knows to keep asking.
   */
  onPickUpload(): void;
}): JSX.Element {
  const missingLabels = workflow.missingInputs.map(labelForWorkflowInput);
  const actions = guidanceActionsForWorkflow(workflow);

  return (
    <div className={cn('border-b bg-[#FFC910]/10 px-3 py-2 text-xs text-[#595757] dark:bg-[#FFC910]/10 dark:text-foreground', COMPOSER_DIVIDER)}>
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#57479C]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">已匹配：{workflow.name}</span>
            {missingLabels.length > 0 ? (
              <span className="text-muted-foreground">
                还缺 {missingLabels.join('、')}
              </span>
            ) : (
              <span className="text-muted-foreground">
                信息已基本足够，发送后会按专家复盘结构执行
              </span>
            )}
          </div>
          {actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    if (action.kind === 'upload') {
                      onPickUpload();
                    } else {
                      onPickText(action.label);
                    }
                  }}
                  className="rounded-full border border-[#DCDDDD] bg-white px-2 py-1 text-[11px] text-[#595757] transition hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-transparent dark:text-foreground dark:hover:bg-white/10"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function detectComposerExpertWorkflow(
  value: string,
  hasReadyAttachment: boolean,
): ComposerExpertWorkflow | null {
  const lower = value.toLowerCase();
  const hasDouyin = DOUYIN_TERMS.some((term) => lower.includes(term.toLowerCase()));
  const hasLive = LIVE_TERMS.some((term) => lower.includes(term.toLowerCase()));
  const hasReview = REVIEW_TERMS.some((term) => lower.includes(term.toLowerCase()));
  if (!hasDouyin || !hasLive || !hasReview) return null;

  const missingInputs: ComposerExpertWorkflow['missingInputs'] = [];
  if (!SESSION_PATTERNS.some((pattern) => pattern.test(value))) {
    missingInputs.push('liveSession');
  }
  if (!hasReadyAttachment && !DATA_SOURCE_PATTERNS.some((pattern) => pattern.test(value))) {
    missingInputs.push('dataSource');
  }

  return {
    id: 'douyin-livestream-review',
    name: '抖音直播复盘',
    missingInputs,
  };
}

function labelForWorkflowInput(input: ComposerExpertWorkflow['missingInputs'][number]): string {
  switch (input) {
    case 'liveSession':
      return '直播场次';
    case 'dataSource':
      return '数据来源';
  }
}

/**
 * F3 — guidance actions are no longer plain strings. Most chips just
 * append their label to the composer (text-append), but the
 * "我会上传表格或截图" chip opens the file picker instead — clicking
 * it without actually attaching a file should NOT count as the data
 * source being satisfied (the prior text-append flow misled the
 * model into thinking data was already available).
 */
type GuidanceAction =
  | { label: string; kind: 'text' }
  | { label: string; kind: 'upload' };

function guidanceActionsForWorkflow(
  workflow: ComposerExpertWorkflow,
): GuidanceAction[] {
  const actions: GuidanceAction[] = [];
  if (workflow.missingInputs.includes('liveSession')) {
    actions.push(
      { label: '昨天整场直播', kind: 'text' },
      { label: '近 7 天直播汇总', kind: 'text' },
    );
  }
  if (workflow.missingInputs.includes('dataSource')) {
    actions.push(
      { label: '数据在抖音电商罗盘', kind: 'text' },
      { label: '我会上传表格或截图', kind: 'upload' },
    );
  }
  if (actions.length === 0) {
    actions.push(
      { label: '输出老板汇报版', kind: 'text' },
      { label: '输出详细运营复盘', kind: 'text' },
    );
  }
  return actions;
}

/**
 * Replaces the composer when the user has hit their period cap.
 * Three flavours of plan, each with a different button row:
 *
 *   free  → "升级到基础版" only (free has no add-on packs)
 *   basic → "购买加量包" + "升级专业版"
 *   pro   → "购买加量包" only (pro is the top tier; nothing to upgrade)
 *
 * Upgrade actions land at plan cards; add-on actions deep-link to
 * the top-up block so paid users don't have to scan past subscriptions.
 */
function QuotaExhaustedCard({
  plan,
  navigate,
}: {
  plan: string;
  navigate: (path: string) => void;
}): JSX.Element {
  const copy = quotaExhaustedCopy(plan);
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6">
      <div className="rounded-[8px] border border-[#DCDDDD] border-l-[#EA1F59] bg-white px-5 py-4 shadow-[0_4px_18px_rgba(15,23,42,0.055)] [border-left-width:3px] dark:border-white/10 dark:border-l-[#EA1F59] dark:bg-card/90">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#FFC910]/35 bg-[#FFC910]/15 text-[#57479C]">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-foreground">
                {copy.headline}
              </div>
              <span className="rounded-[8px] border border-[#EFEFEF] bg-[#FAFAFA] px-2 py-0.5 text-[11px] font-medium text-[#595757]">
                {copy.badge}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[#595757]">
              {copy.subline}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {copy.actions.map((action) =>
                action.primary ? (
                  <Button
                    key={action.kind}
                    size="sm"
                    onClick={() => navigate(action.path)}
                    className="bg-[#EA1F59] text-white hover:bg-[#D91B51]"
                  >
                    {action.label}
                  </Button>
                ) : (
                  <Button
                    key={action.kind}
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(action.path)}
                    className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 hover:text-[#EA1F59]"
                  >
                    {action.kind === 'addon' && (
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {action.label}
                  </Button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

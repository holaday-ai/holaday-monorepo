import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  Link2,
  ListChecks,
  Loader2,
  LogIn,
  MessageCircleQuestion,
  MoreHorizontal,
  MousePointerClick,
  Puzzle,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/toast';
import { FileDownloadCard, parseHoladayFilePayload } from '@/components/FileDownloadCard';
import { awaitingUserCopy } from '@/lib/awaiting-user-copy';
import { isBrowserErrorUrl } from '@/components/browser-panel-state';
import { copyTextToClipboard } from '@/lib/copy-text';
import {
  downloadFailureMessage,
  downloadFileAuthed,
  fetchFileBlobAuthed,
} from '@/lib/download-file';
import { taskActionError } from '@/lib/error-copy';
import { pageActionError } from '@/lib/page-error-copy';
import {
  externalLinkConfirmDescription,
  safeExternalHttpHref,
} from '@/lib/external-link-copy';
import { classifyFriendlyFailure, friendlyFailureDetail } from '@/lib/failure-copy';
import { formatFileSize } from '@/lib/file-size';
import { downloadFileMetaLabel } from '@/lib/file-download-card-copy';
import { downloadMarkdownFile } from '@/lib/markdown-download';
import { terminalArtifactFallbackText } from '@/lib/terminal-artifact-copy';
import { terminalEmptyCopy, terminalInsufficientCopy } from '@/lib/terminal-empty-copy';
import {
  stepDetailSummary,
  stepStatusText,
  type StepDetailSummary,
} from '@/lib/step-card-state';
import {
  matchResultSourceBadgePrefix,
  RESULT_SOURCE_BADGES,
  type ResultSourceMarker,
} from '@/lib/result-source-badges';
import { verificationBannerCopy } from '@/lib/verification-banner-copy';
import { ScheduledTaskDialog } from '@/components/ScheduledTaskDialog';
import { PlanCard } from '@/components/PlanCard';
import { SearchResultCard } from '@/components/SearchResultCard';
import { StepCard } from '@/components/StepCard';
import {
  taskCancelStateChangedMessage,
  terminalResultContentInsufficient,
} from '@/components/terminal-result-state';
import { hdDebug } from '@/lib/hd-debug';
import { trpc } from '@/lib/trpc';
import { useTaskStore } from '@/stores/task-store';
import { cn } from '@/lib/utils';
import type {
  UiAwaitingUser,
  UiCaptchaWait,
  UiDegradeEvent,
  UiExecutorFallback,
  UiStep,
  UiTask,
  UiTerminalAttachment,
  UiWebSearchEvent,
} from '@/types/task';
import { isTerminalStatus } from '@/types/task';
import { friendlyHost, humanizeStep, humanizedGlyph, liveStatusLabel } from '@/utils/step-humanize';
// Phase 1 follow-up — render-time defence-in-depth sanitiser. Strips
// markdown image references that point at agent screenshots, agent
// retry / reroute / login-wall narrative lines, lingering tool XML
// envelopes, and image-magic-byte base64. Runs on EVERY summary
// before ReactMarkdown — protects history rows that pre-date the
// orchestrator-side sanitiser too.
import { sanitizeForRender } from '@/utils/render-sanitizer';

interface Props {
  task: UiTask;
  /**
   * O5 — fired when the user clicks a suggestion chip rendered under
   * a terminal summary. The handler should treat the text as a fresh
   * intent submission. Caller (MainPanel) wires this to the same
   * onSubmit branch that input-area Enter uses, so the existing
   * follow-up auto-detection inherits parent context.
   */
  onPickSuggestion?: (intent: string) => void;
}

// Stable empty-array reference so the zustand selector below returns
// the SAME value on every render when the task has no steps yet. A
// fresh `[]` via `?? []` triggers React's getSnapshot cache warning
// and can loop infinitely under StrictMode.
const EMPTY_STEPS: UiStep[] = [];
const EMPTY_REPLIES: Array<{ at: number; text: string }> = [];
const PLAYED_TERMINAL_REVEAL_TASK_IDS = new Set<string>();
const TRUST_SURFACE =
  'rounded-lg border border-[#DCDDDD] bg-white/95 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85';
const TRUST_DIVIDER = 'border-[#DCDDDD]/80 dark:border-white/10';

function useMountedRef(): React.MutableRefObject<boolean> {
  const mountedRef = React.useRef(false);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

function hasPausedTerminalResult(task: UiTask): boolean {
  return task.status === 'paused' && Boolean(task.resultText);
}

function shouldShowVerificationBanner(task: UiTask): boolean {
  if (task.status === 'partial_success') return true;
  if (task.verificationPassed === false) return true;
  return (task.failedChecks?.length ?? 0) > 0;
}

/**
 * Conversational stream for one task. Emulates Claude's chat layout:
 *
 *   1. User intent as a right-biased bubble.
 *   2. One agent "message" block that narrates the run in plain
 *      language. Technical cards (navigate / click / screenshot /
 *      wait / ...) are folded into a collapsible "详细步骤" panel so
 *      the main area reads as prose, not a log file.
 *   3. Terminal summary rendered through react-markdown once the task
 *      reaches completed / failed / cancelled.
 *
 * The humanizer hides screenshot/wait/done steps entirely — they carry
 * no user-facing signal. Everything else becomes one line ("正在打开
 * 百度…" or "点击了'搜索'"), with a spinner-adorned status row for the
 * still-running tick.
 */
export function TaskStream({
  task,
  onPickSuggestion,
}: Props): JSX.Element {
  const steps = useTaskStore((s) => s.stepsByTask[task.taskId]) ?? EMPTY_STEPS;
  const userReplies =
    useTaskStore((s) => s.userRepliesByTask[task.taskId]) ?? EMPTY_REPLIES;
  const captchaWait = useTaskStore((s) => s.captchaWaitByTask[task.taskId]);
  const executorFallback = useTaskStore((s) => s.executorFallbackByTask[task.taskId]);
  const degrade = useTaskStore((s) => s.degradeByTask[task.taskId]);
  const screencast = useTaskStore((s) => s.screencastByTask[task.taskId]);
  const awaitingUser = useTaskStore((s) => s.awaitingUserByTask[task.taskId]);
  const webSearch = useTaskStore((s) => s.webSearchByTask[task.taskId]);
  const thinkingEvent = useTaskStore((s) => s.thinkingByTask[task.taskId]);
  const serverSuggestions = useTaskStore((s) => s.suggestionsByTask[task.taskId]);
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll only follows the live tail when:
  //   - the task hasn't reached a terminal state (still streaming
  //     deltas the user wants to see), AND
  //   - the user is already pinned near the bottom (< 200 px from
  //     scrollHeight). Switching to a historical task or scrolling
  //     up to read past content shouldn't yank the view back down.
  const isTerminal = isTerminalStatus(task.status) || hasPausedTerminalResult(task);
  React.useEffect(() => {
    if (isTerminal) return;
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    let parent: HTMLElement | null = anchor.parentElement;
    while (parent) {
      const overflowY = window.getComputedStyle(parent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      parent = parent.parentElement;
    }
    if (!parent) return;
    const distanceFromBottom =
      parent.scrollHeight - parent.scrollTop - parent.clientHeight;
    if (distanceFromBottom < 200) {
      anchor.scrollIntoView({ block: 'end' });
    }
  }, [
    isTerminal,
    steps.length,
    userReplies.length,
    captchaWait,
    executorFallback,
    degrade,
    awaitingUser,
    webSearch,
  ]);

  const terminal = isTerminalStatus(task.status) || hasPausedTerminalResult(task);

  const humanLines = React.useMemo(() => buildHumanLines(steps), [steps]);
  // Prefer the live thinking event from the supercar loop; fall back to
  // the (currently null) legacy picker so the hook stays in place if we
  // ever add thinking to the vision-loop path too.
  const thinking = thinkingEvent?.summary ?? pickThinking(steps);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-10 pt-8 sm:pb-6">
      <UserBubble intent={task.intent} />
      {userReplies.map((r) => (
        <UserBubble key={r.at} intent={r.text} />
      ))}

      <AgentBlock
        task={task}
        steps={steps}
        humanLines={humanLines}
        thinking={thinking}
        terminal={terminal}
        screencastUrl={screencast?.url ?? null}
        onSuggestionPick={onPickSuggestion}
        captchaWait={captchaWait}
        degrade={degrade}
        executorFallback={executorFallback}
        awaitingUser={awaitingUser}
        webSearch={webSearch}
        serverSuggestions={serverSuggestions}
      />

      <div ref={scrollAnchorRef} />
    </div>
  );
}

interface HumanLine {
  key: string;
  text: string;
  glyph: string;
  status: UiStep['status'];
}

function buildHumanLines(steps: UiStep[]): HumanLine[] {
  const out: HumanLine[] = [];
  for (const step of steps) {
    const text = humanizeStep(step);
    if (!text) continue;
    out.push({
      key: String(step.tickIndex),
      text,
      glyph: humanizedGlyph(step.actionKind),
      status: step.status,
    });
  }
  return out;
}

/**
 * Right now we don't have a real "thinking" stream from the commander;
 * until wired, return null so the UI just hides the block. The hook
 * stays in place so a future onThinking(...) delta can feed it.
 */
function pickThinking(_steps: UiStep[]): string | null {
  return null;
}

function AgentBlock({
  task,
  steps,
  humanLines,
  thinking,
  terminal,
  screencastUrl,
  onSuggestionPick,
  captchaWait,
  degrade,
  executorFallback,
  awaitingUser,
  webSearch,
  serverSuggestions,
}: {
  task: UiTask;
  steps: UiStep[];
  humanLines: HumanLine[];
  thinking: string | null;
  terminal: boolean;
  screencastUrl: string | null;
  onSuggestionPick?: (intent: string) => void;
  captchaWait: UiCaptchaWait | undefined;
  degrade: UiDegradeEvent | undefined;
  executorFallback: UiExecutorFallback | undefined;
  awaitingUser: UiAwaitingUser | undefined;
  webSearch: UiWebSearchEvent | undefined;
  serverSuggestions?: string[];
}): JSX.Element {
  const [detailOpen, setDetailOpen] = React.useState(false);
  // Phase 24 RC follow-up — generate / scrape streaming output. The
  // buffer accumulates `server.task.stream` deltas; the progress
  // string surfaces `server.task.progress` notes (e.g. "正在抓取
  // 网页数据…" before the first delta lands). Both are cleared on
  // terminal so the canonical resultText takes over.
  const streamingText = useTaskStore((s) => s.streamingByTask[task.taskId]);
  const progressMessage = useTaskStore((s) => s.progressByTask[task.taskId]);
  // Codex Pack B1 — live sub-status chip. Backend broadcasts
  // server.task.progress with a `subStatus` field at 5 phase
  // boundaries; store records it + a client-side `since` timestamp.
  const subStatusEntry = useTaskStore((s) => s.subStatusByTask[task.taskId]);
  // Set populated when a `server.task.terminal` arrives live — used
  // to gate the typewriter reveal so historical task clicks render
  // the summary statically (no per-mount replay).
  const animatedThisSession = useTaskStore((s) =>
    s.animatedTaskIds.has(task.taskId),
  );
  const animateTerminalReveal =
    animatedThisSession && !PLAYED_TERMINAL_REVEAL_TASK_IDS.has(task.taskId);
  React.useEffect(() => {
    if (!animateTerminalReveal) return;
    PLAYED_TERMINAL_REVEAL_TASK_IDS.add(task.taskId);
    if (PLAYED_TERMINAL_REVEAL_TASK_IDS.size > 200) {
      const oldest = PLAYED_TERMINAL_REVEAL_TASK_IDS.values().next().value;
      if (oldest) PLAYED_TERMINAL_REVEAL_TASK_IDS.delete(oldest);
    }
  }, [animateTerminalReveal, task.taskId]);
  hdDebug('TaskStream render', {
    taskId: task.taskId,
    status: task.status,
    hasBuffer: Boolean(streamingText),
    hasResultText: Boolean(task.resultText),
    bufferLen: streamingText?.length ?? 0,
    hasProgress: Boolean(progressMessage),
  });

  // Round-1 streaming rework: after humanizeStep filters tool_use
  // rows out of the main flow, the remaining lines are (almost)
  // entirely agent text preambles — Claude's own voice. We still
  // render a single LiveStatus below them while the task is
  // in-flight, derived from the latest non-null actionKind. If a
  // user wants the raw tool log they pop the "查看详细步骤" toggle.
  const latestRunningKind = React.useMemo<string | undefined>(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (!s) continue;
      if (s.actionKind) return s.actionKind;
    }
    return undefined;
  }, [steps]);
  const latestRunningStatus = steps[steps.length - 1]?.status ?? 'done';
  const detailSummary = React.useMemo(() => stepDetailSummary(steps), [steps]);

  const hasAnyActivity =
    humanLines.length > 0 ||
    Boolean(captchaWait) ||
    Boolean(degrade) ||
    Boolean(executorFallback) ||
    Boolean(awaitingUser) ||
    Boolean(webSearch) ||
    Boolean(task.resultText);

  const showInlineProgress = !terminal;
  const hasTerminalArtifacts =
    Boolean(task.attachments?.length) ||
    Boolean(task.finalUrl && task.finalUrl !== 'about:blank');

  // Product polish #5 — drop the "H" avatar circle. Assistant
  // output reads as a result card directly on the page (Codex /
  // ChatGPT workspace style), not as a chat-IM message. The
  // content space (max-w-3xl) and prose styling carry enough
  // structure that an avatar adds noise without information.
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-3">
        {/* Phase 13 Dim 1 — plan card lands above thinking + steps so
         *  the user sees the upcoming-step list as soon as the
         *  orchestrator emits server.task.plan (or on tab re-open
         *  via tasks.detail hydration). */}
        {task.planText && (
          <PlanCard
            planText={task.planText}
            {...(task.planStatus ? { planStatus: task.planStatus } : {})}
            // Fold the plan card by default once the task has landed in
            // a terminal state — at that point the result above and
            // the step ticker below already cover what happened, and
            // an expanded plan reads like a duplicate template log.
            // Fold for all terminal statuses, including partial success.
            defaultExpanded={!isTerminalStatus(task.status)}
          />
        )}

        {thinking && <ThinkingBlock text={thinking} />}

        {/* Codex Pack B1 — live sub-status chip. Shown when the runner
            has broadcast a phase marker AND the task isn't terminal.
            Takes precedence over BoardingLine since the chip is the
            more specific surface ("正在操作浏览器… 45s" beats "正在
            分析您的请求"). */}
        {!terminal && subStatusEntry && (
          <LiveSubStatusChip
            subStatus={subStatusEntry.subStatus}
            since={subStatusEntry.since}
          />
        )}
        {!hasAnyActivity && !terminal && !subStatusEntry && <BoardingLine />}

        {showInlineProgress && humanLines.length > 0 && (
          <HumanLineList lines={humanLines} />
        )}

        {/* Live progress pill — one line, spinner + current tool
         *  label. Shows while task is non-terminal and we have at
         *  least one step. Replaces the old stack of "完成一步操作"
         *  rows. The pill is *never* red while the task is still
         *  running; a single failed tick does not mean the task is
         *  failing. Only the task-level status controls colour. */}
        {showInlineProgress && steps.length > 0 && (
          <LiveStatus
            kind={latestRunningKind}
            taskTerminal={terminal}
            taskStatus={task.status}
            lastStepStatus={latestRunningStatus}
          />
        )}

        {showInlineProgress && screencastUrl && <CurrentUrlChip url={screencastUrl} />}

        {webSearch && !awaitingUser && <WebSearchLine event={webSearch} />}

        {captchaWait && <CaptchaWaitBanner wait={captchaWait} />}
        {degrade && !executorFallback && <DegradeBanner event={degrade} />}
        {executorFallback && <ExecutorFallbackBanner fallback={executorFallback} />}

        {awaitingUser && (
          <AwaitingUserBanner
            wait={awaitingUser}
            taskId={task.taskId}
            taskTickCount={task.tickCount}
          />
        )}

        {/* Phase 24 RC follow-up — incremental streaming output for
         *  generate + scrape tasks. Render gate (Bug 1 fix):
         *
         *    if task.resultText is set → TerminalSummary renders
         *      (block below this one)
         *    else if streamingText or progressMessage exist
         *      → render the streaming/progress view
         *
         *  Status check intentionally absent. The store now keeps
         *  buffers past terminal so this view bridges the ~200ms
         *  window between server.task.terminal arriving and
         *  task.resultText being merged from the API response.
         *  Without the bridge, the streaming view disappeared and
         *  TerminalSummary appeared, perceived as "two playbacks".
         *
         *  Render uses the SAME ReactMarkdown surface as
         *  TerminalSummary (matching prose styles + blue panel)
         *  so the transition to TerminalSummary is visually a
         *  no-op — only the supplementary controls (copy button,
         *  suggestion chips) light up when resultText lands. */}
        {!task.resultText && (progressMessage || streamingText) && (
            <div className={cn(TRUST_SURFACE, 'px-5 py-4 text-foreground')}>
              {progressMessage && !streamingText && (
                <div className="text-xs text-muted-foreground">
                  <span className="inline-block animate-pulse">●</span>{' '}
                  {progressMessage}
                </div>
              )}
              {streamingText && (
                <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert dark:prose-headings:text-foreground dark:prose-p:text-foreground/95 dark:prose-li:text-foreground/95 dark:prose-strong:text-foreground dark:prose-code:text-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {sanitizeMarkdownTrailingPunctuation(
                      sanitizeForRender(streamingText),
                    )}
                  </ReactMarkdown>
                  <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/40 align-baseline" />
                </div>
              )}
            </div>
          )}

        {/* Verification verdict banner. It appears as soon as the
            terminal status itself encodes a partial result, and also
            after detail hydration when verificationPassed=false or
            failed checks are present. This catches hard-fail verifier
            cases without showing a generic banner for ordinary runtime
            failures. */}
        {terminal && shouldShowVerificationBanner(task) && (
          <VerificationBanner
            level={task.failureLevel ?? 'fixable'}
            status={task.status}
            failedChecks={task.failedChecks ?? null}
          />
        )}
        {terminal && (task.resultText || hasTerminalArtifacts) && (
          <TerminalSummary
            status={task.status}
            text={task.resultText ?? ''}
            // task.finalUrl is the persisted final-page URL (R7), so
            // refreshes / history clicks still surface "打开最终浏览器"
            // even after the live screencast has gone. Live tasks
            // fall back to the screencast url so an in-flight URL
            // chip still tracks navigation.
            currentUrl={task.finalUrl ?? screencastUrl}
            taskId={task.taskId}
            // Phase 5a — pass the original intent so the 设为定时
            // button can pre-fill the ScheduledTaskDialog.
            intent={task.intent}
            onSuggestionPick={onSuggestionPick}
            serverSuggestions={serverSuggestions}
            // Phase 4 R1 — pass through metadata.attachments +
            // expertWorkflowId hydrated by tasks.detail so the
            // AttachmentBar + expert report header can render.
            attachments={task.attachments}
            expertWorkflowId={task.expertWorkflowId}
            // Typewriter reveal only fires for tasks that hit terminal
            // during this session (set populated in applyServerMessage).
            // History clicks render the summary in full immediately so
            // the panel doesn't replay-and-jitter on every navigation.
            animateReveal={animateTerminalReveal}
          />
        )}
        {/* Phase 11 QA #11 — terminal-but-empty fallback. Catches the
         *  edge case where a task is marked completed/failed in the DB
         *  but the result column never got a summary written (e.g.
         *  agent crashed mid-write, WS update raced with a refresh).
         *  Without this the panel renders just the H avatar — looks
         *  like the SPA broke. The retry hint mirrors the failed-card
         *  copy so the next-step is obvious. */}
        {terminal && !task.resultText && !hasTerminalArtifacts && (
          <EmptyTerminalCard status={task.status} intent={task.intent} />
        )}

        {steps.length > 0 && (
          <DetailToggle
            open={detailOpen}
            count={steps.length}
            summary={detailSummary}
            onToggle={() => setDetailOpen((v) => !v)}
          >
            {terminal && humanLines.length > 0 && (
              <div className="mt-2">
                <HumanLineList lines={humanLines} />
              </div>
            )}
            <div className="mt-2 space-y-2">
              {steps.map((step, i) => (
                <StepCard
                  key={step.tickIndex}
                  step={step}
                  isFirst={i === 0}
                  isLast={i === steps.length - 1}
                />
              ))}
            </div>
          </DetailToggle>
        )}
      </div>
    </div>
  );
}

/**
 * Yellow-highlighted card shown when the agent parked on a clarifying
 * question. The composer below (InputArea) flips to "回复 HOLA DAY..."
 * mode so Enter sends a reply instead of spawning a new task.
 */
function VerificationBanner({
  level,
  status,
  failedChecks,
}: {
  level: 'fixable' | 'needs_clarification' | 'hard_fail' | null;
  status: string;
  failedChecks: Array<{ type: string; detail: string }> | null;
}): JSX.Element {
  const copy = verificationBannerCopy({ level, status, failedChecks });
  const isDanger = copy.tone === 'danger';
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 text-sm shadow-[0_1px_3px_rgba(17,24,39,0.05)]',
        isDanger
          ? 'border-[#EA1F59]/35 bg-white text-[#595757] dark:border-[#EA1F59]/35 dark:bg-card/85 dark:text-foreground'
          : 'border-[#FFC910]/60 bg-white text-[#595757] dark:border-[#FFC910]/35 dark:bg-card/85 dark:text-foreground',
      )}
    >
      <div className="flex items-start gap-2.5">
        {isDanger ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA1F59]" />
        ) : (
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC910]" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'text-[11px] font-semibold uppercase tracking-wide',
              isDanger
                ? 'text-[#EA1F59]'
                : 'text-[#57479C]',
            )}
          >
            {copy.eyebrow}
          </div>
          <div className="mt-0.5 font-medium">{copy.title}</div>
          <p className="mt-1 leading-relaxed">{copy.body}</p>
          {copy.checks.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-0.5 leading-relaxed">
              {copy.checks.map((label, i) => (
                <li key={`${label}-${i}`}>{label}</li>
              ))}
            </ul>
          )}
          {copy.hiddenCount > 0 && (
            <div className="mt-1 text-xs opacity-75">
              另有 {copy.hiddenCount} 项检查未展开
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Codex Pack B3 — awaiting_user banner with typed cards.
 *
 * Backend already attaches `awaitingKind` to the WS event (supercar
 * agent-loop runs login / captcha / permission probes and writes
 * the verdict before parking). The banner reads that field and picks
 * an icon + title + body that match the kind of input the agent is
 * waiting for. All kinds share the same shell + progress summary +
 * cancel/continue affordances; only the lucide icon and the body
 * copy differ.
 *
 * `taskTickCount` powers the "已完成 N 步" summary. Cancel calls
 * tasks.abort which is the existing supercar abort path; the
 * orchestrator persists status='cancelled' and broadcasts
 * server.task.terminal. Continue is a no-op affordance pointing the
 * user at the composer (where tasks.reply actually lands the input).
 */
function AwaitingUserBanner({
  wait,
  taskId,
  taskTickCount,
}: {
  wait: UiAwaitingUser;
  taskId: string;
  taskTickCount: number;
}): JSX.Element {
  const toast = useToast();
  const mountedRef = useMountedRef();
  const [cancelling, setCancelling] = React.useState(false);
  const kind = wait.awaitingKind ?? 'clarification';
  const copy = awaitingUserCopy(kind);
  const Icon = AWAITING_KIND_ICON[kind] ?? AWAITING_KIND_ICON.clarification;
  const handleCancel = React.useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await trpc.tasks.abort.mutate({ taskId });
      if (!mountedRef.current) return;
      if (!res.ok) {
        toast.show(`取消失败：${taskCancelStateChangedMessage(res.state)}`, 'error');
        return;
      }
      toast.show('已取消任务', 'info', 2000);
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('取消失败', err), 'error');
    } finally {
      if (mountedRef.current) {
        setCancelling(false);
      }
    }
  }, [cancelling, mountedRef, taskId, toast]);
  // Clarification questions have the agent's actual prompt in
  // wait.question; the auth/permission kinds use a static prompt
  // because the agent didn't compose a fresh sentence. Show the
  // question text in clarification mode only.
  const showAgentQuestion = kind === 'clarification' && wait.question;
  return (
    <div className="rounded-lg border border-[#FFC910]/55 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-[#FFC910]/35 dark:bg-card/85">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#57479C]" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#57479C]">
            {copy.title}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {showAgentQuestion ? wait.question : copy.streamBody}
          </p>
          {showAgentQuestion && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              在下方输入框回答，任务会继续，不用重新提交。
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            {taskTickCount > 0 && (
              <span className="rounded-md border border-[#FFC910]/55 bg-[#FFC910]/10 px-2 py-0.5 text-[#595757] dark:border-[#FFC910]/35 dark:text-foreground">
                已完成 {taskTickCount} 步
              </span>
            )}
            <span className="text-muted-foreground">
              {copy.streamHint}
            </span>
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-[#DCDDDD] bg-transparent px-2.5 text-[#595757] transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/60 disabled:opacity-60 dark:border-white/10 dark:text-foreground dark:hover:bg-white/10"
            >
              {cancelling ? '正在取消…' : '取消任务'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const AWAITING_KIND_ICON: Record<
  NonNullable<UiAwaitingUser['awaitingKind']>,
  React.ComponentType<{ className?: string }>
> = {
  login: LogIn,
  captcha: ShieldAlert,
  clarification: MessageCircleQuestion,
  permission: KeyRound,
  browser_action: MousePointerClick,
};

/**
 * Compact "agent is on SITE" chip shown in the stream while a task is
 * executing. Gives visibility of the agent's current location even
 * when the BrowserPanel is collapsed or off-screen on mobile. Hidden
 * once the task reaches a terminal status — the TerminalSummary's
 * "在新标签页打开 <url>" affordance takes over from there.
 */
function CurrentUrlChip({ url }: { url: string }): JSX.Element | null {
  if (
    !url ||
    url === 'about:blank' ||
    url.startsWith('chrome://') ||
    isBrowserErrorUrl(url)
  ) return null;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const label = friendlyHost(host);
  return (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#DCDDDD] bg-white/80 px-2.5 py-1 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-white/5">
      <Globe className="h-3 w-3 shrink-0 text-[#42C0EF]" />
      <span className="truncate text-foreground/80">
        当前页：<span className="font-medium">{label}</span>
      </span>
      <span className="shrink-0 text-muted-foreground/60">·</span>
      <span className="max-w-[240px] truncate text-muted-foreground/70" title={url}>
        {url}
      </span>
    </div>
  );
}

/**
 * Inline "正在搜索 …" line for web_search events. When the event
 * carries `sources` (extracted from Anthropic's web_search_tool_result
 * block), the cards render below the query line so the user can see
 * exactly which pages Claude pulled from.
 */
function WebSearchLine({ event }: { event: UiWebSearchEvent }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
        <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#42C0EF]" />
        <span className="min-w-0 flex-1">
          正在联网搜索 <span className="text-foreground">"{event.query}"</span>
        </span>
      </div>
      {event.sources && event.sources.length > 0 && (
        <div className="ml-5">
          <SearchResultCard sources={event.sources} />
        </div>
      )}
    </div>
  );
}

/**
 * Single-line live progress indicator. Shown while the task is still
 * running; content is driven by the latest tick's actionKind (text →
 * "正在思考…", navigate → "正在打开页面…", etc.). Spinner animates;
 * the row replaces itself as new ticks arrive, so the chat stream
 * stays calm instead of accumulating twenty "完成一步操作" rows.
 *
 * When the latest tick has status='done' we don't dim the spinner —
 * a done tick means "last tool finished, next one is about to fire",
 * which from the user's POV is still "working".
 */
function LiveStatus({
  kind,
  taskTerminal,
  taskStatus,
  lastStepStatus,
}: {
  kind: string | undefined;
  taskTerminal: boolean;
  taskStatus: UiTask['status'];
  lastStepStatus: UiStep['status'];
}): JSX.Element {
  // Color policy:
  //   - Task running (not terminal) → muted text + magenta spinner
  //     (brand color signals "actively working"). Phase 4 R2 4d.
  //   - Task terminal + failed → red + AlertCircle
  //   - Otherwise → neutral
  const red = taskTerminal && taskStatus === 'failed';
  const label = liveStatusLabel(kind);
  // Intentionally unread: reserved for a future "warn but keep
  // running" variant that would render in amber when a non-terminal
  // task has a recently-failed tick. Not wired yet.
  void lastStepStatus;
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[13px] leading-5',
        red ? 'text-[#EA1F59]' : 'text-muted-foreground',
      )}
    >
      {red ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-[#EA1F59]"
          aria-hidden
        />
      )}
      <span>{label}</span>
    </div>
  );
}

/**
 * Codex Pack B1 — live phase chip.
 *
 * Mirrors BoardingLine's visual weight but reads from the
 * subStatusByTask store entry: shows the phase label ("正在规划任务",
 * "正在操作浏览器", "正在生成回答", etc.) + three animated dots +,
 * when the phase has been running for > 30s, an elapsed-time
 * suffix ("45s") so the user knows the task is still alive on a
 * long-running phase. Tick at 1Hz to avoid hot-rendering.
 */
function LiveSubStatusChip({
  subStatus,
  since,
}: {
  subStatus: 'planning' | 'browsing' | 'extracting' | 'verifying' | 'generating';
  since: number;
}): JSX.Element {
  const labels: Record<typeof subStatus, string> = {
    planning: '正在规划任务',
    browsing: '正在操作浏览器',
    extracting: '正在提取数据',
    verifying: '正在验证结果',
    generating: '正在生成回答',
  };
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const elapsedSec = Math.max(0, Math.floor((now - since) / 1000));
  const showTimer = elapsedSec >= 30;
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="text-foreground/70">{labels[subStatus]}</span>
      <span aria-hidden className="flex items-end text-muted-foreground">
        <span className="hola-typing-dot" />
        <span className="hola-typing-dot" />
        <span className="hola-typing-dot" />
      </span>
      {showTimer && (
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {elapsedSec < 60
            ? `${elapsedSec}s`
            : `${Math.floor(elapsedSec / 60)}分${elapsedSec % 60}s`}
        </span>
      )}
    </div>
  );
}

function BoardingLine(): JSX.Element {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="text-foreground/70">正在分析您的请求</span>
      <span aria-hidden className="flex items-end text-muted-foreground">
        <span className="hola-typing-dot" />
        <span className="hola-typing-dot" />
        <span className="hola-typing-dot" />
      </span>
    </div>
  );
}

function HumanLineList({ lines }: { lines: HumanLine[] }): JSX.Element {
  return (
    <ul className="space-y-1.5">
      {lines.map((line) => (
        <li key={line.key} className="flex items-start gap-2 text-sm leading-relaxed">
          <LineBadge status={line.status} glyph={line.glyph} />
          <span
            className={cn(
              'min-w-0 flex-1',
              line.status === 'failed' ? 'text-[#EA1F59]' : 'text-foreground',
              line.status === 'cancelled' && 'text-muted-foreground',
              line.status === 'running' && 'text-foreground',
            )}
          >
            {line.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LineBadge({
  status,
  glyph,
}: {
  status: UiStep['status'];
  glyph: string;
}): JSX.Element {
  const label =
    status === 'done'
      ? `${stepStatusText(status)} · ${glyph}`
      : stepStatusText(status);
  if (status === 'running') {
    return (
      <span
        className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#EA1F59]"
        aria-label={label}
        title={label}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#EA1F59]"
        aria-label={label}
        title={label}
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span
        className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground"
        aria-label={label}
        title={label}
      >
        <CircleSlash className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#42C0EF]"
      aria-label={label}
      title={label}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
    </span>
  );
}

function DetailToggle({
  open,
  count,
  summary,
  onToggle,
  children,
}: {
  open: boolean;
  count: number;
  summary: StepDetailSummary;
  onToggle(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group flex w-full items-center justify-between gap-3 rounded-[8px] border border-[#DCDDDD] bg-white/85 px-3 py-2 text-left shadow-[0_1px_3px_rgba(17,24,39,0.04)] transition-colors hover:border-[#ADADAD] hover:bg-white dark:border-white/10 dark:bg-card/80 dark:hover:bg-card"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border',
              stepDetailToneClass(summary.tone),
            )}
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">详细步骤</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {summary.label}
            </span>
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#DCDDDD] bg-white px-2.5 py-1 text-[11px] font-medium text-[#595757] transition-colors group-hover:border-[#ADADAD] dark:border-white/10 dark:bg-transparent dark:text-foreground">
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {!open && <span className="tabular-nums">{count}</span>}
        </span>
      </button>
      {open && children}
    </div>
  );
}

function stepDetailToneClass(tone: StepDetailSummary['tone']): string {
  if (tone === 'failed') return 'border-[#EA1F59]/35 bg-[#EA1F59]/10 text-[#EA1F59]';
  if (tone === 'running') return 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]';
  if (tone === 'done') return 'border-[#42C0EF]/45 bg-[#42C0EF]/10 text-[#42C0EF]';
  if (tone === 'cancelled') return 'border-[#ADADAD]/55 bg-[#EFEFEF]/70 text-[#595757]';
  return 'border-[#DCDDDD] bg-white text-[#595757]';
}

function ThinkingBlock({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const preview = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground"
    >
      <summary className="flex cursor-pointer items-center gap-1 list-none">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium uppercase tracking-wide text-[10px]">思考</span>
      </summary>
      <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{open ? text : preview}</p>
    </details>
  );
}

function UserBubble({ intent }: { intent: string }): JSX.Element {
  // Product polish #5 — drop the "Y" pink avatar. User input now
  // renders as a light right-aligned text block without an avatar
  // circle, matching Codex / ChatGPT workspace conventions.
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
        {intent}
      </div>
    </div>
  );
}

function CaptchaWaitBanner({ wait }: { wait: UiCaptchaWait }): JSX.Element {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const remainingSec = Math.max(0, Math.ceil((wait.deadlineMs - now) / 1000));
  return (
    <div
      role="alert"
      className="flex animate-fade-in items-start gap-3 rounded-lg border border-[#FFC910]/55 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-[#FFC910]/35 dark:bg-card/85"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 animate-pulse-dot text-[#57479C]" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-foreground">目标网站需要人工验证</div>
        <div className="mt-1 text-xs text-muted-foreground">{wait.message}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          请在右侧 Chrome 窗口中完成验证，HOLA DAY 将自动继续。
        </div>
        <div className="mt-2 text-[11px] font-medium text-[#57479C]">
          自动恢复窗口剩余：{remainingSec}s
        </div>
      </div>
    </div>
  );
}

function ExecutorFallbackBanner({
  fallback,
}: {
  fallback: UiExecutorFallback;
}): JSX.Element {
  if (!fallback.available) {
    return (
      <div
        role="alert"
        className="flex animate-fade-in items-start gap-3 rounded-lg border border-[#EA1F59]/35 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-[#EA1F59]/35 dark:bg-card/85"
      >
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#EA1F59]" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold text-foreground">反爬保护触发，但扩展未连接</div>
          <div className="mt-1 text-xs text-muted-foreground">
            HOLA DAY 想切到 Chrome 扩展继续任务，但没有检测到在线的扩展客户端。请安装并打开
            HOLA DAY 扩展后重试。
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex animate-fade-in items-start gap-3 rounded-lg border border-[#42C0EF]/40 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-[#42C0EF]/35 dark:bg-card/85">
      <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-[#42C0EF]" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-foreground">已切换到浏览器扩展模式执行</div>
        <div className="mt-1 text-xs text-muted-foreground">
          连续检测到反爬拦截，HOLA DAY 切到 Chrome 扩展继续任务，后续步骤会通过你已登录的
          Chrome 环境执行。
        </div>
      </div>
    </div>
  );
}

// Map the recovery escalation level to natural-language copy. The
// internal strategy name (`profile_rotation` / `proxy_swap` / etc.)
// reads as engineering jargon to a user — they don't need to know
// which lever the agent pulled, only that it's still trying. Pinned
// to the level number so the message stays stable as new strategies
// are added under each tier.
const DEGRADE_LEVEL_COPY: Readonly<Record<number, string>> = {
  1: '页面拦截了自动化访问，正在调整访问方式…',
  2: '正在尝试更稳定的访问方式…',
  3: '正在切换网络通道重试…',
};

function DegradeBanner({ event }: { event: UiDegradeEvent }): JSX.Element {
  const message =
    DEGRADE_LEVEL_COPY[event.level] ?? '正在尝试替代方案…';
  return (
    <div className="flex animate-fade-in items-start gap-3 rounded-lg border border-[#EA1F59]/35 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-[#EA1F59]/35 dark:bg-card/85">
      <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-[#EA1F59]" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-foreground">
          {message}
        </div>
        {!event.ok && (
          <div className="mt-1 text-xs text-muted-foreground">
            上一次尝试未生效，继续切换方式。
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * F3 — markdown parser sanitizer for trailing Chinese punctuation.
 * Bare URLs followed by ，。、！？；： get the punctuation eaten into
 * the href by remark-gfm's autolink — the rendered link's URL then
 * has a stray Chinese char appended, so clicking 404s. We pre-process
 * the source text and insert a space between URL body and trailing
 * Chinese punctuation. Markdown links `[label](url)` aren't affected
 * because the URL inside `(...)` ends at the closing `)`.
 *
 * Earlier draft used the broad CJK Punctuation + Halfwidth/Fullwidth
 * Forms ranges as the URL stop set. Although CJK ideographs aren't
 * in those ranges, the broad pattern was confusing and missed curly
 * quotes ("" '') which live in General Punctuation. Switched to an
 * explicit char list so the behaviour is obvious and we can be sure
 * Chinese path chars in URLs (e.g. /wiki/人工智能) survive untouched.
 *
 * Also exported for unit testing.
 */
// Unicode escapes for the curly quote pairs so the string literal
// stays unambiguous regardless of editor / clipboard behaviour
// (an ASCII ' inside this list would close the string and break
// the regex). “ / ” = " " (curly double); ‘ /
// ’ = ' ' (curly single).
const CJK_TRAILING_PUNCT = '，。、！？；：“”‘’（）【】《》';
const URL_STOP_CHARS = `\\s)\\]\\[${CJK_TRAILING_PUNCT}`;
const URL_TRAILING_PUNCT_RE = new RegExp(
  `(https?://[^${URL_STOP_CHARS}]+)([${CJK_TRAILING_PUNCT}])`,
  'g',
);
export function sanitizeMarkdownTrailingPunctuation(text: string): string {
  if (!text) return text;
  return text.replace(URL_TRAILING_PUNCT_RE, '$1 $2');
}

/**
 * Phase 4 R1 — expert-workflow header. When the supercar runs a
 * typed workflow (content-topic / ecom-daily / douyin-review), the
 * terminal-state metadata stamps `expertWorkflowId` so the SPA can
 * surface a header that names what the user is looking at instead
 * of just a wall of prose. Unknown ids → null (no header).
 *
 * The label list lives here rather than in a registry file because
 * there are only three workflows; adding a fourth is a one-line
 * edit. If the count grows the right move is to derive this from
 * packages/shared-types.
 */
const EXPERT_HEADER_META: Record<string, { label: string }> = {
  'content-topic': { label: '选题分析' },
  'ecom-daily': { label: '电商日报' },
  'douyin-review': { label: '抖音稿件复盘' },
};

function EmptyTerminalCard({
  status,
  intent,
}: {
  status: UiTask['status'];
  intent?: string;
}): JSX.Element {
  const copy = terminalEmptyCopy(status);
  const cancelled = status === 'cancelled';
  const failed = status === 'failed';
  const partial = status === 'partial_success';
  const retryable = failed || partial;
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const mountedRef = useMountedRef();
  const [retrying, setRetrying] = React.useState(false);
  const handleRetry = React.useCallback(async (): Promise<void> => {
    if (!intent || retrying) return;
    setRetrying(true);
    try {
      const result = await createTask(intent, []);
      if (!mountedRef.current) return;
      if ('error' in result) {
        toast.show(taskActionError('重新执行失败', result.error), 'error');
        return;
      }
      toast.show('已开始重新执行', 'info', 2000);
    } finally {
      if (mountedRef.current) {
        setRetrying(false);
      }
    }
  }, [createTask, intent, mountedRef, retrying, toast]);

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 text-sm shadow-[0_1px_3px_rgba(17,24,39,0.05)]',
        cancelled
          ? 'border-[#DCDDDD] bg-[#EFEFEF]/35 text-muted-foreground dark:border-white/10 dark:bg-white/5'
          : partial
            ? 'border-[#FFC910]/55 bg-white text-[#595757] dark:border-[#FFC910]/35 dark:bg-card/85 dark:text-foreground'
          : failed
            ? 'border-[#EA1F59]/35 bg-white text-[#595757] dark:border-[#EA1F59]/35 dark:bg-card/85 dark:text-foreground'
            : 'border-[#DCDDDD] bg-white text-muted-foreground dark:border-white/10 dark:bg-card/85',
      )}
    >
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground/70">
        {copy.title}
      </div>
      <div>{copy.body}</div>
      {retryable && intent && (
        <button
          type="button"
          aria-label="重新执行任务"
          title="重新执行任务"
          onClick={() => void handleRetry()}
          disabled={retrying}
          className={cn(
            'mt-3 inline-flex h-7 w-7 items-center justify-center rounded-md border bg-white/70 text-[11px] font-medium transition-colors hover:bg-[#EFEFEF]/50 disabled:cursor-wait disabled:opacity-60 dark:bg-transparent dark:hover:bg-white/10',
            partial
              ? 'border-[#FFC910]/60 text-[#57479C] dark:border-[#FFC910]/35 dark:text-foreground'
              : 'border-[#EA1F59]/40 text-[#EA1F59] dark:border-[#EA1F59]/35',
          )}
        >
          <RotateCcw className={cn('h-3 w-3', retrying && 'animate-spin')} />
        </button>
      )}
    </div>
  );
}

function ExpertReportHeader({ workflowId }: { workflowId: string }): JSX.Element | null {
  const meta = EXPERT_HEADER_META[workflowId];
  if (!meta) return null;
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-[#DCDDDD] pb-2 text-sm font-semibold text-[#57479C] dark:border-white/10 dark:text-foreground">
      <span>{meta.label}</span>
    </div>
  );
}

function BrowserErrorFinalUrlBanner(): JSX.Element {
  return (
    <div className="mb-3 rounded-md border border-[#EA1F59]/30 bg-[#EA1F59]/5 px-3 py-2 text-sm text-[#595757] dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10 dark:text-foreground">
      <div className="flex items-start gap-2">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-[#EA1F59]" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">网页没有成功打开</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            浏览器停在错误页。这次结果可作为失败原因诊断；要继续执行，请检查网址或换一个能直接访问的页面后重新执行。
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Phase 4 R1 — HOLA_FOLLOW_UP_ACTIONS extractor. The orchestrator
 * inserts an HTML-comment-delimited marker around a JSON array of
 * follow-up chip suggestions. This helper splits the body into:
 *   - cleanBody: the markdown body with the marker block removed
 *   - actions: the parsed string[] (empty on missing / malformed)
 *
 * The marker is invisible to ReactMarkdown anyway (HTML comments
 * are dropped during render); we strip the LITERAL marker so a
 * future Copy-as-Markdown doesn't surface "<!-- HOLA_FOLLOW_UP...".
 */
const FOLLOW_UP_ACTIONS_RE =
  /<!--\s*HOLA_FOLLOW_UP_ACTIONS_START\s*-->([\s\S]*?)<!--\s*HOLA_FOLLOW_UP_ACTIONS_END\s*-->/i;
function extractFollowUpActions(text: string): {
  cleanBody: string;
  actions: string[];
} {
  const m = FOLLOW_UP_ACTIONS_RE.exec(text);
  if (!m || !m[1]) return { cleanBody: text, actions: [] };
  const rawBlock = m[1].trim();
  let actions: string[] = [];
  try {
    const parsed = JSON.parse(rawBlock);
    if (Array.isArray(parsed)) {
      actions = parsed
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim())
        .slice(0, 4);
    }
  } catch {
    actions = [];
  }
  return { cleanBody: text.replace(FOLLOW_UP_ACTIONS_RE, '').trim(), actions };
}

function FollowUpChips({
  actions,
  onPick,
}: {
  actions: string[];
  onPick(intent: string): void;
}): JSX.Element {
  return (
    <div className="mt-4 rounded-[8px] border border-[#DCDDDD] bg-white p-2.5 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85">
      <div className="mb-2 flex items-center justify-between gap-3 px-1 text-[11px] font-medium tracking-wide text-muted-foreground">
        后续操作
        <span>{actions.length} 项</span>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
        {actions.map((a, i) => (
          <button
            key={`${i}-${a.slice(0, 12)}`}
            type="button"
            onClick={() => onPick(a)}
            className="group inline-flex min-h-8 max-w-full items-start gap-2 rounded-[6px] border border-[#DCDDDD] bg-white px-2.5 py-1.5 text-left text-xs font-medium text-[#595757] transition-colors hover:border-[#EA1F59]/35 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 sm:max-w-[280px] dark:border-white/10 dark:bg-white/5 dark:text-foreground/80 dark:hover:bg-[#EA1F59]/10 dark:hover:text-foreground"
          >
            <ChevronRight
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ADADAD] transition-transform group-hover:translate-x-0.5 group-hover:text-[#EA1F59]"
              aria-hidden
            />
            <span className="min-w-0 flex-1 leading-5">{a}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Phase 4 R1 — SourceBadge classifier. The model labels grounded
 * facts with a leading source marker:
 *   user marker = 用户提供 (user-provided)
 *   calculated marker = 系统计算 (system-derived)
 *   assumed marker = 模型假设 (model assumption)
 *   external marker = 外部基准 (external benchmark)
 *
 * Each gets a colored pill + tooltip so the user can scan at a
 * glance which numbers are observed vs. assumed. New reports use
 * bracketed markers. Legacy markers are accepted via escaped code
 * points so old task history still renders cleanly.
 */
/**
 * Phase 4 R2 — screenshot thumbnail card. Replaces the generic
 * FileDownloadCard (icon + filename) for `kind === 'screenshot'`
 * attachments so the user sees the actual image they're about to
 * download instead of a placeholder paperclip.
 *
 * Auth: same Bearer-token fetch FileDownloadCard already uses. We
 * pull the blob ONCE, build a same-origin object URL, and feed it
 * into `<img src>`. Object URL is revoked on unmount so a long task
 * list with many screenshots doesn't leak blobs.
 *
 * Failure paths:
 *   - fetch / 401 / blob read errors → fall through to the icon-only
 *     FileDownloadCard so the user still has SOMETHING clickable
 *   - while loading → small skeleton box at the same aspect ratio
 *
 * Click on the thumbnail OR the download icon → reuses the same
 * downloadAuthed flow as FileDownloadCard (fresh fetch + blob hop).
 */
function ScreenshotThumbnailCard({
  payload,
}: {
  payload: import('./FileDownloadCard').FileDownloadPayload;
}): JSX.Element {
  const toast = useToast();
  const mountedRef = useMountedRef();
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [downloadState, setDownloadState] = React.useState<
    'idle' | 'loading' | 'failed'
  >('idle');
  React.useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    void fetchFileBlobAuthed({ url: payload.downloadUrl }).then((res) => {
      if (cancelled) return;
      if (!res.ok || !res.blob) {
        // BOSS bug fix — log so DevTools shows the reason instead
        // of a silently broken image. Common causes: 404 from a
        // stale download URL, 401 from a missing/expired token,
        // 410 after 24h TTL.
        hdDebug('screenshot-preview-fetch-failed', {
          status: res.status,
          message: res.message,
          url: payload.downloadUrl,
        });
        setFailed(true);
        return;
      }
      // Defensive: server returned 200 but the body isn't an image
      // (e.g. an HTML error page rendered with status 200). The
      // <img> would just show alt text otherwise — confusing.
      if (res.mime && !res.mime.startsWith('image/')) {
        hdDebug('screenshot-preview-wrong-mime', {
          mime: res.mime,
          url: payload.downloadUrl,
        });
        setFailed(true);
        return;
      }
      createdUrl = URL.createObjectURL(res.blob);
      setPreviewUrl(createdUrl);
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [payload.downloadUrl]);
  React.useEffect(() => {
    if (downloadState !== 'failed') return;
    const id = window.setTimeout(() => setDownloadState('idle'), 3_000);
    return () => window.clearTimeout(id);
  }, [downloadState]);

  // Auth fetch failed — fall back to the original card so the user
  // can still try a manual click (which retries the fetch).
  if (failed) {
    return <FileDownloadCard payload={payload} />;
  }
  const handleClick = async (): Promise<void> => {
    if (downloadState === 'loading') return;
    setDownloadState('loading');
    const result = await downloadFileAuthed({
      url: payload.downloadUrl,
      filename: payload.filename,
    });
    if (!mountedRef.current) return;
    if (result.ok) {
      setDownloadState('idle');
    } else {
      setDownloadState('failed');
      toast.show(downloadFailureMessage(result.status), 'error');
    }
  };
  const metaLabel = downloadFileMetaLabel({
    filename: payload.filename,
    formattedSize: formatFileSize(payload.size),
  });
  const actionLabel = `下载图片文件 ${payload.filename}`;
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={downloadState === 'loading'}
      aria-busy={downloadState === 'loading'}
      className={cn(
        'group my-2 flex w-full max-w-md flex-col gap-2 overflow-hidden rounded-[8px] border bg-white p-2 text-left shadow-[0_1px_3px_rgba(17,24,39,0.05)] transition-colors dark:bg-card/85',
        downloadState === 'failed'
          ? 'border-[#EA1F59]/40 bg-[#EA1F59]/5'
          : downloadState === 'loading'
            ? 'border-[#57479C]/40 bg-[#57479C]/5 opacity-90'
            : 'border-[#DCDDDD] hover:border-[#ADADAD] hover:bg-[#EFEFEF]/35 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.04]',
      )}
      aria-label={actionLabel}
      title={actionLabel}
    >
      <div className="relative w-full overflow-hidden rounded-[6px] border border-[#DCDDDD]/70 bg-[#EFEFEF]/45 dark:border-white/10 dark:bg-white/5">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="截图预览"
            className="block max-h-72 w-full object-contain transition-transform group-hover:scale-[1.01]"
            loading="lazy"
            onError={() => {
              // BOSS bug fix — blob decoded as image failed in the
              // browser. Fall back to the icon card so the user
              // still has a working download path.
              hdDebug('screenshot-preview-img-decode-failed', {
                url: payload.downloadUrl,
              });
              setFailed(true);
            }}
          />
        ) : (
          <div
            aria-hidden
            className="hola-skel block h-48 w-full bg-[#EFEFEF]/70"
          />
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-[#DCDDDD]/70 px-1 pb-0.5 pt-2 text-xs dark:border-white/10">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground" title={payload.filename}>
            {payload.filename}
          </div>
          <div
            className={cn(
              'mt-0.5 text-[11px]',
              downloadState === 'failed'
                ? 'text-[#EA1F59]'
                : 'text-muted-foreground',
            )}
          >
            {downloadState === 'loading'
              ? '正在下载…'
              : downloadState === 'failed'
                ? '下载失败，点击重试'
                : metaLabel}
          </div>
        </div>
        {downloadState === 'loading' ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#EA1F59]" />
        ) : (
          <Download
            className={cn(
              'h-4 w-4 shrink-0 transition-colors',
              downloadState === 'failed'
                ? 'text-[#EA1F59]'
                : 'text-muted-foreground group-hover:text-[#EA1F59]',
            )}
          />
        )}
      </div>
    </button>
  );
}

function SourceBadge({ marker }: { marker: ResultSourceMarker }): JSX.Element {
  const meta = RESULT_SOURCE_BADGES[marker] ?? null;
  if (!meta) {
    return <span className="sr-only">{marker}</span>;
  }
  return (
    <span
      title={`${meta.label}：${meta.description}`}
      aria-label={`${meta.label}：${meta.description}`}
      className={cn(
        'mr-1.5 inline-flex items-center gap-1.5 rounded-[6px] border px-1.5 py-0.5 text-[10px] font-medium leading-none align-middle shadow-[0_1px_2px_rgba(17,24,39,0.03)]',
        meta.tone,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', meta.dotTone)} />
      {meta.label}
    </span>
  );
}

function MarkdownCodeBlock({
  children,
  languageClassName,
  rest,
}: {
  children: React.ReactNode;
  languageClassName?: string;
  rest: Record<string, unknown>;
}): JSX.Element {
  const toast = useToast();
  const mountedRef = useMountedRef();
  const [copied, setCopied] = React.useState(false);
  const text = React.useMemo(() => reactNodeText(children).replace(/\n$/, ''), [children]);
  const languageLabel = markdownLanguageLabel(languageClassName);
  const handleCopy = async (): Promise<void> => {
    if (!text) return;
    const copiedOk = await copyTextToClipboard(text);
    if (!mountedRef.current) return;
    if (copiedOk) {
      setCopied(true);
      toast.show('已复制代码');
      window.setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, 1600);
    } else {
      toast.show('复制失败', 'error');
    }
  };
  return (
    <div className="my-3 overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85">
      <div className="flex items-center justify-between gap-3 border-b border-[#EFEFEF] bg-[#EFEFEF]/45 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#57479C]" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {languageLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={!text}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-white hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
          aria-label={copied ? '代码块已复制' : '复制代码块'}
          title={copied ? '已复制' : '复制代码'}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-[#42C0EF]" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
      <pre
        className="max-w-full overflow-x-auto bg-[#EFEFEF]/20 px-3 py-3 text-[12px] leading-relaxed dark:bg-white/[0.02]"
        {...rest}
      >
        <code className="block min-w-max whitespace-pre font-mono text-foreground/90">
          {text || reactNodeText(children)}
        </code>
      </pre>
    </div>
  );
}

function markdownLanguageLabel(className?: string): string {
  const raw = className?.replace(/^language-/, '').trim();
  if (!raw) return '代码';
  const known: Record<string, string> = {
    bash: 'SHELL',
    sh: 'SHELL',
    shell: 'SHELL',
    zsh: 'SHELL',
    js: 'JavaScript',
    javascript: 'JavaScript',
    jsx: 'JSX',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    tsx: 'TSX',
    json: 'JSON',
    toml: 'TOML',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return known[raw.toLowerCase()] ?? raw.toUpperCase();
}

function reactNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join('');
  if (React.isValidElement(node)) {
    return reactNodeText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

function TerminalSummary({
  status,
  text,
  currentUrl,
  taskId,
  intent,
  onSuggestionPick,
  serverSuggestions,
  attachments,
  expertWorkflowId,
  animateReveal = true,
}: {
  status: UiTask['status'];
  text: string;
  currentUrl?: string | null;
  /** Task id — used by the share button to build a deep link. */
  taskId?: string;
  /**
   * Phase 5a — the underlying task's intent. Pre-fills the
   * ScheduledTaskDialog so "设为定时" is a one-click setup for the
   * exact thing the user just ran.
   */
  intent?: string;
  onSuggestionPick?: (intent: string) => void;
  /**
   * O5 — backend-generated suggestions arriving via
   * `server.supercar.suggestions`. When present, takes precedence
   * over the markdown-parsed in-summary block (the new
   * generate-after-task path is more reliable than asking the agent
   * to emit a JSON block in its summary).
   */
  serverSuggestions?: string[];
  /**
   * Phase 4 R1 — downloadable artifacts from
   * `result.metadata.attachments[]`. Rendered as a row of
   * FileDownloadCards below the markdown body, above the
   * copy/share footer. Empty / undefined → no bar.
   */
  attachments?: ReadonlyArray<UiTerminalAttachment>;
  /**
   * Phase 4 R1 — expert workflow id from
   * `result.metadata.expertWorkflowId`. When present, renders a
   * "电商日报" / "选题分析" / "抖音稿件复盘" header above
   * the markdown body. Unknown ids fall through to no header.
   */
  expertWorkflowId?: string;
  /**
   * When false (e.g. user clicked into a historical task), skip the
   * typewriter reveal — render the full summary immediately. Default
   * `true` preserves the live-completion experience.
   */
  animateReveal?: boolean;
}): JSX.Element {
  const toast = useToast();
  const mountedRef = useMountedRef();
  // Phase 4 R1 — extract HOLA_FOLLOW_UP_ACTIONS BEFORE the legacy
  // suggestions block scan so the marker doesn't survive into the
  // typewriter / markdown render.
  const { textWithoutFollowUps, followUpActions } = React.useMemo(() => {
    const { cleanBody, actions } = extractFollowUpActions(text);
    return { textWithoutFollowUps: cleanBody, followUpActions: actions };
  }, [text]);
  // Legacy: pull a fenced ```suggestions JSON block out of the
  // model's text. Kept as a fallback for tasks that completed before
  // the backend generator landed (or when the generator failed).
  // The visible text always has the block stripped so users don't
  // see raw JSON regardless of which suggestion source wins.
  const { displayText, suggestions: parsedSuggestions } = React.useMemo(() => {
    const re = /```suggestions\s*\n([\s\S]*?)\n```/i;
    const m = re.exec(textWithoutFollowUps);
    if (!m || !m[1]) return { displayText: textWithoutFollowUps, suggestions: [] as string[] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      return {
        displayText: textWithoutFollowUps.replace(re, '').trim(),
        suggestions: [] as string[],
      };
    }
    const list =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { suggestions?: unknown }).suggestions)
        ? ((parsed as { suggestions: unknown[] }).suggestions
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim())
            .slice(0, 3))
        : [];
    return {
      displayText: textWithoutFollowUps.replace(re, '').trim(),
      suggestions: list,
    };
  }, [textWithoutFollowUps]);
  // Backend suggestions take precedence; fall back to whatever the
  // model embedded in its text. Either way, the chip render path
  // below sees a single canonical `suggestions` array.
  const suggestions =
    serverSuggestions && serverSuggestions.length > 0
      ? serverSuggestions
      : parsedSuggestions;
  // O10 — typewriter reveal of the SUMMARY text only (failed cards
  // skip this so users see the failure reason immediately). Resets
  // when text changes (new task / re-render with fresh content).
  // History clicks pass animateReveal=false so the summary renders
  // statically — no replay on every navigation.
  const revealed = useTypewriterReveal(displayText, 80, animateReveal);
  // Round-3 #4: external-link confirm. Both markdown anchors and
  // the "在新标签页打开 [url]" button funnel through pendingLink —
  // users get a confirm modal before leaving the workbench.
  const [pendingLink, setPendingLink] = React.useState<string | null>(null);
  // Phase 5a — ScheduledTaskDialog visibility (set by 设为定时 button).
  const [scheduleDialogOpen, setScheduleDialogOpen] = React.useState(false);
  const md = React.useMemo(
    () => makeMarkdownComponents({ onExternalClick: (href) => setPendingLink(href) }),
    [],
  );
  // Three terminal states share the same shell — markdown body,
  // optional model line, inline copy/share footer, optional URL row.
  // Only colors + the small status pill differ. Failed used to be a
  // whitespace-pre block with no copy buttons; cancelled used the
  // failed branch verbatim. Both now look like the success card so
  // users can copy a failure summary into a bug report just as
  // easily as a successful answer.
  const isFailedLike = status === 'failed' || status === 'cancelled';
  // Codex IA pass — every terminal state shares the same neutral
  // surface so the result reads as a work product, not a colored
  // alert dialog. Failure / cancellation get a small inline alert
  // block at the top of the card; the wrap itself stays calm.
  const tone = {
    wrap: cn(TRUST_SURFACE, 'px-5 py-4 text-foreground'),
    divider: TRUST_DIVIDER,
  };
  const safeCurrentUrl = safeExternalHttpHref(currentUrl);
  const hasRealUrl = safeCurrentUrl !== null;
  const endedOnBrowserErrorPage = isBrowserErrorUrl(currentUrl);
  const fallbackPlainText = React.useMemo(
    () =>
      terminalArtifactFallbackText({
        text: displayText,
        attachmentCount: attachments?.length ?? 0,
        finalUrl: safeCurrentUrl,
      }),
    [attachments?.length, displayText, safeCurrentUrl],
  );
  // Strip markdown syntax for the plain-text Copy. Keeps `[label](url)` →
  // `label`, drops `**bold**` markers, code fences, list bullets — the
  // user gets what they'd visually read. The markdown copy keeps the raw
  // source so paste into Notion / Slack / a doc editor preserves
  // structure.
  const plainText = React.useMemo(
    () => stripMarkdown(displayText) || fallbackPlainText,
    [displayText, fallbackPlainText],
  );
  const markdownText = displayText.trim() || fallbackPlainText;
  const copyTo = React.useCallback(
    async (value: string, label: string): Promise<void> => {
      if (await copyTextToClipboard(value)) {
        toast.show(`已复制${label}`);
      } else {
        toast.show('复制失败', 'error');
      }
    },
    [toast],
  );
  // BOSS feedback — retry button on failed task. Creates a NEW
  // task (not a reply), so quota + supercar prompt + role
  // classification all run fresh. createTask emits the
  // server.task.* WS events that the AppShell's URL effect uses to
  // navigate to the new task automatically — no manual route push
  // needed here.
  const createTask = useTaskStore((s) => s.createTask);
  const [retryingIntent, setRetryingIntent] = React.useState<string | null>(null);
  const handleRetry = React.useCallback(
    async (retryIntent: string): Promise<void> => {
      if (retryingIntent) return;
      setRetryingIntent(retryIntent);
      try {
        const result = await createTask(retryIntent, []);
        if (!mountedRef.current) return;
        if ('error' in result) {
          toast.show(taskActionError('重新执行失败', result.error), 'error');
          return;
        }
        toast.show('已开始重新执行', 'info', 2000);
      } finally {
        if (mountedRef.current) {
          setRetryingIntent(null);
        }
      }
    },
    [createTask, mountedRef, retryingIntent, toast],
  );
  // Codex IA close-out — the result card no longer hosts the
  // browser-panel entry. That moved to TaskToolbar at the top of the
  // Main column so the result stays focused on the work product.
  return (
    <div className={cn('relative', tone.wrap)}>
      {isFailedLike && (
        <FailureHeaderCard
          status={status}
          errorText={status === 'failed' ? displayText ?? '' : ''}
        />
      )}
      {!isFailedLike && endedOnBrowserErrorPage && (
        <BrowserErrorFinalUrlBanner />
      )}
      {/* Phase 4 R1 B.6 — expert-report header (only on success
          panels; failed/cancelled never carry a workflow id). */}
      {!isFailedLike && expertWorkflowId && (
        <ExpertReportHeader workflowId={expertWorkflowId} />
      )}
      {/* BOSS feedback — skip the markdown body for failed tasks
          to avoid duplicating the error text already shown in
          FailureHeaderCard's collapsible. Cancelled status keeps
          the body because there's often partial content worth
          preserving. */}
      {status === 'failed' ? null : (() => {
        // Empty-result fallback. When the sanitized text is
        // suspiciously short (< 20 chars after stripping markdown
        // structure / ordinals / whitespace), surface a hint card
        // instead of rendering a near-empty prose block. Common
        // causes: model hit max_tokens before producing real content,
        // post-check ate everything, tool output was structurally
        // invalid. Threshold matches the orchestrator's answer-verifier
        // checkEmptyResult so the SPA never displays a near-empty
        // success card the backend would have flagged fixable.
        //
        // BUG-A2 fix (2026-05-20): bypass the empty-result card when
        // the original (un-sanitized) answer is substantial (>200
        // non-whitespace chars). Structured Chinese answers heavy on
        // headers / tables / bullets sanitize to a small "meaningful"
        // slice even when the user is reading a rich response — the
        // sanitizer was stripping `^#{1,6}\s+.*$` (full header lines)
        // and `[|*_]` table/emphasis markers, which over-eats long
        // markdown reports. 200 is generous enough that no genuinely
        // empty answer can hit it, but small enough to still catch
        // the original failure mode (single-line stub / pure ordinals).
        const sanitized = sanitizeMarkdownTrailingPunctuation(
          sanitizeForRender(revealed),
        );
        if (terminalResultContentInsufficient({
          status,
          displayText,
          revealedText: sanitized,
          intent,
          attachmentCount: attachments?.length ?? 0,
        })) {
          const copy = terminalInsufficientCopy();
          return (
            <div className="rounded-md border border-[#FFC910]/55 bg-[#FFC910]/10 px-3 py-2.5 text-sm text-[#595757] dark:border-[#FFC910]/35 dark:text-foreground">
              <div className="font-medium">{copy.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {copy.body}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {intent && onSuggestionPick && (
                  <button
                    type="button"
                    onClick={() => onSuggestionPick(intent)}
                    aria-label="填入原描述"
                    title="填入原描述后可编辑再发送"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#FFC910]/60 bg-white/70 px-2.5 text-[11px] font-medium text-[#57479C] transition-colors hover:bg-white dark:border-[#FFC910]/35 dark:bg-transparent dark:text-foreground dark:hover:bg-white/10"
                  >
                    <RotateCcw className="h-3 w-3" />
                    填入原描述
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const feedback = displayText.trim() || '(空结果)';
                    void copyTo(feedback, '反馈内容');
                  }}
                  aria-label="复制反馈内容"
                  title="复制反馈"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#DCDDDD] bg-white/60 text-[#595757] transition-colors hover:border-[#ADADAD] hover:bg-white dark:border-white/10 dark:bg-transparent dark:text-foreground dark:hover:bg-white/10"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        }
        return (
          <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert dark:prose-headings:text-foreground dark:prose-p:text-foreground/95 dark:prose-li:text-foreground/95 dark:prose-strong:text-foreground dark:prose-code:text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
              {sanitized}
            </ReactMarkdown>
          </div>
        );
      })()}
      {/* Phase 4 R1 B.5 — AttachmentBar. Hidden when attachments is
          empty/undefined. Rendered for every terminal status: failed
          and cancelled tasks can still leave useful evidence files. */}
      {attachments && attachments.length > 0 && (
        <div className={cn('mt-3 flex flex-col gap-2 border-t pt-3', TRUST_DIVIDER)}>
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
            产出文件
          </div>
          {attachments.map((a) => {
            const payload = {
              fileId: a.fileId,
              filename: a.filename,
              size: a.sizeBytes,
              downloadUrl: a.downloadUrl,
            };
            // Phase 4 R2 — screenshots get a thumbnail preview; other
            // kinds (PDF, generic file) keep the icon-only card.
            if (a.kind === 'screenshot' || a.mimetype.startsWith('image/')) {
              return <ScreenshotThumbnailCard key={a.fileId} payload={payload} />;
            }
            return <FileDownloadCard key={a.fileId} payload={payload} />;
          })}
        </div>
      )}
      {/* Phase 4 Codex follow-up — model-tier label, brand-neutral.
          The previous text leaked the underlying model ID ("Claude
          Sonnet 4.6") into the user-facing surface, which contradicts
          B.1's whole-product-side sanitizer. Now we surface the tier
          intent (deep vs. standard) without naming the upstream model;
          the actual claude-* ID still lives in result.metadata for
          analytics / debugging consumers. */}
      {/* BOSS feedback — the "标准执行模式 / 深度思考模式" footer
          surfaced the model tier to the user. Average users don't
          need that signal; it added visual noise to every result
          card. modelLabel still rides through props for analytics
          / debugging consumers via result.metadata, just not
          rendered here. */}
      {/* Codex Pack C1 — expert-skill footer. Shows when a typed
          workflow id was stamped on the task metadata (the matcher
          fired OR the user forced expert mode). Single skill per
          task is the only shape today (X = 1); the "X 个" phrasing
          stays per spec so a future multi-skill path renders without
          template change. */}
      {expertWorkflowId && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Puzzle className="h-3 w-3 text-muted-foreground/70" />
          <span>
            本次使用了 1 个专家技能
            {EXPERT_HEADER_META[expertWorkflowId]
              ? `（${EXPERT_HEADER_META[expertWorkflowId]!.label}）`
              : ''}
          </span>
        </div>
      )}
      {/* Inline copy / share footer. Replaced the prior absolute-
          positioned overlay (top-right, opacity-0 group-hover) which
          obscured the first lines of the result on overflow and
          never appeared on touch. Always visible, sits below the
          body so it doesn't compete with the content. */}
      {/* Footer (Codex IA pass). The primary action stays inline —
          复制 — because it's the action 90% of users take first.
          复制为 Markdown / 下载 .md / 分享任务 / 设为定时 fold into a
          单一 Radix More menu so the row isn't a wall of text
          buttons. 浏览器 lives in the top-right of the card;
          打开最终浏览器 keeps its own URL row below. */}
      <div
        className={cn(
          'mt-3 flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between',
          tone.divider,
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyTo(plainText, '纯文本')}
            aria-label="复制纯文本结果"
            title="复制"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#DCDDDD] bg-white/75 font-medium text-[#595757] shadow-[0_1px_2px_rgba(17,24,39,0.04)] transition-colors hover:border-[#EA1F59]/35 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 dark:border-white/10 dark:bg-white/5 dark:text-foreground/80 dark:hover:border-[#EA1F59]/40 dark:hover:bg-[#EA1F59]/10 dark:hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {/* BOSS feedback — retry button on failed tasks. Re-fires
              the original intent as a brand-new task via the store
              (NOT a reply, so quota + supercar prompt are fresh).
              Cancelled tasks don't get retry — they were stopped
              on purpose. */}
          {status === 'failed' && intent && (
            <button
              type="button"
              onClick={() => void handleRetry(intent)}
              disabled={retryingIntent != null}
              aria-label={retryingIntent ? '正在重新执行任务' : '重新执行任务'}
              title={retryingIntent ? '正在重新执行' : '重新执行任务'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#EA1F59]/25 bg-[#EA1F59]/5 font-medium text-[#EA1F59] transition-colors hover:border-[#EA1F59]/45 hover:bg-[#EA1F59]/10 hover:text-[#c80a5d] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20"
            >
              <RotateCcw className={cn('h-3.5 w-3.5', retryingIntent && 'animate-spin')} aria-hidden />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="打开更多结果操作"
              title="更多"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#DCDDDD] bg-white/60 font-medium text-[#595757] shadow-[0_1px_2px_rgba(17,24,39,0.03)] transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20 dark:border-white/10 dark:bg-white/5 dark:text-foreground/75 dark:hover:bg-white/10"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            sideOffset={8}
            className="w-52 rounded-[8px] border-[#DCDDDD] bg-white p-1.5 shadow-[0_12px_28px_rgba(17,24,39,0.12)] dark:border-white/10 dark:bg-card"
          >
            <DropdownMenuItem
              onSelect={() => void copyTo(markdownText, '为 Markdown')}
              className="rounded-[6px] text-[13px] text-[#595757] focus:bg-[#EFEFEF]/65 focus:text-[#EA1F59] dark:text-foreground/80 dark:focus:bg-white/10 dark:focus:text-foreground"
            >
              <FileText className="text-[#ADADAD]" />
              <span>复制为 Markdown</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (downloadMarkdownFile(markdownText, taskId)) {
                  toast.show('已开始下载 .md 文件');
                } else {
                  toast.show('下载失败，请复制内容后手动保存', 'error');
                }
              }}
              className="rounded-[6px] text-[13px] text-[#595757] focus:bg-[#EFEFEF]/65 focus:text-[#EA1F59] dark:text-foreground/80 dark:focus:bg-white/10 dark:focus:text-foreground"
            >
              <Download className="text-[#ADADAD]" />
              <span>下载 .md</span>
            </DropdownMenuItem>
            {taskId && (
              <DropdownMenuItem
                onSelect={() => {
                  const origin =
                    typeof window !== 'undefined' ? window.location.origin : '';
                  void copyTo(
                    `${origin}/?task=${encodeURIComponent(taskId)}`,
                    '任务链接',
                  );
                }}
                className="rounded-[6px] text-[13px] text-[#595757] focus:bg-[#EFEFEF]/65 focus:text-[#EA1F59] dark:text-foreground/80 dark:focus:bg-white/10 dark:focus:text-foreground"
              >
                <Link2 className="text-[#ADADAD]" />
                <span>分享任务</span>
              </DropdownMenuItem>
            )}
            {!isFailedLike && intent && (
              <DropdownMenuItem
                onSelect={() => setScheduleDialogOpen(true)}
                className="rounded-[6px] text-[13px] text-[#595757] focus:bg-[#EFEFEF]/65 focus:text-[#EA1F59] dark:text-foreground/80 dark:focus:bg-white/10 dark:focus:text-foreground"
              >
                <Clock className="text-[#ADADAD]" />
                <span>设为定时</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Phase 4 R1 B.2 — FollowUpChips. The orchestrator inserts a
          structured marker around explicit next-action suggestions
          ("查看竞品" / "排查异常品"). Rendered as a chip rail above
          the legacy "继续探索" block. Reuses onSuggestionPick which
          inherits replyToTaskId via MainPanel's follow-up auto-
          detect, so chip clicks land as proper follow-up turns. */}
      {followUpActions.length > 0 && onSuggestionPick && revealed === displayText && (
        <FollowUpChips actions={followUpActions} onPick={onSuggestionPick} />
      )}
      {/* Plain-text suggestion links. Kept as a compact next-step
          card instead of loose text rows, so long suggestions stay
          readable on mobile. Click fires onSuggestionPick which
          routes through the parent's onSubmit (followUpTarget
          detection inherits replyToTaskId for free parent context). */}
      {suggestions.length > 0 && onSuggestionPick && revealed === displayText && (
        <div className="mt-4 rounded-[8px] border border-[#DCDDDD] bg-white p-2.5 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85">
          <div className="mb-2 flex items-center justify-between gap-3 px-1 text-[11px] font-medium tracking-wide text-muted-foreground">
            下一步建议
            <span>{suggestions.length} 项</span>
          </div>
          {suggestions.map((s, i) => (
            <button
              key={`${i}-${s.slice(0, 10)}`}
              type="button"
              onClick={() => onSuggestionPick(s)}
              className="group flex w-full items-start gap-2 rounded-[6px] px-2.5 py-2 text-left text-xs text-[#595757] transition-colors hover:bg-[#EFEFEF]/55 hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 dark:text-foreground/75 dark:hover:bg-white/10 dark:hover:text-foreground"
            >
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#DCDDDD] bg-[#EFEFEF]/55 text-[10px] font-medium text-[#595757] transition-colors group-hover:border-[#EA1F59]/35 group-hover:bg-[#EA1F59]/5 group-hover:text-[#EA1F59] dark:border-white/10 dark:bg-white/5 dark:text-foreground/70">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 leading-5">{s}</span>
            </button>
          ))}
        </div>
      )}
      {hasRealUrl && (
        <div
          className={cn(
            'mt-4 border-t pt-3 text-xs',
            tone.divider,
          )}
        >
          <button
            type="button"
            onClick={() => setPendingLink(safeCurrentUrl)}
            className="group flex min-h-12 min-w-0 items-start gap-2 rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-left shadow-[0_1px_3px_rgba(17,24,39,0.05)] transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[#EFEFEF]/70 text-[#595757] transition-colors group-hover:bg-white dark:bg-white/10 dark:text-foreground/80">
              <ExternalLink className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground/85">
                打开最终浏览器
              </span>
              <span className="mt-0.5 block truncate leading-5 text-muted-foreground">
                {safeCurrentUrl}
              </span>
            </span>
          </button>
        </div>
      )}
      <ExternalLinkConfirm
        href={pendingLink}
        onClose={() => setPendingLink(null)}
        onConfirm={(href) => {
          setPendingLink(null);
          window.open(href, '_blank', 'noopener,noreferrer');
        }}
      />
      {/* Phase 5a — schedule-this-task dialog. `initialIntent` pre-
          fills with the just-finished task's intent. Toast/refresh
          handled inside the dialog; on success we just close it. */}
      <ScheduledTaskDialog
        open={scheduleDialogOpen}
        onClose={() => setScheduleDialogOpen(false)}
        onCreated={() => setScheduleDialogOpen(false)}
        initialIntent={intent}
      />
    </div>
  );
}

/**
 * O10 typewriter hook. Reveals `full` one chunk per frame at
 * roughly `speedCharsPerSec` chars/second. Markdown rendering
 * tolerates partial input (incomplete fences fall through to plain
 * text and resolve once the rest arrives), so we don't need to
 * pause at token boundaries.
 *
 * Reset on text change; once the full string is revealed, returns
 * the original. Idempotent across re-renders for the same `full`
 * value via the seenRef cache — no flicker on a re-mount of the
 * same content.
 */
/**
 * Lightweight markdown-to-plain-text reducer for the terminal card's
 * Copy button. Not a full parser — just covers the patterns the
 * agent's summaries actually emit (bold/italic markers, inline code,
 * code fences, list bullets, headings, links rendered as label-only).
 * Keeping it deliberately small so a stray edge case doesn't silently
 * mangle copied output; users who want structure preserved can hit
 * the second button to copy the raw markdown.
 */
function stripMarkdown(input: string): string {
  let out = input;
  // Strip code fences (keep inner text).
  out = out.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/g, '$1');
  // Strip inline `code` markers.
  out = out.replace(/`([^`]+)`/g, '$1');
  // [label](url) → label.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  // Bold + italic markers (** *, __ _).
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/_([^_]+)_/g, '$1');
  // Heading hashes.
  out = out.replace(/^#{1,6}\s+/gm, '');
  // List bullets.
  out = out.replace(/^\s*[-*+]\s+/gm, '');
  out = out.replace(/^\s*\d+\.\s+/gm, '');
  // Blockquote markers.
  out = out.replace(/^>\s?/gm, '');
  return out.trim();
}

function useTypewriterReveal(
  full: string,
  speedCharsPerSec: number,
  animate = true,
): string {
  const [revealed, setRevealed] = React.useState<string>(full);
  const seenRef = React.useRef<string>('');
  React.useEffect(() => {
    if (!full) {
      setRevealed('');
      return;
    }
    if (!animate) {
      // Caller asked to render in full (e.g. opening a historical
      // task). Skip the per-frame interval — just commit immediately.
      seenRef.current = full;
      setRevealed(full);
      return;
    }
    if (seenRef.current === full) {
      // Already typed (or remount with cached); show full immediately.
      setRevealed(full);
      return;
    }
    seenRef.current = full;
    setRevealed('');
    let i = 0;
    const step = Math.max(1, Math.round(speedCharsPerSec / 30)); // ~30 fps
    const interval = window.setInterval(() => {
      i = Math.min(i + step, full.length);
      setRevealed(full.slice(0, i));
      if (i >= full.length) window.clearInterval(interval);
    }, 1000 / 30);
    return () => window.clearInterval(interval);
  }, [full, speedCharsPerSec, animate]);
  return revealed;
}

/**
 * Small confirm wrapper for outbound clicks. Keeps the existing
 * ConfirmDialog component consistent with the delete-task modal
 * (same blurred backdrop + dark card). Href is shown truncated so
 * the user can spot a suspicious redirect before opening it.
 */
function ExternalLinkConfirm({
  href,
  onClose,
  onConfirm,
}: {
  href: string | null;
  onClose: () => void;
  onConfirm: (href: string) => void;
}): JSX.Element {
  const safeHref = safeExternalHttpHref(href);
  const open = safeHref !== null;
  return (
    <ConfirmDialog
      open={open}
      title="即将打开外部链接"
      description={safeHref ? externalLinkConfirmDescription(safeHref) : undefined}
      confirmLabel="打开"
      cancelLabel="取消"
      onClose={onClose}
      onConfirm={() => {
        if (safeHref) onConfirm(safeHref);
      }}
    />
  );
}

/**
 * Build a markdown component map with an optional external-link
 * confirm hook. Used inside TerminalSummary (and the "open in new
 * tab" button) so the agent's output links (a) always open in a
 * new tab (noopener/noreferrer) and (b) route through a Chinese
 * confirm dialog rather than leaving the workbench silently.
 *
 * Table + table cell + code block overrides here make comparison
 * summaries legible in both light and dark themes, and wrap wide
 * tables in an overflow-x scroller so a 6-column price-compare
 * doesn't blow out the chat width on narrow viewports.
 */
function makeMarkdownComponents(opts: {
  onExternalClick?: (href: string) => void;
}): Components {
  return {
    a: ({ href, children, ...rest }) => {
      const safeHref = safeExternalHttpHref(href);
      if (!safeHref) return <span {...rest}>{children}</span>;
      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            opts.onExternalClick
              ? (e) => {
                  e.preventDefault();
                  opts.onExternalClick?.(safeHref);
                }
              : undefined
          }
          className="inline-flex items-center gap-1 text-[#EA1F59] underline decoration-[#EA1F59]/35 underline-offset-2 hover:text-[#D91B51] dark:text-[#EA1F59] dark:hover:text-[#F15A85]"
          {...rest}
        >
          {children}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      );
    },
    table: ({ children, ...rest }) => (
      // Item 5 — mobile <640px renders the table as one card per
      // row with explicit "Header: value" lines. The desktop table
      // is hidden via Tailwind responsive classes so the same
      // children tree is traversed once for the cards but the table
      // remains the source of truth. Cells get `overflow-wrap:
      // anywhere` so long unbroken values (URLs, hashes) don't
      // push card width past the viewport.
      <ResponsiveMarkdownTable rest={rest}>{children}</ResponsiveMarkdownTable>
    ),
    thead: ({ children, ...rest }) => (
      <thead
        className="bg-[#EFEFEF]/70 text-[11px] font-medium uppercase text-muted-foreground dark:bg-white/[0.04]"
        {...rest}
      >
        {children}
      </thead>
    ),
    tbody: ({ children, ...rest }) => <tbody {...rest}>{children}</tbody>,
    tr: ({ children, ...rest }) => (
      <tr
        className="border-b border-[#DCDDDD]/70 transition-colors last:border-b-0 hover:bg-[#EFEFEF]/30 dark:border-white/10 dark:hover:bg-white/[0.03]"
        {...rest}
      >
        {children}
      </tr>
    ),
    th: ({ children, ...rest }) => (
      <th
        className="whitespace-nowrap border-r border-[#DCDDDD]/70 px-3 py-2 text-left last:border-r-0 dark:border-white/10"
        {...rest}
      >
        {children}
      </th>
    ),
    td: ({ children, ...rest }) => (
      <td
        className="border-r border-[#DCDDDD]/70 px-3 py-2 align-top text-foreground/85 last:border-r-0 dark:border-white/10"
        {...rest}
      >
        {children}
      </td>
    ),
    code: ({ children, className, ...rest }) => {
      // Phase 10 Tier 3 — fenced ```holaday-file blocks carry the
      // create_file tool result as JSON. Extract + render the
      // FileDownloadCard inline; fall back to a normal code element
      // when the JSON is malformed (catches model truncation).
      if (className === 'language-holaday-file') {
        const raw = Array.isArray(children)
          ? children.join('')
          : typeof children === 'string'
            ? children
            : '';
        const payload = parseHoladayFilePayload(raw);
        if (payload) return <FileDownloadCard payload={payload} />;
      }
      return (
        <code
          className={cn(
            // P2.7 — break-anywhere on inline code. Long unbroken
            // strings (URLs, hashes, error tokens) used to push the
            // parent prose wider than the screen on mobile.
            'rounded bg-muted/70 px-1 py-0.5 text-[12px] text-foreground [overflow-wrap:anywhere]',
            className,
          )}
          {...rest}
        >
          {children}
        </code>
      );
    },
    // ReactMarkdown wraps fenced code in <pre><code>; when our `code`
    // override returns a non-<code> node (the FileDownloadCard) we
    // need the surrounding <pre> to NOT add its default styling, or
    // the card ends up trapped in a grey rectangle. Detect the same
    // language tag on the inner code child and render the children
    // bare in that case.
    pre: ({ children, ...rest }) => {
      const child = Array.isArray(children) ? children[0] : children;
      const lang =
        child &&
        typeof child === 'object' &&
        'props' in (child as { props?: { className?: string } }) &&
        (child as { props?: { className?: string } }).props?.className;
      if (lang === 'language-holaday-file') {
        return <>{children}</>;
      }
      return <MarkdownCodeBlock languageClassName={lang} rest={rest}>{children}</MarkdownCodeBlock>;
    },
    // Phase 4 R1 — paragraph override. Two transforms based on the
    // FIRST text node:
    //   1. Leading warning marker → wrap the entire paragraph in a yellow warning
    //      callout. The source marker is consumed (no longer shown inline)
    //      since the box itself is the visual signal.
    //   2. Leading source marker → emit a SourceBadge pill before the
    //      remaining text. The source marker is consumed; the badge carries
    //      the same color cue plus a hover tooltip.
    //
    // Everything else falls through to the default ReactMarkdown
    // paragraph render.
    p: ({ children, ...rest }) => {
      const arr = Array.isArray(children) ? children : [children];
      const first = arr[0];
      if (typeof first !== 'string') {
        return <p {...rest}>{children}</p>;
      }
      // Warning block. Match the marker with or without the
      // text-style variation selector (U+FE0F) and any trailing
      // whitespace, but render an icon instead of the raw marker.
      const warningPrefixRe = /^[ \t]*\u26A0(?:\uFE0F)?[ \t]*/u;
      if (warningPrefixRe.test(first)) {
        const trimmed = first.replace(warningPrefixRe, '');
        return (
          <div className="my-2 flex gap-2 rounded-md border border-[#FFC910]/60 bg-[#FFC910]/10 px-3 py-2 text-[#595757] dark:border-[#FFC910]/40 dark:text-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="my-0 flex-1 text-[13px] leading-relaxed" {...rest}>
              {[trimmed, ...arr.slice(1)]}
            </p>
          </div>
        );
      }
      // SourceBadge prefix on the first text node.
      const badge = matchResultSourceBadgePrefix(first);
      if (badge) {
        return (
          <p {...rest}>
            <SourceBadge marker={badge.marker} />
            {[badge.rest, ...arr.slice(1)]}
          </p>
        );
      }
      return <p {...rest}>{children}</p>;
    },
  };
}

/**
 * Item 5 — markdown table that switches to per-row cards on screens
 * narrower than 640px. The desktop table stays in DOM (hidden via
 * `hidden sm:block`) so the children tree only renders once; the
 * card view is built by traversing `<thead>` / `<tbody>` children
 * to extract headers + rows.
 *
 * Long unbroken cell values get `overflow-wrap: anywhere` so URLs /
 * hashes / token strings break instead of overflowing the card.
 */
function ResponsiveMarkdownTable({
  children,
  rest,
}: {
  children: React.ReactNode;
  rest: Record<string, unknown>;
}): JSX.Element {
  const data = React.useMemo(() => extractTableData(children), [children]);
  return (
    <>
      <div className="relative my-3 -mx-1 hidden overflow-x-auto rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)] after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-6 after:bg-gradient-to-l after:from-white after:to-transparent dark:border-white/10 dark:bg-card/85 dark:after:from-card sm:block">
        <table
          className="w-auto min-w-full border-collapse text-left text-[13px]"
          {...rest}
        >
          {children}
        </table>
      </div>
      {data && data.rows.length > 0 && (
        <div className="my-3 space-y-2 sm:hidden">
          {data.rows.map((row, ri) => (
            <div
              key={ri}
              className="rounded-[8px] border border-[#DCDDDD] bg-white p-3 text-[13px] shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85"
            >
              <div className="mb-2 flex items-center gap-2 border-b border-[#EFEFEF] pb-2 text-[11px] font-medium text-muted-foreground dark:border-white/10">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#DCDDDD] bg-[#EFEFEF]/55 text-[10px] text-[#595757] dark:border-white/10 dark:bg-white/5 dark:text-foreground/70">
                  {ri + 1}
                </span>
                <span>表格记录</span>
              </div>
              {row.map((cell, ci) => (
                <div
                  key={ci}
                  className="flex flex-col gap-0.5 border-b border-[#EFEFEF] py-1.5 first:pt-0 last:border-b-0 last:pb-0 dark:border-white/10 [overflow-wrap:anywhere]"
                >
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {data.headers[ci] ?? `字段 ${ci + 1}`}
                  </span>
                  <span className="leading-relaxed text-foreground/90">{cell}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

interface TableData {
  headers: React.ReactNode[];
  rows: React.ReactNode[][];
}

function extractTableData(children: React.ReactNode): TableData | null {
  const headers: React.ReactNode[] = [];
  const rows: React.ReactNode[][] = [];
  React.Children.forEach(children, (section) => {
    if (!React.isValidElement(section)) return;
    const sectionType = markdownElementTagName(section);
    if (sectionType === 'thead') {
      const trProps = (section.props as { children?: React.ReactNode }).children;
      React.Children.forEach(trProps, (tr) => {
        if (!React.isValidElement(tr)) return;
        const ths = (tr.props as { children?: React.ReactNode }).children;
        React.Children.forEach(ths, (th) => {
          if (!React.isValidElement(th)) return;
          headers.push((th.props as { children?: React.ReactNode }).children);
        });
      });
    } else if (sectionType === 'tbody') {
      const trList = (section.props as { children?: React.ReactNode }).children;
      React.Children.forEach(trList, (tr) => {
        if (!React.isValidElement(tr)) return;
        const tds = (tr.props as { children?: React.ReactNode }).children;
        const row: React.ReactNode[] = [];
        React.Children.forEach(tds, (td) => {
          if (!React.isValidElement(td)) return;
          row.push((td.props as { children?: React.ReactNode }).children);
        });
        rows.push(row);
      });
    }
  });
  if (headers.length === 0 && rows.length === 0) return null;
  return { headers, rows };
}

function markdownElementTagName(element: React.ReactElement): string | null {
  if (typeof element.type === 'string') return element.type;
  const props = element.props as { node?: { tagName?: unknown } };
  return typeof props.node?.tagName === 'string' ? props.node.tagName : null;
}

// ───────────────────────── Failure header (user-friendly copy)

function FailureHeaderCard({
  status,
  errorText,
}: {
  status: UiTask['status'];
  errorText: string;
}): JSX.Element {
  const cancelled = status === 'cancelled';
  const friendly = cancelled
    ? {
        title: '已取消',
        subtitle: '任务已取消。下方保留了已生成的部分内容。',
        nextStep: '需要继续时可以重新执行这个任务。',
      }
    : classifyFriendlyFailure(errorText);
  const hasTechnical = !cancelled && errorText.trim().length > 0;
  const detailText = friendlyFailureDetail(errorText);
  const [showTechnical, setShowTechnical] = React.useState(false);
  return (
    <div
      className={cn(
        'mb-3 rounded-md border px-3 py-2 text-sm',
        cancelled
          ? 'border-[#DCDDDD] bg-[#EFEFEF]/45 text-muted-foreground dark:border-white/10 dark:bg-white/5'
          : 'border-[#EA1F59]/35 bg-[#EA1F59]/5 text-[#595757] dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10 dark:text-foreground',
      )}
      role="alert"
    >
      <div className="font-medium">{friendly.title}</div>
      <div className="mt-0.5 text-xs opacity-80">{friendly.subtitle}</div>
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-[6px] border border-[#DCDDDD]/75 bg-white/70 px-2 py-1 text-[11px] text-[#595757] dark:border-white/10 dark:bg-white/10 dark:text-foreground/80">
        <RotateCcw className="h-3 w-3 text-[#EA1F59]" aria-hidden />
        <span>{friendly.nextStep}</span>
      </div>
      {hasTechnical && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowTechnical((v) => !v)}
            aria-expanded={showTechnical}
            aria-label={showTechnical ? '收起失败详情' : '查看失败详情'}
            title={showTechnical ? '收起失败详情' : '查看失败详情'}
            className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[11px] font-medium text-[#595757] transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
          >
            {showTechnical ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
            <span>详情</span>
          </button>
          {showTechnical && (
            <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-white/70 px-2 py-1.5 text-[11px] font-mono leading-relaxed text-[#595757] dark:bg-white/10 dark:text-foreground">
              {detailText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

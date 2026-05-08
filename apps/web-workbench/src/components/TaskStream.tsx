import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  Loader2,
  MessageCircleQuestion,
  MousePointerClick,
  Puzzle,
  Search,
} from 'lucide-react';
import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/toast';
import { FileDownloadCard, parseHoladayFilePayload } from '@/components/FileDownloadCard';
import { PlanCard } from '@/components/PlanCard';
import { SearchResultCard } from '@/components/SearchResultCard';
import { StepCard } from '@/components/StepCard';
import { hdDebug } from '@/lib/hd-debug';
import { useTaskStore } from '@/stores/task-store';
import { cn } from '@/lib/utils';
import type {
  UiAwaitingUser,
  UiCaptchaWait,
  UiDegradeEvent,
  UiExecutorFallback,
  UiStep,
  UiTask,
  UiWebSearchEvent,
} from '@/types/task';
import { friendlyHost, humanizeStep, humanizedGlyph, liveStatusLabel } from '@/utils/step-humanize';

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
export function TaskStream({ task, onPickSuggestion }: Props): JSX.Element {
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
  const setBrowserInteractive = useTaskStore((s) => s.setBrowserInteractive);
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll only follows the live tail when:
  //   - the task hasn't reached a terminal state (still streaming
  //     deltas the user wants to see), AND
  //   - the user is already pinned near the bottom (< 200 px from
  //     scrollHeight). Switching to a historical task or scrolling
  //     up to read past content shouldn't yank the view back down.
  const isTerminal =
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'cancelled';
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

  const terminal =
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  const humanLines = React.useMemo(() => buildHumanLines(steps), [steps]);
  // Prefer the live thinking event from the supercar loop; fall back to
  // the (currently null) legacy picker so the hook stays in place if we
  // ever add thinking to the vision-loop path too.
  const thinking = thinkingEvent?.summary ?? pickThinking(steps);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-4 pt-8">
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
        onContinueInBrowser={() => {
          // Two things on "continue in browser":
          //   1. Force interactive mode on so the VNC canvas accepts
          //      clicks / keyboard without a second toggle press.
          //   2. Flash a focus ring on the VNC container so the
          //      user's eye lands on the right area.
          //
          // We used to also call scrollIntoView on the Panel, but on
          // some desktop layouts that scrolled the whole app shell
          // horizontally and visibly shifted the sidebar — a regression
          // BOSS flagged in Round 2 review. The Panel is already on
          // screen at desktop widths; no scroll needed.
          setBrowserInteractive(true);
          setTimeout(() => {
            if (typeof document === 'undefined') return;
            const panel = document.querySelector<HTMLElement>(
              '.vnc-viewport-host',
            );
            if (panel) {
              panel.setAttribute('data-flash', '1');
              window.setTimeout(() => panel.removeAttribute('data-flash'), 1500);
            }
          }, 50);
        }}
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
  onContinueInBrowser,
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
  onContinueInBrowser(): void;
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

  const hasAnyActivity =
    humanLines.length > 0 ||
    Boolean(captchaWait) ||
    Boolean(degrade) ||
    Boolean(executorFallback) ||
    Boolean(awaitingUser) ||
    Boolean(webSearch) ||
    Boolean(task.resultText);

  const showInlineProgress = !terminal;

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-pink-700 text-[11px] font-semibold text-white">
        H
      </div>
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
            // Cancelled is terminal too — fold same as completed/failed.
            defaultExpanded={
              task.status !== 'completed' &&
              task.status !== 'failed' &&
              task.status !== 'cancelled'
            }
          />
        )}

        {thinking && <ThinkingBlock text={thinking} />}

        {!hasAnyActivity && !terminal && <BoardingLine />}

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

        {awaitingUser && <AwaitingUserBanner wait={awaitingUser} />}

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
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-5 py-4 text-foreground dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-foreground">
              {progressMessage && !streamingText && (
                <div className="text-xs text-muted-foreground">
                  <span className="inline-block animate-pulse">●</span>{' '}
                  {progressMessage}
                </div>
              )}
              {streamingText && (
                <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert dark:prose-headings:text-foreground dark:prose-p:text-foreground/95 dark:prose-li:text-foreground/95 dark:prose-strong:text-foreground dark:prose-code:text-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {sanitizeMarkdownTrailingPunctuation(streamingText)}
                  </ReactMarkdown>
                  <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/40 align-baseline" />
                </div>
              )}
            </div>
          )}

        {terminal && task.resultText && (
          <TerminalSummary
            status={task.status}
            text={task.resultText}
            // task.finalUrl is the persisted final-page URL (R7), so
            // refreshes / history clicks still surface "打开最终页面"
            // even after the live screencast has gone. Live tasks
            // fall back to the screencast url so an in-flight URL
            // chip still tracks navigation.
            currentUrl={task.finalUrl ?? screencastUrl}
            taskId={task.taskId}
            modelLabel={task.modelLabel}
            onContinueInBrowser={
              // F2 — only show "在内置浏览器中继续操作" for tasks
              // that actually have a browser session: not completed
              // (Brave already released) AND executionMode === 'browser'
              // (generate / scrape never had a Brave to continue in).
              // Older rows without executionMode set fall through to
              // hidden — safer than offering a button that 404s.
              task.status === 'completed' || task.executionMode !== 'browser'
                ? undefined
                : onContinueInBrowser
            }
            onSuggestionPick={onSuggestionPick}
            serverSuggestions={serverSuggestions}
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
        {terminal && !task.resultText && (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground/70">
              {task.status === 'failed' || task.status === 'cancelled'
                ? '任务结束'
                : '没有回复内容'}
            </div>
            <div>
              这个任务已经结束，但没有收到回复内容。重新发送一次相同意图通常就行。
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <DetailToggle
            open={detailOpen}
            count={steps.length}
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
function AwaitingUserBanner({ wait }: { wait: UiAwaitingUser }): JSX.Element {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-amber-900/50 dark:bg-amber-950/30">
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            HOLA DAY 想跟你确认
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-amber-950 dark:text-amber-100">
            {wait.question}
          </p>
          <p className="mt-2 text-[11px] text-amber-700/80 dark:text-amber-500/80">
            在下方输入框回答，任务会继续。
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact "agent is on SITE" chip shown in the stream while a task is
 * executing. Gives visibility of the agent's current location even
 * when the BrowserPanel is collapsed or off-screen on mobile. Hidden
 * once the task reaches a terminal status — the TerminalSummary's
 * "在新标签页打开 <url>" affordance takes over from there.
 */
function CurrentUrlChip({ url }: { url: string }): JSX.Element | null {
  if (!url || url === 'about:blank' || url.startsWith('chrome://')) return null;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const label = friendlyHost(host);
  return (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
      <Globe className="h-3 w-3 shrink-0 text-blue-500" />
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
        <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
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
  // Color policy (Round-2b fix):
  //   - Task still running (not terminal) → always blue spinner,
  //     even if the most recent tick has status='failed'. The agent
  //     retries opaquely; the user shouldn't see red mid-flight.
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
        red ? 'text-red-600' : 'text-muted-foreground',
      )}
    >
      {red ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      )}
      <span>{label}</span>
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
              line.status === 'failed' ? 'text-red-600' : 'text-foreground',
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
  if (status === 'running') {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (status === 'failed') {
    return (
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
    );
  }
  return (
    <Check
      aria-hidden
      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500"
      strokeWidth={3}
      aria-label={glyph}
    />
  );
}

function DetailToggle({
  open,
  count,
  onToggle,
  children,
}: {
  open: boolean;
  count: number;
  onToggle(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {open ? '收起详细步骤' : `查看详细步骤（${count} 步）`}
      </button>
      {open && children}
    </div>
  );
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
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
        {intent}
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-pink-600 text-xs font-semibold text-white">
        Y
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
      className="flex animate-fade-in items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 animate-pulse-dot text-amber-600" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-amber-900">目标网站需要人工验证</div>
        <div className="mt-1 text-xs text-amber-900/80">{wait.message}</div>
        <div className="mt-1 text-xs text-amber-900/80">
          请在右侧 Chrome 窗口中完成验证，HOLA DAY 将自动继续。
        </div>
        <div className="mt-2 text-[11px] font-medium text-amber-900/70">
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
        className="flex animate-fade-in items-start gap-3 rounded-xl border border-red-300 bg-red-50/70 px-4 py-3 dark:border-red-500/40 dark:bg-red-500/10"
      >
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold text-red-900">反爬保护触发，但扩展未连接</div>
          <div className="mt-1 text-xs text-red-900/80">
            HOLA DAY 想切到 Chrome 扩展继续任务，但没有检测到在线的扩展客户端。请安装并打开
            HOLA DAY 扩展后重试。
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex animate-fade-in items-start gap-3 rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 dark:border-sky-500/40 dark:bg-sky-500/10">
      <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-sky-900">已切换到浏览器扩展模式执行</div>
        <div className="mt-1 text-xs text-sky-900/80">
          连续检测到反爬拦截，HOLA DAY 切到 Chrome 扩展继续任务，后续步骤通过扩展内的 CDP 驱动
          执行。
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
    <div className="flex animate-fade-in items-start gap-3 rounded-xl border border-pink-300 bg-pink-50/70 px-4 py-3 dark:border-pink-500/40 dark:bg-pink-500/10">
      <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-pink-600" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-pink-900 dark:text-pink-100">
          {message}
        </div>
        {!event.ok && (
          <div className="mt-1 text-xs text-pink-900/80 dark:text-pink-100/80">
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
 * Also exported for unit testing.
 */
export function sanitizeMarkdownTrailingPunctuation(text: string): string {
  if (!text) return text;
  return text.replace(
    /(https?:\/\/[^\s)\]\[　-〿＀-￯]+)([　-〿＀-￯])/g,
    '$1 $2',
  );
}

function TerminalSummary({
  status,
  text,
  currentUrl,
  taskId,
  onContinueInBrowser,
  modelLabel,
  onSuggestionPick,
  serverSuggestions,
  animateReveal = true,
}: {
  status: UiTask['status'];
  text: string;
  currentUrl?: string | null;
  /** Task id — used by the share button to build a deep link. */
  taskId?: string;
  onContinueInBrowser?: () => void;
  modelLabel?: 'sonnet' | 'opus';
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
   * When false (e.g. user clicked into a historical task), skip the
   * typewriter reveal — render the full summary immediately. Default
   * `true` preserves the live-completion experience.
   */
  animateReveal?: boolean;
}): JSX.Element {
  const toast = useToast();
  // Legacy: pull a fenced ```suggestions JSON block out of the
  // model's text. Kept as a fallback for tasks that completed before
  // the backend generator landed (or when the generator failed).
  // The visible text always has the block stripped so users don't
  // see raw JSON regardless of which suggestion source wins.
  const { displayText, suggestions: parsedSuggestions } = React.useMemo(() => {
    const re = /```suggestions\s*\n([\s\S]*?)\n```/i;
    const m = re.exec(text);
    if (!m || !m[1]) return { displayText: text, suggestions: [] as string[] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      return { displayText: text.replace(re, '').trim(), suggestions: [] as string[] };
    }
    const list =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { suggestions?: unknown }).suggestions)
        ? ((parsed as { suggestions: unknown[] }).suggestions
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim())
            .slice(0, 3))
        : [];
    return { displayText: text.replace(re, '').trim(), suggestions: list };
  }, [text]);
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
  const tone = isFailedLike
    ? status === 'failed'
      ? {
          wrap: 'rounded-xl border border-red-200 bg-red-50/70 px-5 py-4 text-foreground dark:border-red-500/30 dark:bg-red-500/10',
          label: '任务失败',
          labelClass: 'text-red-700 dark:text-red-300',
          divider: 'border-red-200/70 dark:border-red-500/30',
        }
      : {
          wrap: 'rounded-xl border border-border bg-card/60 px-5 py-4 text-foreground',
          label: '已取消',
          labelClass: 'text-muted-foreground',
          divider: 'border-border/60',
        }
    : {
        wrap: 'rounded-xl border border-blue-200 bg-blue-50/60 px-5 py-4 text-foreground dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-foreground',
        label: null,
        labelClass: '',
        divider: 'border-blue-200/70 dark:border-blue-500/30',
      };
  const hasRealUrl =
    !!currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith('chrome://');
  // Strip markdown syntax for the plain-text Copy. Keeps `[label](url)` →
  // `label`, drops `**bold**` markers, code fences, list bullets — the
  // user gets what they'd visually read. The markdown copy keeps the raw
  // source so paste into Notion / Slack / a doc editor preserves
  // structure.
  const plainText = React.useMemo(() => stripMarkdown(displayText), [displayText]);
  const copyTo = React.useCallback(
    async (value: string, label: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(value);
        toast.show(`已复制${label}`);
      } catch {
        toast.show('复制失败', 'error');
      }
    },
    [toast],
  );
  return (
    <div className={tone.wrap}>
      {tone.label && (
        <div className={cn('mb-2 text-xs font-semibold uppercase tracking-wider', tone.labelClass)}>
          {tone.label}
        </div>
      )}
      <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert dark:prose-headings:text-foreground dark:prose-p:text-foreground/95 dark:prose-li:text-foreground/95 dark:prose-strong:text-foreground dark:prose-code:text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
          {sanitizeMarkdownTrailingPunctuation(revealed)}
        </ReactMarkdown>
      </div>
      {/* O3 — model info line. Tiny, non-intrusive. */}
      {modelLabel && (
        <div className="mt-3 text-[11px] text-muted-foreground dark:text-foreground/60">
          {modelLabel === 'opus' ? 'Claude Opus 4.7 · 深度思考' : 'Claude Sonnet 4.6'}
        </div>
      )}
      {/* Inline copy / share footer. Replaced the prior absolute-
          positioned overlay (top-right, opacity-0 group-hover) which
          obscured the first lines of the result on overflow and
          never appeared on touch. Always visible, sits below the
          body so it doesn't compete with the content. */}
      <div className={cn('mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-xs text-muted-foreground', tone.divider)}>
        <button
          type="button"
          onClick={() => void copyTo(plainText, '纯文本')}
          aria-label="复制纯文本"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <Copy className="h-3 w-3" />
          复制
        </button>
        <button
          type="button"
          onClick={() => void copyTo(displayText, 'Markdown')}
          aria-label="复制 Markdown 原文"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <FileText className="h-3 w-3" />
          复制 Markdown
        </button>
        {taskId && (
          <button
            type="button"
            onClick={() => {
              const origin =
                typeof window !== 'undefined' ? window.location.origin : '';
              void copyTo(`${origin}/?task=${encodeURIComponent(taskId)}`, '任务链接');
            }}
            aria-label="复制任务链接"
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <Link2 className="h-3 w-3" />
            分享任务
          </button>
        )}
      </div>
      {/* Plain-text suggestion links. Cleaner than the prior blue
          card style — each row is just a borderless ghost button
          with a leading → arrow that translates on hover. Click
          fires onSuggestionPick which routes through the parent's
          onSubmit (followUpTarget detection inherits
          replyToTaskId for free parent context). */}
      {suggestions.length > 0 && onSuggestionPick && revealed === displayText && (
        <div className="mt-4 flex flex-col gap-0.5 border-t border-border/40 pt-3">
          <div className="mb-1 text-[11px] font-medium tracking-wider text-muted-foreground">
            继续探索
          </div>
          {suggestions.map((s, i) => (
            <button
              key={`${i}-${s.slice(0, 10)}`}
              type="button"
              onClick={() => onSuggestionPick(s)}
              className="group flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <span
                aria-hidden
                className="shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
              >
                →
              </span>
              <span className="min-w-0 flex-1 truncate group-hover:underline">{s}</span>
            </button>
          ))}
        </div>
      )}
      {(hasRealUrl || onContinueInBrowser) && (
        <div className={cn('mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs', tone.divider)}>
          {onContinueInBrowser && (
            <button
              type="button"
              onClick={onContinueInBrowser}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-card px-3 py-1.5 font-medium text-blue-800 shadow-sm transition hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              在内置浏览器中继续操作
            </button>
          )}
          {hasRealUrl && (
            <button
              type="button"
              onClick={() => setPendingLink(currentUrl ?? null)}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-card px-3 py-1.5 font-medium text-blue-800 shadow-sm transition hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在新标签页打开
              <span className="max-w-[180px] truncate text-blue-700/70">{currentUrl}</span>
            </button>
          )}
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
  const open = href !== null;
  return (
    <ConfirmDialog
      open={open}
      title="即将打开外部链接"
      description={
        open
          ? `部分外部页面可能需要登录或无法正常访问。确认打开？\n\n${href}`
          : undefined
      }
      confirmLabel="打开"
      cancelLabel="取消"
      onClose={onClose}
      onConfirm={() => {
        if (href) onConfirm(href);
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
    a: ({ href, children, ...rest }) => (
      <a
        href={href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        onClick={
          opts.onExternalClick && href
            ? (e) => {
                e.preventDefault();
                opts.onExternalClick?.(href);
              }
            : undefined
        }
        className="inline-flex items-center gap-1 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        {...rest}
      >
        {children}
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    ),
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
      <thead className="bg-muted/60 text-[12px] font-medium text-foreground" {...rest}>
        {children}
      </thead>
    ),
    tbody: ({ children, ...rest }) => <tbody {...rest}>{children}</tbody>,
    tr: ({ children, ...rest }) => (
      <tr className="border-b border-border last:border-b-0" {...rest}>
        {children}
      </tr>
    ),
    th: ({ children, ...rest }) => (
      <th
        className="whitespace-nowrap border-r border-border px-3 py-2 text-left last:border-r-0"
        {...rest}
      >
        {children}
      </th>
    ),
    td: ({ children, ...rest }) => (
      <td
        className="border-r border-border px-3 py-2 align-top last:border-r-0"
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
      return (
        <pre className="my-2 overflow-x-auto rounded-md bg-muted/60 p-3 text-[12px]" {...rest}>
          {children}
        </pre>
      );
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
      <div className="relative my-3 -mx-1 hidden overflow-x-auto rounded-md after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-6 after:rounded-r-md after:bg-gradient-to-l after:from-background after:to-transparent sm:block">
        <table
          className="w-auto border-collapse rounded-md border border-border text-left text-[13px]"
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
              className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-[13px]"
            >
              {row.map((cell, ci) => (
                <div
                  key={ci}
                  className="flex flex-col gap-0.5 border-b border-border/50 pb-1 last:border-b-0 last:pb-0 [overflow-wrap:anywhere]"
                >
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {data.headers[ci] ?? ''}
                  </span>
                  <span className="text-foreground">{cell}</span>
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
    const sectionType = section.type;
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

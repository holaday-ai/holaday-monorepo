import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  MessageCircleQuestion,
  MousePointerClick,
  Puzzle,
  Search,
} from 'lucide-react';
import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StepCard } from '@/components/StepCard';
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
}

// Stable empty-array reference so the zustand selector below returns
// the SAME value on every render when the task has no steps yet. A
// fresh `[]` via `?? []` triggers React's getSnapshot cache warning
// and can loop infinitely under StrictMode.
const EMPTY_STEPS: UiStep[] = [];
const EMPTY_REPLIES: Array<{ at: number; text: string }> = [];

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
export function TaskStream({ task }: Props): JSX.Element {
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
  const setBrowserInteractive = useTaskStore((s) => s.setBrowserInteractive);
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' });
  }, [
    steps.length,
    userReplies.length,
    task.status,
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
        onContinueInBrowser={() => {
          // Three things on "continue in browser":
          //   1. Force interactive mode on so the VNC canvas accepts
          //      clicks / keyboard without a second toggle press.
          //   2. Scroll the BrowserPanel into view on the viewport.
          //      On narrow desktops the Panel is offscreen or hidden
          //      behind the MainPanel overflow; the button sits in
          //      the chat stream and users shouldn't have to hunt.
          //   3. Flash a focus outline on the VNC container so the
          //      user's eye lands on the right area.
          setBrowserInteractive(true);
          // Wait for the "interactive" CSS transition to settle so
          // scrollIntoView lands on the final size of the Panel.
          setTimeout(() => {
            if (typeof document === 'undefined') return;
            const panel = document.querySelector<HTMLElement>(
              '.vnc-viewport-host',
            );
            if (panel) {
              panel.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
              // Flash ring via a transient data attribute the CSS
              // can animate — zero dep, no re-render.
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
  captchaWait,
  degrade,
  executorFallback,
  awaitingUser,
  webSearch,
}: {
  task: UiTask;
  steps: UiStep[];
  humanLines: HumanLine[];
  thinking: string | null;
  terminal: boolean;
  screencastUrl: string | null;
  onContinueInBrowser(): void;
  captchaWait: UiCaptchaWait | undefined;
  degrade: UiDegradeEvent | undefined;
  executorFallback: UiExecutorFallback | undefined;
  awaitingUser: UiAwaitingUser | undefined;
  webSearch: UiWebSearchEvent | undefined;
}): JSX.Element {
  const [detailOpen, setDetailOpen] = React.useState(false);

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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-pink-500 text-[11px] font-semibold text-white">
        H
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {thinking && <ThinkingBlock text={thinking} />}

        {!hasAnyActivity && !terminal && <BoardingLine />}

        {showInlineProgress && humanLines.length > 0 && (
          <HumanLineList lines={humanLines} />
        )}

        {/* Live progress pill — one line, spinner + current tool
         *  label. Shows while task is non-terminal and we have at
         *  least one step. Replaces the old stack of "完成一步操作"
         *  rows. */}
        {showInlineProgress && steps.length > 0 && (
          <LiveStatus kind={latestRunningKind} status={latestRunningStatus} />
        )}

        {showInlineProgress && screencastUrl && <CurrentUrlChip url={screencastUrl} />}

        {webSearch && !awaitingUser && <WebSearchLine event={webSearch} />}

        {captchaWait && <CaptchaWaitBanner wait={captchaWait} />}
        {degrade && !executorFallback && <DegradeBanner event={degrade} />}
        {executorFallback && <ExecutorFallbackBanner fallback={executorFallback} />}

        {awaitingUser && <AwaitingUserBanner wait={awaitingUser} />}

        {terminal && task.resultText && (
          <TerminalSummary
            status={task.status}
            text={task.resultText}
            currentUrl={screencastUrl}
            onContinueInBrowser={onContinueInBrowser}
          />
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
 * Inline "正在搜索 …" line for web_search events. Small on purpose —
 * search iterations are usually quick and we don't want them to push
 * the primary step stream around.
 */
function WebSearchLine({ event }: { event: UiWebSearchEvent }): JSX.Element {
  return (
    <div className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
      <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1">
        正在联网搜索 <span className="text-foreground">"{event.query}"</span>
      </span>
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
  status,
}: {
  kind: string | undefined;
  status: UiStep['status'];
}): JSX.Element {
  const label = liveStatusLabel(kind);
  const isFailed = status === 'failed';
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[13px] leading-5',
        isFailed ? 'text-red-600' : 'text-muted-foreground',
      )}
    >
      {isFailed ? (
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-pink-400 text-xs font-semibold text-white">
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

function DegradeBanner({ event }: { event: UiDegradeEvent }): JSX.Element {
  const label = STRATEGY_LABELS[event.strategy] ?? event.strategy;
  return (
    <div className="flex animate-fade-in items-start gap-3 rounded-xl border border-violet-300 bg-violet-50/70 px-4 py-3 dark:border-violet-500/40 dark:bg-violet-500/10">
      <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-violet-900">
          正在尝试替代方案（level {event.level}）
        </div>
        <div className="mt-1 text-xs text-violet-900/80">
          策略：<span className="font-medium">{label}</span>
          {event.ok ? '' : '（未生效，继续升级）'}
        </div>
        {event.nextUrl ? (
          <div className="mt-1 text-xs text-violet-900/80">下一步导航：{event.nextUrl}</div>
        ) : null}
      </div>
    </div>
  );
}

const STRATEGY_LABELS: Readonly<Record<string, string>> = {
  profile_rotation: '清 cookie + 换 UA',
  proxy_swap: '切换代理（需配置）',
  search_engine_swap: '换搜索引擎',
  search_api_fallback: '走搜索 API',
  extension_fallback: '切到浏览器扩展',
};

function TerminalSummary({
  status,
  text,
  currentUrl,
  onContinueInBrowser,
}: {
  status: UiTask['status'];
  text: string;
  currentUrl?: string | null;
  onContinueInBrowser?: () => void;
}): JSX.Element {
  if (status === 'failed' || status === 'cancelled') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider">
          {status === 'failed' ? '任务失败' : '已取消'}
        </div>
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    );
  }
  const hasRealUrl =
    !!currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith('chrome://');
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-5 py-4 dark:border-blue-500/30 dark:bg-blue-500/10">
      <div className="prose prose-sm prose-neutral max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
      {(hasRealUrl || onContinueInBrowser) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-blue-200/70 pt-3 text-xs">
          {onContinueInBrowser && (
            <button
              type="button"
              onClick={onContinueInBrowser}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-card px-3 py-1.5 font-medium text-blue-800 shadow-sm transition hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              在浏览器中继续操作
            </button>
          )}
          {hasRealUrl && (
            <a
              href={currentUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-card px-3 py-1.5 font-medium text-blue-800 shadow-sm transition hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在新标签页打开
              <span className="max-w-[180px] truncate text-blue-700/70">{currentUrl}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// All markdown links open in a new tab (noopener/noreferrer). Primary
// use case is summary text containing URLs the agent produced —
// letting them hijack the current tab drops the user out of the
// workbench.
const MARKDOWN_COMPONENTS: Components = {
  // biome-ignore lint/a11y/useAnchorContent: react-markdown passes children
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      {...rest}
    >
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  ),
};

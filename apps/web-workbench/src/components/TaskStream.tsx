import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  MousePointerClick,
  Puzzle,
} from 'lucide-react';
import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StepCard } from '@/components/StepCard';
import { useTaskStore } from '@/stores/task-store';
import { cn } from '@/lib/utils';
import type {
  UiCaptchaWait,
  UiDegradeEvent,
  UiExecutorFallback,
  UiStep,
  UiTask,
} from '@/types/task';
import { humanizeStep, humanizedGlyph } from '@/utils/step-humanize';

interface Props {
  task: UiTask;
}

// Stable empty-array reference so the zustand selector below returns
// the SAME value on every render when the task has no steps yet. A
// fresh `[]` via `?? []` triggers React's getSnapshot cache warning
// and can loop infinitely under StrictMode.
const EMPTY_STEPS: UiStep[] = [];

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
  const captchaWait = useTaskStore((s) => s.captchaWaitByTask[task.taskId]);
  const executorFallback = useTaskStore((s) => s.executorFallbackByTask[task.taskId]);
  const degrade = useTaskStore((s) => s.degradeByTask[task.taskId]);
  const screencast = useTaskStore((s) => s.screencastByTask[task.taskId]);
  const setBrowserInteractive = useTaskStore((s) => s.setBrowserInteractive);
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' });
  }, [steps.length, task.status, captchaWait, executorFallback, degrade]);

  const terminal =
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  const humanLines = React.useMemo(() => buildHumanLines(steps), [steps]);
  const thinking = pickThinking(steps);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-4 pt-8">
      <UserBubble intent={task.intent} />

      <AgentBlock
        task={task}
        steps={steps}
        humanLines={humanLines}
        thinking={thinking}
        terminal={terminal}
        screencastUrl={screencast?.url ?? null}
        onContinueInBrowser={() => setBrowserInteractive(true)}
        captchaWait={captchaWait}
        degrade={degrade}
        executorFallback={executorFallback}
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
}): JSX.Element {
  const [detailOpen, setDetailOpen] = React.useState(false);
  const hasAnyActivity =
    humanLines.length > 0 ||
    Boolean(captchaWait) ||
    Boolean(degrade) ||
    Boolean(executorFallback) ||
    Boolean(task.resultText);

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-pink-500 text-[11px] font-semibold text-white">
        H
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {thinking && <ThinkingBlock text={thinking} />}

        {!hasAnyActivity && !terminal && <BoardingLine />}

        {humanLines.length > 0 && <HumanLineList lines={humanLines} />}

        {captchaWait && <CaptchaWaitBanner wait={captchaWait} />}
        {degrade && !executorFallback && <DegradeBanner event={degrade} />}
        {executorFallback && <ExecutorFallbackBanner fallback={executorFallback} />}

        {terminal && task.resultText && (
          <TerminalSummary
            status={task.status}
            text={task.resultText}
            currentUrl={screencastUrl}
            onContinueInBrowser={onContinueInBrowser}
          />
        )}

        {steps.length > 0 && (
          <DetailToggle open={detailOpen} count={steps.length} onToggle={() => setDetailOpen((v) => !v)}>
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
      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500"
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
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <div className="prose prose-sm prose-neutral max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
      {(hasRealUrl || onContinueInBrowser) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-emerald-200/70 pt-3 text-xs">
          {onContinueInBrowser && (
            <button
              type="button"
              onClick={onContinueInBrowser}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-card px-3 py-1.5 font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
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
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-card px-3 py-1.5 font-medium text-emerald-800 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在新标签页打开
              <span className="max-w-[180px] truncate text-emerald-700/70">{currentUrl}</span>
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
      className="inline-flex items-center gap-1 text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
      {...rest}
    >
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  ),
};

import { AlertCircle, Puzzle } from 'lucide-react';
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StepCard } from '@/components/StepCard';
import { useTaskStore } from '@/stores/task-store';
import type { UiCaptchaWait, UiExecutorFallback, UiStep, UiTask } from '@/types/task';

interface Props {
  task: UiTask;
}

// Stable empty-array reference so the zustand selector below returns
// the SAME value on every render when the task has no steps yet. A
// fresh `[]` via `?? []` triggers React's getSnapshot cache warning
// and can loop infinitely under StrictMode.
const EMPTY_STEPS: UiStep[] = [];

/**
 * Stream panel for one task. Top: the user's intent (as a chat-style
 * bubble). Middle: one StepCard per tick as they arrive over WS.
 * Bottom: a terminal summary rendered through react-markdown once
 * the task reaches a terminal state (completed / failed / cancelled).
 *
 * Auto-scroll: we bind a ref to the container and push to the bottom
 * whenever the step count changes or the task status flips terminal.
 * `behavior: smooth` looks nicer but janks on fast streams, so we use
 * instant scrolling.
 */
export function TaskStream({ task }: Props): JSX.Element {
  const steps = useTaskStore((s) => s.stepsByTask[task.taskId]) ?? EMPTY_STEPS;
  const captchaWait = useTaskStore((s) => s.captchaWaitByTask[task.taskId]);
  const executorFallback = useTaskStore((s) => s.executorFallbackByTask[task.taskId]);
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' });
  }, [steps.length, task.status, captchaWait, executorFallback]);

  const terminal =
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-4 pt-8">
      <UserBubble intent={task.intent} />

      {steps.length === 0 && !terminal && !captchaWait && (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          等待第一个操作…
        </div>
      )}

      <div className="space-y-2">
        {steps.map((step) => (
          <StepCard key={step.tickIndex} step={step} />
        ))}
      </div>

      {captchaWait && <CaptchaWaitBanner wait={captchaWait} />}

      {executorFallback && <ExecutorFallbackBanner fallback={executorFallback} />}

      {terminal && task.resultText && (
        <TerminalSummary status={task.status} text={task.resultText} />
      )}

      <div ref={scrollAnchorRef} />
    </div>
  );
}

/**
 * Layer 4 prompt: shows when the orchestrator has paused the loop on
 * a high-confidence anti-bot signal. Tells the user exactly where to
 * act (attached Chrome window) and how long the orchestrator will
 * wait. Auto-unmounts when the task-store clears `captchaWaitByTask`
 * for this task (either auto-resolved or timed out).
 */
function CaptchaWaitBanner({ wait }: { wait: UiCaptchaWait }): JSX.Element {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, wait.deadlineMs - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  return (
    <div
      role="alert"
      className="flex animate-fade-in items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 animate-pulse-dot text-amber-600" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-amber-900">目标网站需要人工验证</div>
        <div className="mt-1 text-xs text-amber-900/80">
          {wait.message}
        </div>
        <div className="mt-1 text-xs text-amber-900/80">
          请在右侧显示的 Chrome 浏览器窗口中完成验证，agent 将自动继续。
        </div>
        <div className="mt-2 text-[11px] font-medium text-amber-900/70">
          自动恢复窗口剩余：{remainingSec}s
        </div>
      </div>
    </div>
  );
}

/**
 * Layer 5 status: reported once on transport swap and kept on screen
 * for the rest of the task as a breadcrumb. Two variants:
 *
 *  - available=true  → swap succeeded. Neutral info styling.
 *  - available=false → no extension connected. Error styling + a
 *                      call-to-action ("请打开 HOLA DAY 扩展").
 */
function ExecutorFallbackBanner({
  fallback,
}: {
  fallback: UiExecutorFallback;
}): JSX.Element {
  if (!fallback.available) {
    return (
      <div
        role="alert"
        className="flex animate-fade-in items-start gap-3 rounded-xl border border-red-300 bg-red-50/70 px-4 py-3"
      >
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold text-red-900">反爬保护触发，但扩展未连接</div>
          <div className="mt-1 text-xs text-red-900/80">
            orchestrator 想切换到 Chrome 扩展执行，但没有检测到在线的扩展客户端。请安装并打开
            HOLA DAY 扩展后重试此任务。
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex animate-fade-in items-start gap-3 rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3">
      <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-sky-900">已切换到浏览器扩展模式执行</div>
        <div className="mt-1 text-xs text-sky-900/80">
          连续检测到反爬拦截，agent 切到 Chrome 扩展继续任务，后续步骤通过扩展内的 CDP 驱动
          执行（可能会失去 accessibility 模式的优势）。
        </div>
      </div>
    </div>
  );
}

function UserBubble({ intent }: { intent: string }): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-pink-400 text-xs font-semibold text-white">
        Y
      </div>
      <div className="flex-1 rounded-2xl bg-muted/50 px-4 py-3 text-sm leading-relaxed text-foreground">
        {intent}
      </div>
    </div>
  );
}

function TerminalSummary({
  status,
  text,
}: {
  status: UiTask['status'];
  text: string;
}): JSX.Element {
  if (status === 'failed' || status === 'cancelled') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider">
          {status === 'failed' ? '失败' : '已取消'}
        </div>
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
        已完成
      </div>
      <div className="prose prose-sm prose-neutral max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  );
}

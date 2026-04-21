import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StepCard } from '@/components/StepCard';
import { useTaskStore } from '@/stores/task-store';
import type { UiTask } from '@/types/task';

interface Props {
  task: UiTask;
}

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
  const steps = useTaskStore((s) => s.stepsByTask[task.taskId] ?? []);
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' });
  }, [steps.length, task.status]);

  const terminal =
    task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 pb-4 pt-8">
      <UserBubble intent={task.intent} />

      {steps.length === 0 && !terminal && (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          等待第一个操作…
        </div>
      )}

      <div className="space-y-2">
        {steps.map((step) => (
          <StepCard key={step.tickIndex} step={step} />
        ))}
      </div>

      {terminal && task.resultText && (
        <TerminalSummary status={task.status} text={task.resultText} />
      )}

      <div ref={scrollAnchorRef} />
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

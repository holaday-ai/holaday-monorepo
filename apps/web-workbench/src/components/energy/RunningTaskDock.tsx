import { taskStatusLabel } from '@/lib/task-status-copy';
import type { UiTask, UiTaskStatus } from '@/types/task';
import { summariseIntent } from '@/utils/summarise-intent';
import { CheckCircle2, CircleAlert, CircleDotDashed, ExternalLink, XCircle } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  activeEnergyDockPeers,
  isEnergyDockActiveStatus,
  isEnergyDockTerminalStatus,
  selectEnergyDockTask,
} from './running-task-dock-state';

export type RunningTaskDockEvent = {
  type: 'running_task_returned';
  taskStatus: 'running' | 'waiting' | 'completed' | 'failed' | 'multiple';
};

interface RunningTaskDockProps {
  tasks: readonly UiTask[];
  onEvent: (event: RunningTaskDockEvent) => void;
}

export function RunningTaskDock({ tasks, onEvent }: RunningTaskDockProps): JSX.Element | null {
  const navigate = useNavigate();
  const initialTaskRef = React.useRef<UiTask | null>(null);
  if (initialTaskRef.current === null) initialTaskRef.current = selectEnergyDockTask(tasks);
  const trackedTaskIdRef = React.useRef<string | null>(initialTaskRef.current?.taskId ?? null);
  const [, refreshTracking] = React.useReducer((value) => value + 1, 0);
  const trackedTask = trackedTaskIdRef.current
    ? tasks.find((task) => task.taskId === trackedTaskIdRef.current)
    : null;
  const trackedIsVisible = Boolean(
    trackedTask &&
      (isEnergyDockActiveStatus(trackedTask.status) ||
        isEnergyDockTerminalStatus(trackedTask.status)),
  );
  const selectedTask = trackedIsVisible ? (trackedTask ?? null) : selectEnergyDockTask(tasks);

  React.useEffect(() => {
    if (trackedIsVisible) return;
    const nextTaskId = selectEnergyDockTask(tasks)?.taskId ?? null;
    if (trackedTaskIdRef.current === nextTaskId) return;
    trackedTaskIdRef.current = nextTaskId;
    refreshTracking();
  }, [tasks, trackedIsVisible]);

  const now = useMinuteClock(
    Boolean(selectedTask && isEnergyDockActiveStatus(selectedTask.status)),
  );
  if (!selectedTask) return null;

  const terminal = isEnergyDockTerminalStatus(selectedTask.status);
  const peers = terminal ? [] : activeEnergyDockPeers(tasks);
  const ambiguous = peers.length > 1;
  const waiting = selectedTask.status === 'awaiting_user' || selectedTask.status === 'paused';
  const label = taskStatusLabel(selectedTask.status, selectedTask.awaitingKind);
  const ctaLabel = terminal
    ? '查看任务结果'
    : ambiguous
      ? '查看进行中的任务'
      : waiting
        ? '返回任务处理'
        : '返回任务';
  const Icon = statusIcon(selectedTask.status);
  const title = selectedTask.title?.trim() || summariseIntent(selectedTask.intent, 32);

  return (
    <section
      className="energy-running-task-dock"
      aria-label="运行中任务"
      data-status={selectedTask.status}
    >
      <span className="energy-running-task-dock__icon">
        <Icon aria-hidden="true" />
      </span>
      <div className="energy-running-task-dock__copy">
        <div>
          <strong>{ambiguous ? `${peers.length} 个任务正在处理` : title}</strong>
          <span>{label}</span>
        </div>
        <small>
          {terminal ? '状态刚刚更新，可以随时回去查看。' : elapsedLabel(selectedTask, now)}
        </small>
      </div>
      <button
        type="button"
        onClick={() => {
          const taskStatus = ambiguous ? 'multiple' : analyticsTaskStatus(selectedTask.status);
          onEvent({ type: 'running_task_returned', taskStatus });
          navigate(ambiguous ? '/' : `/?task=${encodeURIComponent(selectedTask.taskId)}`);
        }}
      >
        {ctaLabel}
        <ExternalLink aria-hidden="true" />
      </button>
    </section>
  );
}

function useMinuteClock(enabled: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

function elapsedLabel(task: UiTask, now: number): string {
  const minutes = Math.max(0, Math.floor((now - task.createdAt.getTime()) / 60_000));
  if (minutes < 1) return '刚刚开始';
  if (minutes < 60) return `已运行 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `已运行 ${hours} 小时 ${remainder} 分钟` : `已运行 ${hours} 小时`;
}

function statusIcon(status: UiTaskStatus) {
  if (status === 'completed' || status === 'partial_success') return CheckCircle2;
  if (status === 'failed' || status === 'cancelled') return XCircle;
  if (status === 'awaiting_user' || status === 'paused') return CircleAlert;
  return CircleDotDashed;
}

function analyticsTaskStatus(
  status: UiTaskStatus,
): Exclude<RunningTaskDockEvent['taskStatus'], 'multiple'> {
  if (status === 'awaiting_user' || status === 'paused') return 'waiting';
  if (status === 'completed' || status === 'partial_success') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'running';
}

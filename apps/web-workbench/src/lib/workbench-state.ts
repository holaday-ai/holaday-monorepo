import type { UiTask } from '@/types/task';
import { isTerminalStatus } from '@/types/task';
import type { ConnStatus } from '@/lib/ws';

export interface WorkbenchToastCopy {
  message: string;
  tone?: 'info' | 'error';
  durationMs?: number;
}

export function networkTransitionToast(
  previousOnline: boolean,
  nextOnline: boolean,
): WorkbenchToastCopy | null {
  if (previousOnline === nextOnline) return null;
  return nextOnline
    ? { message: '网络已恢复，可以继续创建任务', tone: 'info' }
    : { message: '网络连接已断开', tone: 'error' };
}

export function realtimeConnectionTransition(input: {
  previousStatus: ConnStatus;
  nextStatus: ConnStatus;
  hadDisconnect: boolean;
  authed: boolean;
}): { hadDisconnect: boolean; toast: WorkbenchToastCopy | null } {
  if (!input.authed) {
    return { hadDisconnect: input.hadDisconnect, toast: null };
  }
  if (
    input.previousStatus === 'open' &&
    (input.nextStatus === 'closed' || input.nextStatus === 'connecting')
  ) {
    return {
      hadDisconnect: true,
      toast: { message: '实时连接已断开，正在重连…', tone: 'error' },
    };
  }
  if (input.nextStatus === 'open' && input.hadDisconnect) {
    return {
      hadDisconnect: false,
      toast: { message: '实时连接已恢复', tone: 'info', durationMs: 3000 },
    };
  }
  return { hadDisconnect: input.hadDisconnect, toast: null };
}

export function isLiveBrowserTaskForWorkbench(task: UiTask | null): boolean {
  return Boolean(
    task &&
      task.executionMode === 'browser' &&
      !isTerminalStatus(task.status),
  );
}

export function followUpTargetForTask(input: {
  selectedTask: UiTask | null;
  selectedTaskId: string | null;
  selectedNeedsUser: boolean;
}): { taskId: string; title: string } | null {
  const { selectedTask, selectedTaskId } = input;
  if (!selectedTask || !selectedTaskId) return null;
  if (input.selectedNeedsUser) return null;
  if (!isTerminalStatus(selectedTask.status)) return null;

  return {
    taskId: selectedTaskId,
    title: (selectedTask.title || selectedTask.intent || '').slice(0, 40),
  };
}

export function normalizeTaskActionCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

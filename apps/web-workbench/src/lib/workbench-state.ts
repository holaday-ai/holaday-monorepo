import type { UiTask } from '@/types/task';
import { isTerminalStatus } from '@/types/task';
import type { ConnStatus } from '@/lib/ws';
import type { SidePanelMode, SidePanelOverride } from '@/types/side-panel';

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
      !isWorkbenchTerminalTask(task),
  );
}

export function isWorkbenchTerminalTask(task: UiTask): boolean {
  return (
    isTerminalStatus(task.status) ||
    (task.status === 'paused' && Boolean(task.resultText))
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
  if (!isWorkbenchTerminalTask(selectedTask)) return null;

  return {
    taskId: selectedTaskId,
    title: (selectedTask.title || selectedTask.intent || '').slice(0, 40),
  };
}

export function preserveBrowserRecordAfterLive(input: {
  previousTaskId: string | null;
  currentTaskId: string | null;
  previousMode: SidePanelMode;
  currentOverride: SidePanelOverride;
  isTerminalBrowserTask: boolean;
}): SidePanelOverride {
  if (input.currentOverride !== null) return input.currentOverride;
  if (!input.currentTaskId || input.previousTaskId !== input.currentTaskId) {
    return input.currentOverride;
  }
  if (!input.isTerminalBrowserTask) return input.currentOverride;
  return input.previousMode === 'browser-live' ? 'open' : input.currentOverride;
}

export function mobileBrowserSheetAutoOpenState(input: {
  taskId: string | null;
  mode: SidePanelMode;
  isMobile: boolean;
  autoOpenedTaskId: string | null;
}): { shouldOpen: boolean; autoOpenedTaskId: string | null } {
  if (!input.isMobile || !input.taskId || input.mode !== 'browser-live') {
    return { shouldOpen: false, autoOpenedTaskId: input.autoOpenedTaskId };
  }
  if (input.autoOpenedTaskId === input.taskId) {
    return { shouldOpen: false, autoOpenedTaskId: input.autoOpenedTaskId };
  }
  return { shouldOpen: true, autoOpenedTaskId: input.taskId };
}

export function normalizeTaskActionCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

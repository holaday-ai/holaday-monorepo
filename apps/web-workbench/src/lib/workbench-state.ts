import type { UiScreencast, UiTask } from '@/types/task';
import type { ConnStatus } from '@/lib/ws';
import type { SidePanelMode, SidePanelOverride } from '@/types/side-panel';
import { deriveTaskProductState } from '@/lib/task-product-state';

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
      toast: { message: '任务连接已断开，正在重连…', tone: 'error' },
    };
  }
  if (input.nextStatus === 'open' && input.hadDisconnect) {
    return {
      hadDisconnect: false,
      toast: { message: '任务连接已恢复', tone: 'info', durationMs: 3000 },
    };
  }
  return { hadDisconnect: input.hadDisconnect, toast: null };
}

const BROWSER_TASK_VERBS = ['打开', '登录', '访问', '点击', '下载', '搜索'];

/**
 * Legacy task rows may predate executionMode while still owning browser
 * evidence. Keep one shared heuristic for the toolbar and workbench shell so
 * reopening those tasks cannot detach them from their browser record.
 */
export function hasBrowserRecordForWorkbench(task: UiTask | null): boolean {
  if (!task) return false;
  if (task.executionMode === 'browser') return true;
  if (task.executionMode) return false;
  if (task.finalUrl?.trim() || task.finalScreenshot) return true;
  const intent = task.intent ?? '';
  if (/https?:\/\//i.test(intent)) return true;
  return BROWSER_TASK_VERBS.some((verb) => intent.includes(verb));
}

export function taskFrameForWorkbench(
  taskId: string | null,
  framesByTask: Record<string, UiScreencast | undefined>,
): UiScreencast | null {
  return taskId ? (framesByTask[taskId] ?? null) : null;
}

export function isLiveBrowserTaskForWorkbench(task: UiTask | null): boolean {
  return Boolean(
    task &&
      hasBrowserRecordForWorkbench(task) &&
      !isWorkbenchTerminalTask(task),
  );
}

export function isWorkbenchTerminalTask(task: UiTask): boolean {
  return deriveTaskProductState({
    status: task.status,
    queuePosition: task.queuePosition,
    tickCount: task.tickCount,
    awaitingKind: task.awaitingKind ?? null,
  }).lifecycle === 'terminal';
}

export function terminalTaskHasFollowUpContext(task: UiTask): boolean {
  if (task.status !== 'completed' && task.status !== 'partial_success') {
    return false;
  }
  return Boolean(
    task.resultText?.trim() ||
      task.finalUrl?.trim() ||
      task.finalScreenshot ||
      (task.attachments?.length ?? 0) > 0,
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
  if (!terminalTaskHasFollowUpContext(selectedTask)) return null;

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
  autoOpenedKey: string | null;
}): { shouldOpen: boolean; autoOpenedKey: string | null } {
  if (
    !input.isMobile ||
    !input.taskId ||
    (input.mode !== 'browser-live' && input.mode !== 'browser-record')
  ) {
    return { shouldOpen: false, autoOpenedKey: input.autoOpenedKey };
  }
  const nextKey = `${input.taskId}:${input.mode}`;
  if (input.autoOpenedKey === nextKey) {
    return { shouldOpen: false, autoOpenedKey: input.autoOpenedKey };
  }
  return { shouldOpen: true, autoOpenedKey: nextKey };
}

export function normalizeTaskActionCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

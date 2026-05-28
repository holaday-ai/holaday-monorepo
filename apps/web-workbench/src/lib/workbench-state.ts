import type { UiTask } from '@/types/task';
import { isTerminalStatus } from '@/types/task';

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

import type { UiTask } from '@/types/task';
import { isTaskDeletable } from '@/utils/time-buckets';

type BatchTask = Pick<UiTask, 'taskId' | 'status'>;

export function deletableTaskIdsForBatchSelection(
  tasks: readonly BatchTask[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const task of tasks) {
    if (seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    if (isTaskDeletable(task.status)) ids.push(task.taskId);
  }
  return ids;
}

export function pruneBatchSelection(
  selected: ReadonlySet<string>,
  deletableTaskIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const taskId of selected) {
    if (deletableTaskIds.has(taskId)) next.add(taskId);
  }
  return next;
}

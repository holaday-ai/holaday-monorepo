import type { UiTask, UiTaskStatus } from '@/types/task';

const PRIORITY: Partial<Record<UiTaskStatus, number>> = {
  awaiting_user: 0,
  executing: 1,
  planning: 2,
  queued: 3,
  pending: 4,
  paused: 5,
};

export function selectEnergyDockTask(tasks: readonly UiTask[]): UiTask | null {
  return (
    tasks
      .filter((task) => PRIORITY[task.status] !== undefined)
      .sort((left, right) => {
        const priorityDifference =
          (PRIORITY[left.status] ?? Number.MAX_SAFE_INTEGER) -
          (PRIORITY[right.status] ?? Number.MAX_SAFE_INTEGER);
        return priorityDifference || right.createdAt.getTime() - left.createdAt.getTime();
      })[0] ?? null
  );
}

export function activeEnergyDockPeers(tasks: readonly UiTask[]): UiTask[] {
  const selected = selectEnergyDockTask(tasks);
  if (!selected) return [];
  const selectedPriority = PRIORITY[selected.status];
  return tasks.filter((task) => PRIORITY[task.status] === selectedPriority);
}

export function isEnergyDockActiveStatus(status: UiTaskStatus): boolean {
  return PRIORITY[status] !== undefined;
}

export function isEnergyDockTerminalStatus(status: UiTaskStatus): boolean {
  return (
    status === 'completed' ||
    status === 'partial_success' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

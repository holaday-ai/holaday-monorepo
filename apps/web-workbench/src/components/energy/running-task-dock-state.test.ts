import type { UiTask, UiTaskStatus } from '@/types/task';
import { describe, expect, it } from 'vitest';
import { activeEnergyDockPeers, selectEnergyDockTask } from './running-task-dock-state';

function task(taskId: string, status: UiTaskStatus, createdAt = '2026-08-12T10:00:00Z'): UiTask {
  return {
    taskId,
    intent: `执行 ${taskId}`,
    title: null,
    status,
    tickCount: 0,
    createdAt: new Date(createdAt),
  };
}

describe('running task dock state', () => {
  it('prioritizes a task waiting for the user over executing and queued tasks', () => {
    expect(
      selectEnergyDockTask([
        task('queued', 'queued'),
        task('running', 'executing'),
        task('needs-user', 'awaiting_user'),
      ])?.taskId,
    ).toBe('needs-user');
  });

  it('chooses the newest task within one priority', () => {
    expect(
      selectEnergyDockTask([
        task('older', 'executing', '2026-08-12T09:00:00Z'),
        task('newer', 'executing', '2026-08-12T11:00:00Z'),
      ])?.taskId,
    ).toBe('newer');
  });

  it('returns all equal-priority peers so the UI can avoid guessing', () => {
    const tasks = [task('one', 'planning'), task('two', 'executing'), task('three', 'executing')];
    expect(activeEnergyDockPeers(tasks).map((item) => item.taskId)).toEqual(['two', 'three']);
  });

  it('returns null when there is no active or newly terminal tracked task', () => {
    expect(selectEnergyDockTask([task('old', 'completed')])).toBeNull();
  });
});

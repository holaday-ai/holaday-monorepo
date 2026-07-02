import { describe, expect, it, vi } from 'vitest';

import { persistAndBroadcastVisionLoopThrow } from './task-terminal-recovery.js';

describe('persistAndBroadcastVisionLoopThrow', () => {
  it('broadcasts a failed terminal only after the recovery persist succeeds', async () => {
    const persistVisionOutcome = vi.fn(async () => ({ persisted: true }));
    const broadcastToUser = vi.fn();
    const logger = { error: vi.fn(), warn: vi.fn() };

    const persisted = await persistAndBroadcastVisionLoopThrow({
      repo: { persistVisionOutcome },
      taskId: 'task_1',
      userId: 'usr_1',
      reason: 'driver crashed',
      logger,
      broadcastToUser,
    });

    expect(persisted).toBe(true);
    expect(persistVisionOutcome).toHaveBeenCalledWith('task_1', {
      status: 'failed',
      reason: 'vision loop threw: driver crashed',
      tickCount: 0,
    });
    expect(broadcastToUser).toHaveBeenCalledWith('usr_1', {
      type: 'server.task.terminal',
      taskId: 'task_1',
      status: 'failed',
      reason: 'vision loop threw: driver crashed',
    });
  });

  it('does not broadcast when the guarded recovery persist is stale', async () => {
    const broadcastToUser = vi.fn();

    const persisted = await persistAndBroadcastVisionLoopThrow({
      repo: { persistVisionOutcome: vi.fn(async () => ({ persisted: false })) },
      taskId: 'task_1',
      userId: 'usr_1',
      reason: 'late crash after park',
      logger: { error: vi.fn(), warn: vi.fn() },
      broadcastToUser,
    });

    expect(persisted).toBe(false);
    expect(broadcastToUser).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { markQueuedTaskExecutingOrThrow } from './task-queue-start.js';

describe('markQueuedTaskExecutingOrThrow', () => {
  it('resolves when the queued to executing guard persists', async () => {
    const repo = { markQueuedTaskExecuting: vi.fn(async () => ({ persisted: true })) };
    const logger = { warn: vi.fn() };

    await expect(
      markQueuedTaskExecutingOrThrow({ repo, taskId: 'task_1', logger }),
    ).resolves.toBeUndefined();

    expect(repo.markQueuedTaskExecuting).toHaveBeenCalledWith('task_1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('throws when the queued to executing guard is stale', async () => {
    const logger = { warn: vi.fn() };

    await expect(
      markQueuedTaskExecutingOrThrow({
        repo: { markQueuedTaskExecuting: vi.fn(async () => ({ persisted: false })) },
        taskId: 'task_1',
        logger,
      }),
    ).rejects.toThrow('task was no longer queued');

    expect(logger.warn).toHaveBeenCalledWith(
      { taskId: 'task_1' },
      'task-queue: onStart refused because task was no longer queued',
    );
  });
});

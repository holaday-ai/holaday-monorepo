type QueuedStartRepo = {
  markQueuedTaskExecuting(taskId: string): Promise<{ persisted: boolean }>;
};

type QueuedStartLogger = {
  warn(meta: Record<string, unknown>, message: string): void;
};

export async function markQueuedTaskExecutingOrThrow(args: {
  repo: QueuedStartRepo;
  taskId: string;
  logger: QueuedStartLogger;
}): Promise<void> {
  const started = await args.repo.markQueuedTaskExecuting(args.taskId);
  if (started.persisted) return;

  args.logger.warn(
    { taskId: args.taskId },
    'task-queue: onStart refused because task was no longer queued',
  );
  throw new Error('task was no longer queued');
}

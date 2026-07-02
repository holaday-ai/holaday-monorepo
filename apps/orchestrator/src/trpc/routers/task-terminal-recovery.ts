type VisionLoopThrownOutcome = {
  status: 'failed';
  reason: string;
  tickCount: number;
};

type VisionLoopRecoveryRepo = {
  persistVisionOutcome(
    taskId: string,
    outcome: VisionLoopThrownOutcome,
  ): Promise<{ persisted: boolean }>;
};

type VisionLoopRecoveryLogger = {
  error(meta: Record<string, unknown>, message: string): void;
  warn(meta: Record<string, unknown>, message: string): void;
};

type TerminalBroadcast = (
  userId: string,
  message: {
    type: 'server.task.terminal';
    taskId: string;
    status: 'failed';
    reason: string;
  },
) => void;

export async function persistAndBroadcastVisionLoopThrow(args: {
  repo: VisionLoopRecoveryRepo;
  taskId: string;
  userId: string;
  reason: string;
  logger: VisionLoopRecoveryLogger;
  broadcastToUser: TerminalBroadcast;
}): Promise<boolean> {
  const failedReason = `vision loop threw: ${args.reason}`.slice(0, 500);
  let persisted = false;

  try {
    const out = await args.repo.persistVisionOutcome(args.taskId, {
      status: 'failed',
      reason: failedReason,
      tickCount: 0,
    });
    persisted = out.persisted;
  } catch (err) {
    args.logger.error(
      { err, taskId: args.taskId },
      'vision loop: catch-block persist also failed',
    );
    return false;
  }

  if (!persisted) return false;

  try {
    args.broadcastToUser(args.userId, {
      type: 'server.task.terminal',
      taskId: args.taskId,
      status: 'failed',
      reason: failedReason.slice(0, 200),
    });
  } catch (err) {
    args.logger.warn({ err, taskId: args.taskId }, 'vision loop: broadcast terminal failed');
  }

  return true;
}

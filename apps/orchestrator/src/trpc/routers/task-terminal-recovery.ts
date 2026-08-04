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

type BrowserDispatchFailureOutcome = {
  status: 'failed';
  reason: string;
  errorCode: 'BROWSER_SESSION_UNAVAILABLE';
  tickCount: number;
  metadata: {
    executionMode: 'browser';
    finalExecutionMode: 'browser';
    lane: 'browser_dispatch';
  };
};

type BrowserDispatchFailureRepo = {
  persistVisionOutcome(
    taskId: string,
    outcome: BrowserDispatchFailureOutcome,
  ): Promise<{ persisted: boolean }>;
};

export interface CapturedBrowserFinalState {
  finalScreenshot?: string;
  finalUrl?: string;
  finalViewport?: { width: number; height: number };
}

type BrowserFinalStateLogger = {
  warn(meta: Record<string, unknown>, message: string): void;
};

type BrowserScreenshotResult = {
  error?: unknown;
  base64?: string;
  viewportWidth?: number;
  viewportHeight?: number;
};

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

export async function persistAndBroadcastBrowserDispatchFailure(args: {
  repo: BrowserDispatchFailureRepo;
  taskId: string;
  userId: string;
  reason: string;
  logger: VisionLoopRecoveryLogger;
  broadcastToUser: TerminalBroadcast;
}): Promise<boolean> {
  const failedReason = `浏览器工作区启动失败：${args.reason}`.slice(0, 500);
  let persisted = false;

  try {
    const out = await args.repo.persistVisionOutcome(args.taskId, {
      status: 'failed',
      reason: failedReason,
      errorCode: 'BROWSER_SESSION_UNAVAILABLE',
      tickCount: 0,
      metadata: {
        executionMode: 'browser',
        finalExecutionMode: 'browser',
        lane: 'browser_dispatch',
      },
    });
    persisted = out.persisted;
  } catch (err) {
    args.logger.error(
      { err, taskId: args.taskId },
      'browser dispatch: failed outcome could not be persisted',
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
    args.logger.warn(
      { err, taskId: args.taskId },
      'browser dispatch: terminal broadcast failed',
    );
  }

  return true;
}

export async function captureBrowserFinalState<TPage>(args: {
  executor: {
    getPage(): Promise<TPage>;
    screenshot(
      page: TPage,
      options: { timeoutMs: number },
    ): Promise<BrowserScreenshotResult>;
  };
  logger: BrowserFinalStateLogger;
  taskId: string;
}): Promise<CapturedBrowserFinalState> {
  let page: TPage;
  try {
    page = await args.executor.getPage();
  } catch (err) {
    args.logger.warn(
      { err: err instanceof Error ? err.message : String(err), taskId: args.taskId },
      'captureFinalState: page lookup failed (non-fatal)',
    );
    return {};
  }

  let finalUrl: string | undefined;
  try {
    const observed = (page as unknown as { url?: () => unknown }).url?.();
    if (typeof observed === 'string' && observed.trim()) {
      finalUrl = observed.trim();
    }
  } catch {
    finalUrl = undefined;
  }
  const urlOnly: CapturedBrowserFinalState = finalUrl ? { finalUrl } : {};

  try {
    const shot = await args.executor.screenshot(page, { timeoutMs: 5_000 });
    if (shot.error || !shot.base64) {
      args.logger.warn(
        {
          taskId: args.taskId,
          error: shot.error ? String(shot.error) : 'missing screenshot data',
        },
        'captureFinalState: screenshot capture failed; preserving URL',
      );
      return urlOnly;
    }
    return {
      ...urlOnly,
      finalScreenshot: shot.base64,
      ...(shot.viewportWidth && shot.viewportHeight
        ? {
            finalViewport: {
              width: shot.viewportWidth,
              height: shot.viewportHeight,
            },
          }
        : {}),
    };
  } catch (err) {
    args.logger.warn(
      { err: err instanceof Error ? err.message : String(err), taskId: args.taskId },
      'captureFinalState: screenshot capture failed; preserving URL',
    );
    return urlOnly;
  }
}

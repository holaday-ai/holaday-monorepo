import { describe, expect, it, vi } from 'vitest';

import {
  captureBrowserFinalState,
  persistAndBroadcastBrowserDispatchFailure,
  persistAndBroadcastVisionLoopThrow,
} from './task-terminal-recovery.js';

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

describe('persistAndBroadcastBrowserDispatchFailure', () => {
  it('finishes a browser task when same-page continuation cannot start', async () => {
    const persistVisionOutcome = vi.fn(async () => ({ persisted: true }));
    const broadcastToUser = vi.fn();

    const persisted = await persistAndBroadcastBrowserDispatchFailure({
      repo: { persistVisionOutcome },
      taskId: 'task_follow_up',
      userId: 'usr_1',
      reason: '当前浏览器页面已过期',
      logger: { error: vi.fn(), warn: vi.fn() },
      broadcastToUser,
    });

    expect(persisted).toBe(true);
    expect(persistVisionOutcome).toHaveBeenCalledWith('task_follow_up', {
      status: 'failed',
      reason: '浏览器工作区启动失败：当前浏览器页面已过期',
      errorCode: 'BROWSER_SESSION_UNAVAILABLE',
      tickCount: 0,
      metadata: {
        executionMode: 'browser',
        finalExecutionMode: 'browser',
        lane: 'browser_dispatch',
      },
    });
    expect(broadcastToUser).toHaveBeenCalledWith('usr_1', {
      type: 'server.task.terminal',
      taskId: 'task_follow_up',
      status: 'failed',
      reason: '浏览器工作区启动失败：当前浏览器页面已过期',
    });
  });
});

describe('captureBrowserFinalState', () => {
  it('preserves the real URL even when screenshot capture fails', async () => {
    const logger = { warn: vi.fn() };
    const page = { url: () => 'https://example.com/continued' };

    const state = await captureBrowserFinalState({
      executor: {
        getPage: vi.fn(async () => page),
        screenshot: vi.fn(async () => ({ error: 'renderer closed' })),
      },
      logger,
      taskId: 'task_1',
    });

    expect(state).toEqual({ finalUrl: 'https://example.com/continued' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns URL, screenshot, and viewport when all evidence is available', async () => {
    const page = { url: () => 'https://example.com/result' };

    const state = await captureBrowserFinalState({
      executor: {
        getPage: vi.fn(async () => page),
        screenshot: vi.fn(async () => ({
          base64: 'jpeg-data',
          viewportWidth: 1280,
          viewportHeight: 800,
        })),
      },
      logger: { warn: vi.fn() },
      taskId: 'task_2',
    });

    expect(state).toEqual({
      finalUrl: 'https://example.com/result',
      finalScreenshot: 'jpeg-data',
      finalViewport: { width: 1280, height: 800 },
    });
  });
});

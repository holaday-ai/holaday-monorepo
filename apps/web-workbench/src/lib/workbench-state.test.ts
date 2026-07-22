import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  followUpTargetForTask,
  hasBrowserRecordForWorkbench,
  isLiveBrowserTaskForWorkbench,
  networkTransitionToast,
  normalizeTaskActionCount,
  mobileBrowserSheetAutoOpenState,
  preserveBrowserRecordAfterLive,
  realtimeConnectionTransition,
  shouldConnectTaskBrowserForWorkbench,
  taskFrameForWorkbench,
} from './workbench-state';

function task(overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId: 'tsk_test',
    intent: '打开 https://example.com 并总结结果',
    title: null,
    status: 'executing',
    tickCount: 0,
    createdAt: new Date('2026-05-21T00:00:00Z'),
    executionMode: 'browser',
    ...overrides,
  };
}

describe('workbench state helpers', () => {
  it('does not treat partial-success browser tasks as live browser sessions', () => {
    expect(isLiveBrowserTaskForWorkbench(task({ status: 'executing' }))).toBe(
      true,
    );
    expect(isLiveBrowserTaskForWorkbench(task({ status: 'awaiting_user' }))).toBe(
      true,
    );
    expect(
      isLiveBrowserTaskForWorkbench(task({ status: 'partial_success' })),
    ).toBe(false);
    expect(isLiveBrowserTaskForWorkbench(task({ status: 'completed' }))).toBe(
      false,
    );
  });

  it('keeps legacy browser-like tasks attached to their browser record', () => {
    const legacyTask = task({ executionMode: undefined });
    expect(hasBrowserRecordForWorkbench(legacyTask)).toBe(true);
    expect(isLiveBrowserTaskForWorkbench(legacyTask)).toBe(true);
    expect(
      hasBrowserRecordForWorkbench(
        task({ executionMode: undefined, intent: '总结这段文字' }),
      ),
    ).toBe(false);
  });

  it('does not reopen the browser for an explicitly non-browser task', () => {
    expect(
      hasBrowserRecordForWorkbench(
        task({ executionMode: 'generate', intent: '总结 https://example.com 的内容' }),
      ),
    ).toBe(false);
    expect(
      hasBrowserRecordForWorkbench(
        task({ executionMode: 'image', finalUrl: 'https://example.com/reference' }),
      ),
    ).toBe(false);
  });

  it('keeps an owned browser connected even when generic progress buffers exist', () => {
    expect(
      shouldConnectTaskBrowserForWorkbench({
        task: task({ executionMode: 'browser' }),
        hasRuntimeTextSignal: true,
      }),
    ).toBe(true);
    expect(
      shouldConnectTaskBrowserForWorkbench({
        task: task({
          executionMode: undefined,
          status: 'completed',
          finalUrl: 'https://example.com/result',
        }),
        hasRuntimeTextSignal: true,
      }),
    ).toBe(true);
  });

  it('uses runtime text only as a fallback for tasks with no browser ownership signal', () => {
    expect(
      shouldConnectTaskBrowserForWorkbench({
        task: task({ executionMode: undefined, intent: '总结这段文字' }),
        hasRuntimeTextSignal: true,
      }),
    ).toBe(false);
    expect(
      shouldConnectTaskBrowserForWorkbench({
        task: task({ executionMode: 'generate' }),
        hasRuntimeTextSignal: false,
      }),
    ).toBe(false);
  });

  it('recognizes saved browser evidence even when legacy intent has no browser verbs', () => {
    expect(
      hasBrowserRecordForWorkbench(
        task({
          executionMode: undefined,
          intent: '整理最终页面',
          status: 'completed',
          finalUrl: 'https://example.com/result',
        }),
      ),
    ).toBe(true);
    expect(
      hasBrowserRecordForWorkbench(
        task({
          executionMode: undefined,
          intent: '整理最终页面',
          status: 'completed',
          finalScreenshot: 'saved-browser-frame',
        }),
      ),
    ).toBe(true);
  });

  it('selects only the frame keyed to the active task', () => {
    const first = {
      tickIndex: 1,
      imageBase64: 'first',
      url: 'https://first.example',
      viewport: { width: 1280, height: 720 },
      timestamp: '2026-07-17T00:00:00.000Z',
    };
    const second = {
      ...first,
      tickIndex: 2,
      imageBase64: 'second',
      url: 'https://second.example',
    };
    const frames = { tsk_first: first, tsk_second: second };

    expect(taskFrameForWorkbench('tsk_second', frames)).toBe(second);
    expect(taskFrameForWorkbench('tsk_missing', frames)).toBeNull();
    expect(taskFrameForWorkbench(null, frames)).toBeNull();
  });

  it('keeps paused browser tasks live even when a pause frame carries a result', () => {
    expect(isLiveBrowserTaskForWorkbench(task({ status: 'paused' }))).toBe(
      true,
    );
    expect(
      isLiveBrowserTaskForWorkbench(
        task({ status: 'paused', resultText: '已完成到可跟进的阶段。' }),
      ),
    ).toBe(true);
  });

  it('allows follow-up only for terminal results with usable context', () => {
    expect(
      followUpTargetForTask({
        selectedTask: task({
          status: 'completed',
          resultText: '已完成网页检索并整理结果。',
        }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: false,
      }),
    ).toEqual({
      taskId: 'tsk_test',
      title: '打开 https://example.com 并总结结果',
    });
    expect(
      followUpTargetForTask({
        selectedTask: task({
          status: 'partial_success',
          finalUrl: 'https://example.com/result',
        }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: false,
      }),
    ).toEqual({
      taskId: 'tsk_test',
      title: '打开 https://example.com 并总结结果',
    });
  });

  it('keeps browser follow-up available after failed or cancelled terminal tasks', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      expect(
        followUpTargetForTask({
          selectedTask: task({
            status,
            executionMode: 'browser',
            finalUrl: 'https://example.com/recoverable',
          }),
          selectedTaskId: 'tsk_test',
          selectedNeedsUser: false,
        }),
      ).toEqual({
        taskId: 'tsk_test',
        title: '打开 https://example.com 并总结结果',
      });
    }
  });

  it('suppresses follow-up for failed non-browser tasks or empty successful tasks', () => {
    for (const selectedTask of [
      task({
        status: 'failed',
        executionMode: 'generate',
        resultText: 'Generation timeout',
      }),
      task({
        status: 'cancelled',
        executionMode: 'generate',
        resultText: '已取消，未产生任何费用。',
      }),
      task({ status: 'completed' }),
      task({ status: 'partial_success' }),
    ]) {
      expect(
        followUpTargetForTask({
          selectedTask,
          selectedTaskId: 'tsk_test',
          selectedNeedsUser: false,
        }),
      ).toBeNull();
    }
  });

  it('suppresses follow-up chips for paused tasks even when they have a result', () => {
    expect(
      followUpTargetForTask({
        selectedTask: task({
          status: 'paused',
          resultText: '已完成到可跟进的阶段。',
        }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: false,
      }),
    ).toBeNull();
  });

  it('suppresses follow-up chips while the task is still active or awaiting user input', () => {
    expect(
      followUpTargetForTask({
        selectedTask: task({ status: 'executing' }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: false,
      }),
    ).toBeNull();
    expect(
      followUpTargetForTask({
        selectedTask: task({ status: 'paused' }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: false,
      }),
    ).toBeNull();
    expect(
      followUpTargetForTask({
        selectedTask: task({ status: 'completed' }),
        selectedTaskId: 'tsk_test',
        selectedNeedsUser: true,
      }),
    ).toBeNull();
  });

  it('normalizes task action counts before rendering destructive copy', () => {
    expect(normalizeTaskActionCount(3)).toBe(3);
    expect(normalizeTaskActionCount(3.9)).toBe(3);
    expect(normalizeTaskActionCount(0)).toBe(0);
    expect(normalizeTaskActionCount(-1)).toBe(0);
    expect(normalizeTaskActionCount(Number.NaN)).toBe(0);
    expect(normalizeTaskActionCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeTaskActionCount('4')).toBe(0);
    expect(normalizeTaskActionCount({ count: 4 })).toBe(0);
  });

  it('only toasts real browser network transitions', () => {
    expect(networkTransitionToast(true, true)).toBeNull();
    expect(networkTransitionToast(false, false)).toBeNull();
    expect(networkTransitionToast(true, false)).toEqual({
      message: '网络连接已断开',
      tone: 'error',
    });
    expect(networkTransitionToast(false, true)).toEqual({
      message: '网络已恢复，可以继续创建任务',
      tone: 'info',
    });
  });

  it('keeps task reconnect toasts gated on an actual disconnect', () => {
    expect(
      realtimeConnectionTransition({
        previousStatus: 'idle',
        nextStatus: 'open',
        hadDisconnect: false,
        authed: true,
      }),
    ).toEqual({ hadDisconnect: false, toast: null });
    expect(
      realtimeConnectionTransition({
        previousStatus: 'open',
        nextStatus: 'connecting',
        hadDisconnect: false,
        authed: true,
      }),
    ).toEqual({
      hadDisconnect: true,
      toast: { message: '任务连接已断开，正在重连…', tone: 'error' },
    });
    expect(
      realtimeConnectionTransition({
        previousStatus: 'connecting',
        nextStatus: 'open',
        hadDisconnect: true,
        authed: true,
      }),
    ).toEqual({
      hadDisconnect: false,
      toast: {
        message: '任务连接已恢复',
        tone: 'info',
        durationMs: 3000,
      },
    });
  });

  it('does not show task reconnect toasts while signed out', () => {
    expect(
      realtimeConnectionTransition({
        previousStatus: 'open',
        nextStatus: 'closed',
        hadDisconnect: false,
        authed: false,
      }),
    ).toEqual({ hadDisconnect: false, toast: null });
  });

  it('keeps browser evidence visible when a live browser task reaches terminal state', () => {
    expect(
      preserveBrowserRecordAfterLive({
        previousTaskId: 'tsk_test',
        currentTaskId: 'tsk_test',
        previousMode: 'browser-live',
        currentOverride: null,
        isTerminalBrowserTask: true,
      }),
    ).toBe('open');
  });

  it('does not reopen evidence after a manual close or task switch', () => {
    expect(
      preserveBrowserRecordAfterLive({
        previousTaskId: 'tsk_test',
        currentTaskId: 'tsk_test',
        previousMode: 'browser-live',
        currentOverride: 'close',
        isTerminalBrowserTask: true,
      }),
    ).toBe('close');
    expect(
      preserveBrowserRecordAfterLive({
        previousTaskId: 'tsk_old',
        currentTaskId: 'tsk_new',
        previousMode: 'browser-live',
        currentOverride: null,
        isTerminalBrowserTask: true,
      }),
    ).toBeNull();
  });

  it('auto-opens the mobile browser sheet once for each live browser task', () => {
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: 'tsk_live',
        mode: 'browser-live',
        isMobile: true,
        autoOpenedKey: null,
      }),
    ).toEqual({
      shouldOpen: true,
      autoOpenedKey: 'tsk_live:browser-live',
    });
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: 'tsk_live',
        mode: 'browser-live',
        isMobile: true,
        autoOpenedKey: 'tsk_live:browser-live',
      }),
    ).toEqual({
      shouldOpen: false,
      autoOpenedKey: 'tsk_live:browser-live',
    });
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: 'tsk_next',
        mode: 'browser-live',
        isMobile: true,
        autoOpenedKey: 'tsk_live:browser-live',
      }),
    ).toEqual({
      shouldOpen: true,
      autoOpenedKey: 'tsk_next:browser-live',
    });
  });

  it('auto-opens terminal browser evidence after the live mobile sheet', () => {
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: 'tsk_live',
        mode: 'browser-record',
        isMobile: true,
        autoOpenedKey: 'tsk_live:browser-live',
      }),
    ).toEqual({
      shouldOpen: true,
      autoOpenedKey: 'tsk_live:browser-record',
    });
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: 'tsk_live',
        mode: 'browser-record',
        isMobile: true,
        autoOpenedKey: 'tsk_live:browser-record',
      }),
    ).toEqual({
      shouldOpen: false,
      autoOpenedKey: 'tsk_live:browser-record',
    });
  });

  it('keeps the mobile browser sheet closed outside mobile browser surfaces', () => {
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: 'tsk_live',
        mode: 'browser-live',
        isMobile: false,
        autoOpenedKey: null,
      }).shouldOpen,
    ).toBe(false);
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: 'tsk_live',
        mode: 'closed',
        isMobile: true,
        autoOpenedKey: null,
      }).shouldOpen,
    ).toBe(false);
    expect(
      mobileBrowserSheetAutoOpenState({
        taskId: null,
        mode: 'browser-live',
        isMobile: true,
        autoOpenedKey: 'tsk_live:browser-live',
      }),
    ).toEqual({
      shouldOpen: false,
      autoOpenedKey: 'tsk_live:browser-live',
    });
  });
});

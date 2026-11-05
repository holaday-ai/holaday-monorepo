import { useTaskStore } from '@/stores/task-store';
import { afterEach, describe, expect, it } from 'vitest';
import { mobileBrowserSheetAutoOpenState } from './workbench-state';

/** FIX-57 复审 #3 — the BOSS run (京东 stale text, narrow screen). */
afterEach(() => useTaskStore.getState().reset());

describe('复审 #3 · BOSS run', () => {
  it("京东: browser steps replace a search lane's streamed text (no stale 「请你自己登录」)", () => {
    useTaskStore.setState({
      tasks: [
        {
          taskId: 't1',
          title: null,
          intent: 'x',
          status: 'executing',
          tickCount: 0,
          createdAt: new Date(),
        } as never,
      ],
      streamingByTask: { t1: '京东需要登录才能查看这个商品页面。请你自己登录后告诉我继续。' },
    });
    useTaskStore
      .getState()
      .applyServerMessage({
        type: 'server.vision.tick.start',
        taskId: 't1',
        tickIndex: 1,
      } as never);
    expect(useTaskStore.getState().streamingByTask.t1).toBeUndefined();
  });

  it('narrow screen: the browser sheet opens by itself only when the person must act', () => {
    const base = {
      taskId: 't1',
      mode: 'browser-live' as const,
      isMobile: true,
      autoOpenedKey: null,
    };
    expect(mobileBrowserSheetAutoOpenState({ ...base, needsUser: false }).shouldOpen).toBe(false);
    expect(mobileBrowserSheetAutoOpenState({ ...base, needsUser: true }).shouldOpen).toBe(true);
  });
});

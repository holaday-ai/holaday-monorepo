import { describe, expect, it } from 'vitest';
import { buildScheduledDispatchNotification } from './scheduled-copy.js';

describe('buildScheduledDispatchNotification', () => {
  it('uses start copy for successful scheduled dispatches, not completion copy', () => {
    const out = buildScheduledDispatchNotification({
      intent: '抓取今日新闻',
      ok: true,
      error: null,
    });

    expect(out).toMatchObject({
      type: 'task_started',
      title: '定时任务已启动',
      taskName: '抓取今日新闻',
    });
    expect(out.message).toContain('已按计划开始执行');
    expect(out.message).toContain('任务列表查看结果');
    expect(out.message).not.toContain('已执行完成');
  });

  it('keeps failure copy specific to dispatch startup failure', () => {
    const out = buildScheduledDispatchNotification({
      intent: '导出日报',
      ok: false,
      error: 'quota gate rejected the dispatch',
    });

    expect(out).toMatchObject({
      type: 'task_failed',
      title: '定时任务启动失败',
      message: '「导出日报」未能开始执行：quota gate rejected the dispatch',
    });
  });

  it('uses skipped copy when the runner intentionally does not dispatch', () => {
    const out = buildScheduledDispatchNotification({
      intent: '生成 A股日报',
      ok: false,
      error: '非交易日，未生成简报',
      skipped: true,
    });

    expect(out).toMatchObject({
      type: 'task_skipped',
      title: '定时任务已跳过',
      message: '「生成 A股日报」本次未启动：非交易日，未生成简报',
      taskName: '生成 A股日报',
    });
  });

  it('truncates long intents consistently for title body and taskName', () => {
    const intent = 'x'.repeat(70);
    const out = buildScheduledDispatchNotification({
      intent,
      ok: true,
      error: null,
    });

    expect(out.taskName).toHaveLength(61);
    expect(out.taskName.endsWith('…')).toBe(true);
    expect(out.message).toContain(`「${out.taskName}」`);
  });
});

import { describe, expect, it } from 'vitest';
import {
  describeScheduledEventReminder,
  describeScheduledEventRepeat,
  scheduledEventActionHint,
  scheduledEventCanRunNow,
  scheduledEventFailureDetail,
  scheduledEventCanToggle,
  scheduledEventToggleLabel,
  scheduledEventToggleSuccessMessage,
} from './event-detail-state.js';

describe('event detail state helpers', () => {
  it('only exposes mutation actions for resumable scheduled events', () => {
    expect(scheduledEventCanToggle('active')).toBe(true);
    expect(scheduledEventCanToggle('paused')).toBe(true);
    expect(scheduledEventCanToggle('failed')).toBe(true);
    expect(scheduledEventCanToggle('running')).toBe(false);
    expect(scheduledEventCanToggle('completed')).toBe(false);

    expect(scheduledEventCanRunNow('active')).toBe(true);
    expect(scheduledEventCanRunNow('paused')).toBe(true);
    expect(scheduledEventCanRunNow('failed')).toBe(true);
    expect(scheduledEventCanRunNow('running')).toBe(false);
    expect(scheduledEventCanRunNow('completed')).toBe(false);
  });

  it('names toggle actions and success states precisely', () => {
    expect(scheduledEventToggleLabel('active')).toBe('暂停');
    expect(scheduledEventToggleLabel('paused')).toBe('恢复');
    expect(scheduledEventToggleLabel('failed')).toBe('重新启用');

    expect(
      scheduledEventToggleSuccessMessage({
        previousStatus: 'active',
        nextStatus: 'paused',
      }),
    ).toBe('已暂停');
    expect(
      scheduledEventToggleSuccessMessage({
        previousStatus: 'paused',
        nextStatus: 'active',
      }),
    ).toBe('已恢复');
    expect(
      scheduledEventToggleSuccessMessage({
        previousStatus: 'failed',
        nextStatus: 'active',
      }),
    ).toBe('已重新启用');
  });

  it('hides raw scheduled event failure details', () => {
    expect(scheduledEventFailureDetail('missing ANTHROPIC_API_KEY')).toBe(
      'AI 服务暂未配置，请联系 support@holaday.ai。',
    );
    expect(scheduledEventFailureDetail(null)).toBe(
      '上次执行失败，请检查任务配置后重试。',
    );
  });

  it('explains scheduled event recovery actions before users click them', () => {
    expect(scheduledEventActionHint({ status: 'paused', lastRunStatus: null })).toEqual({
      title: '计划已暂停',
      body: '恢复后会按下次执行时间继续；立即执行一次只会单独创建一条实际任务，不会改变原计划。',
      tone: 'neutral',
    });

    expect(scheduledEventActionHint({ status: 'failed', lastRunStatus: 'failed' })).toEqual({
      title: '计划已停止',
      body: '重新启用会恢复后续计划；立即执行一次会新开任务，适合先验证问题是否已经解决。',
      tone: 'error',
    });

    expect(scheduledEventActionHint({ status: 'active', lastRunStatus: 'failed' })).toEqual({
      title: '上次执行失败，计划仍在运行',
      body: '可以立即执行一次验证修复结果；如果外部网站仍需要登录或授权，先暂停计划会更稳妥。',
      tone: 'attention',
    });

    expect(scheduledEventActionHint({ status: 'active', lastRunStatus: 'skipped' })).toEqual({
      title: '上次执行已跳过',
      body: '计划仍在运行；这通常表示本次条件不满足，例如非交易日、缺少可用窗口或外部来源暂不可用。',
      tone: 'neutral',
    });

    expect(scheduledEventActionHint({ status: 'running', lastRunStatus: null })).toEqual({
      title: '正在执行',
      body: '这次运行结束前暂不能修改计划。完成后可以在任务详情查看结果。',
      tone: 'neutral',
    });

    expect(scheduledEventActionHint({ status: 'active', lastRunStatus: 'success' })).toBeNull();
  });

  it('describes reminders for compact metadata rows', () => {
    expect(describeScheduledEventReminder(null)).toBe('不提醒');
    expect(describeScheduledEventReminder(0)).toBe('执行时');
    expect(describeScheduledEventReminder(15)).toBe('15 分钟前');
    expect(describeScheduledEventReminder(60)).toBe('1 小时前');
    expect(describeScheduledEventReminder(120)).toBe('2 小时前');
  });

  it('describes preset and custom repeat rules', () => {
    expect(describeScheduledEventRepeat({ repeatType: 'weekly', rrule: null })).toBe(
      '每周',
    );
    expect(
      describeScheduledEventRepeat({
        repeatType: 'once',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      }),
    ).toBe('自定义：FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(
      describeScheduledEventRepeat({
        repeatType: 'once',
        rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=30;COUNT=20',
      }),
    ).toBe('自定义：FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=…');
  });
});

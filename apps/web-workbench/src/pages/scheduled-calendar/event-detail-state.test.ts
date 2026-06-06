import { describe, expect, it } from 'vitest';
import {
  describeScheduledEventReminder,
  describeScheduledEventRepeat,
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

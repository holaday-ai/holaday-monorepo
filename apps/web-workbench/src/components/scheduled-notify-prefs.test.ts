import { describe, expect, it } from 'vitest';
import {
  buildScheduledCreatePayload,
  scheduledDialogHasDraftChanges,
  scheduledNotifySummary,
} from './scheduled-dialog-state.js';
import { normalizeScheduledTaskRows } from '../pages/scheduled-calendar/event-mapping.js';

const base = {
  intent: '抓取竞品价格',
  repeatType: 'daily' as const,
  scheduledAt: new Date('2026-10-05T01:00:00.000Z'),
  reminderValue: 'off',
  rrule: '',
  description: '',
};

describe('Batch 10.3 — scheduled notification preferences', () => {
  it('omits default prefs from the create payload (server defaults apply)', () => {
    const payload = buildScheduledCreatePayload(base);
    expect(payload).not.toHaveProperty('notifyOnSuccess');
    expect(payload).not.toHaveProperty('failureNotifyThreshold');
  });

  it('sends opted-in success notifications and a non-default threshold', () => {
    expect(
      buildScheduledCreatePayload({ ...base, notifyOnSuccess: true, failureNotifyThreshold: 3 }),
    ).toMatchObject({ notifyOnSuccess: true, failureNotifyThreshold: 3 });
  });

  it('summarises the preferences in Chinese', () => {
    expect(scheduledNotifySummary({ failureNotifyThreshold: 1, notifyOnSuccess: false })).toBe(
      '失败即通知',
    );
    expect(scheduledNotifySummary({ failureNotifyThreshold: 3, notifyOnSuccess: true })).toBe(
      '连续失败 3 次通知，成功也通知',
    );
  });

  it('treats changed notification prefs as unsaved draft changes', () => {
    const draft = {
      initialIntent: '',
      initialScheduledAt: 'x',
      intent: '',
      repeatType: 'daily' as const,
      reminderValue: 'off',
      description: '',
      rrule: '',
      scheduledAt: 'x',
    };
    expect(scheduledDialogHasDraftChanges(draft)).toBe(false);
    expect(scheduledDialogHasDraftChanges({ ...draft, notifyOnSuccess: true })).toBe(true);
    expect(scheduledDialogHasDraftChanges({ ...draft, failureNotifyThreshold: 2 })).toBe(true);
  });

  it('keeps notification fields from the list API and drops malformed ones', () => {
    const [row, malformed] = normalizeScheduledTaskRows([
      {
        scheduledTaskId: 'sch_1',
        intent: 'x',
        nextRunAt: '2026-10-05T01:00:00.000Z',
        notifyOnSuccess: true,
        failureNotifyThreshold: 3,
        consecutiveFailures: 2,
      },
      {
        scheduledTaskId: 'sch_2',
        intent: 'y',
        nextRunAt: '2026-10-05T01:00:00.000Z',
        notifyOnSuccess: 'yes',
        failureNotifyThreshold: -1,
        consecutiveFailures: 1.5,
      },
    ]);
    expect(row).toMatchObject({ notifyOnSuccess: true, failureNotifyThreshold: 3, consecutiveFailures: 2 });
    expect(malformed).not.toHaveProperty('notifyOnSuccess');
    expect(malformed).not.toHaveProperty('failureNotifyThreshold');
    expect(malformed).not.toHaveProperty('consecutiveFailures');
  });
});

import { describe, expect, it } from 'vitest';
import {
  defaultScheduledAtLocalInput,
  formatDateTimeLocalInput,
  formatRollForward,
  nextQuickCreateDate,
} from './time-helpers.js';

describe('nextQuickCreateDate', () => {
  it('keeps a future clicked slot unchanged', () => {
    const clicked = new Date('2026-05-22T15:00:00');
    const now = new Date('2026-05-22T14:10:00');
    expect(nextQuickCreateDate(clicked, now).toISOString()).toBe(clicked.toISOString());
  });

  it('rounds a past click to the next half-hour in the future', () => {
    const clicked = new Date('2026-05-22T09:00:00');
    const now = new Date('2026-05-22T14:10:15');
    const next = nextQuickCreateDate(clicked, now);
    expect(next.getHours()).toBe(14);
    expect(next.getMinutes()).toBe(30);
    expect(next.getSeconds()).toBe(0);
  });

  it('rolls over to the next hour when the current half-hour is almost over', () => {
    const clicked = new Date('2026-05-22T09:00:00');
    const now = new Date('2026-05-22T14:45:00');
    const next = nextQuickCreateDate(clicked, now);
    expect(next.getHours()).toBe(15);
    expect(next.getMinutes()).toBe(0);
  });
});

describe('formatRollForward', () => {
  it('uses today / tomorrow labels near the current day', () => {
    const now = new Date('2026-05-22T14:00:00');
    expect(formatRollForward(new Date('2026-05-22T15:30:00'), now)).toContain(
      '今天',
    );
    expect(formatRollForward(new Date('2026-05-23T09:00:00'), now)).toContain(
      '明天',
    );
  });
});

describe('datetime-local helpers', () => {
  it('formats a local datetime without seconds or timezone', () => {
    expect(formatDateTimeLocalInput(new Date(2026, 4, 22, 9, 5, 30))).toBe(
      '2026-05-22T09:05',
    );
  });

  it('defaults full-dialog schedules to tomorrow at 09:00', () => {
    expect(defaultScheduledAtLocalInput(new Date(2026, 4, 22, 14, 10))).toBe(
      '2026-05-23T09:00',
    );
  });
});

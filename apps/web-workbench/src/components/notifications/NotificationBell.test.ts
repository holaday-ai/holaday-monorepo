import { describe, expect, it } from 'vitest';
import { formatRelative, notificationColor } from './NotificationBell.js';

describe('formatRelative', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('< 30s → 刚刚', () => {
    expect(formatRelative(new Date('2026-05-17T11:59:50Z'), now)).toBe('刚刚');
  });

  it('30s-59s → "N秒前"', () => {
    expect(formatRelative(new Date('2026-05-17T11:59:15Z'), now)).toBe('45秒前');
  });

  it('1-59 min → "N分钟前"', () => {
    expect(formatRelative(new Date('2026-05-17T11:30:00Z'), now)).toBe('30分钟前');
  });

  it('1-23 h → "N小时前"', () => {
    expect(formatRelative(new Date('2026-05-17T09:00:00Z'), now)).toBe('3小时前');
  });

  it('exactly 24h ago → "昨天"', () => {
    expect(formatRelative(new Date('2026-05-16T12:00:00Z'), now)).toBe('昨天');
  });

  it('2-6 days → "N天前"', () => {
    expect(formatRelative(new Date('2026-05-13T12:00:00Z'), now)).toBe('4天前');
  });

  it('≥ 7 days → date string MM-DD-style', () => {
    const out = formatRelative(new Date('2026-04-15T12:00:00Z'), now);
    // toLocaleDateString output varies by locale but always contains
    // the month + day digits.
    expect(out).toMatch(/04/);
    expect(out).toMatch(/15/);
  });

  it('invalid input → empty string', () => {
    expect(formatRelative('not-a-date', now)).toBe('');
  });

  it('accepts both Date and ISO string', () => {
    expect(formatRelative('2026-05-17T11:30:00Z', now)).toBe('30分钟前');
    expect(formatRelative(new Date('2026-05-17T11:30:00Z'), now)).toBe('30分钟前');
  });
});

describe('notificationColor', () => {
  it('keeps task_started distinct from task_complete', () => {
    expect(notificationColor('task_started')).toBe('#F59E0B');
    expect(notificationColor('task_complete')).toBe('#10B981');
  });

  it('keeps failures red and unknown notifications neutral', () => {
    expect(notificationColor('task_failed')).toBe('#EF4444');
    expect(notificationColor('future_type')).toBe('#94A3B8');
  });
});

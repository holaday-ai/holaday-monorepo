import { buildAstroReading, createProfileFromBirthday } from '@/lib/astrology';
import { describe, expect, it } from 'vitest';
import { buildNatalSnapshot, buildTransitSnapshot } from './horoscope-content';

const profile = createProfileFromBirthday({
  name: 'Yale',
  birthday: '1996-03-21',
  birthTime: '08:30',
  birthPlace: 'Tokyo',
});
const reading = buildAstroReading(profile, new Date('2026-08-11T12:00:00+09:00'));

describe('horoscope content', () => {
  it('builds a deterministic natal snapshot with the migrated depth', () => {
    const snapshot = buildNatalSnapshot(profile, reading);

    expect(snapshot.items.find((item) => item.label === '太阳星座')?.value).toBe('白羊座');
    expect(snapshot.items.find((item) => item.label === '月亮倾向')?.value).toBeTruthy();
    expect(snapshot.items.find((item) => item.label === '上升倾向')?.value).not.toBe(
      '待补充出生时间',
    );
    expect(snapshot.longTermAdvice).toContain(reading.focusMode);
    expect(buildNatalSnapshot(profile, reading)).toEqual(snapshot);
  });

  it('builds a seven-day transit rhythm without UI or storage values', () => {
    const snapshot = buildTransitSnapshot(reading);

    expect(snapshot.weekly).toHaveLength(7);
    expect(snapshot.strongest).toHaveLength(3);
    expect(snapshot.strongest[0]?.energy).toBeGreaterThanOrEqual(
      snapshot.strongest[1]?.energy ?? 0,
    );
    expect(JSON.stringify(snapshot)).not.toMatch(/localStorage|react|className/i);
  });
});

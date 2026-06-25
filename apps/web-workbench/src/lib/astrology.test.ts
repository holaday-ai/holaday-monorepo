import { describe, expect, it } from 'vitest';
import {
  buildAstroReading,
  createProfileFromBirthday,
  zodiacFromBirthday,
} from '@/lib/astrology';

describe('astrology helpers', () => {
  it.each([
    ['1996-03-21', 'aries'],
    ['1996-04-20', 'taurus'],
    ['1996-05-21', 'gemini'],
    ['1996-06-21', 'cancer'],
    ['1996-07-23', 'leo'],
    ['1996-08-23', 'virgo'],
    ['1996-09-23', 'libra'],
    ['1996-10-23', 'scorpio'],
    ['1996-11-22', 'sagittarius'],
    ['1996-12-22', 'capricorn'],
    ['1996-01-20', 'aquarius'],
    ['1996-02-19', 'pisces'],
  ])('maps %s to %s', (birthday, expected) => {
    expect(zodiacFromBirthday(birthday)).toBe(expected);
  });

  it('creates a profile and deterministic daily reading', () => {
    const profile = createProfileFromBirthday({
      name: 'Yale',
      birthday: '1996-03-21',
      birthTime: '08:30',
      birthPlace: 'Tokyo',
    });
    const reading = buildAstroReading(profile, new Date('2026-06-25T00:00:00+09:00'));

    expect(profile.zodiacSign).toBe('aries');
    expect(reading.zodiacLabel).toBe('白羊座');
    expect(reading.energyScore).toBeGreaterThanOrEqual(56);
    expect(reading.energyScore).toBeLessThanOrEqual(94);
    expect(reading.fortune.map((item) => item.key)).toEqual([
      'overall',
      'career',
      'wealth',
      'love',
      'health',
    ]);
    expect(reading.waitingCards).toHaveLength(3);
    expect(reading.weekly).toHaveLength(7);
  });
});

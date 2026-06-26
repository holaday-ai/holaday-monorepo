import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAstroReading,
  clearAstroProfile,
  createProfileFromBirthday,
  readAstroProfile,
  saveAstroProfile,
  zodiacFromBirthday,
} from '@/lib/astrology';

describe('astrology helpers', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('scopes persisted profiles by user id', () => {
    const aries = createProfileFromBirthday({
      name: 'User A',
      birthday: '1996-03-21',
    });
    const taurus = createProfileFromBirthday({
      name: 'User B',
      birthday: '1996-04-20',
    });

    saveAstroProfile(aries, 'user-a');
    saveAstroProfile(taurus, 'user-b');

    expect(readAstroProfile('user-a')?.zodiacSign).toBe('aries');
    expect(readAstroProfile('user-b')?.zodiacSign).toBe('taurus');
    expect(readAstroProfile()).toBeNull();

    clearAstroProfile('user-a');

    expect(readAstroProfile('user-a')).toBeNull();
    expect(readAstroProfile('user-b')?.zodiacSign).toBe('taurus');
  });
});

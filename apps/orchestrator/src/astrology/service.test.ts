import { describe, expect, it } from 'vitest';
import {
  buildDailyAstrologyReading,
  hasAstrologyApiCredentials,
  zodiacFromBirthday,
} from './service.js';

describe('astrology service', () => {
  it('derives zodiac signs from birthday boundaries', () => {
    expect(zodiacFromBirthday('1996-03-21')).toBe('aries');
    expect(zodiacFromBirthday('1996-04-20')).toBe('taurus');
    expect(zodiacFromBirthday('1996-12-22')).toBe('capricorn');
    expect(zodiacFromBirthday('1996-02-19')).toBe('pisces');
  });

  it('uses the mock provider when AstrologyAPI credentials are absent', () => {
    const reading = buildDailyAstrologyReading(
      { birthday: '1996-03-21' },
      {
        env: {},
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('mock');
    expect(reading.apiConfigured).toBe(false);
    expect(reading.zodiacLabel).toBe('白羊座');
    expect(reading.weekly).toHaveLength(7);
  });

  it('reports AstrologyAPI readiness without exposing credentials', () => {
    expect(
      hasAstrologyApiCredentials({
        ASTROLOGY_API_USER_ID: 'user',
        ASTROLOGY_API_KEY: 'secret',
      }),
    ).toBe(true);

    const reading = buildDailyAstrologyReading(
      { birthday: '1996-01-25', zodiacSign: 'aquarius' },
      {
        env: {
          ASTROLOGY_API_USER_ID: 'user',
          ASTROLOGY_API_KEY: 'secret',
        },
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('astrologyapi');
    expect(reading.apiConfigured).toBe(true);
    expect(reading.zodiacSign).toBe('aquarius');
  });
});

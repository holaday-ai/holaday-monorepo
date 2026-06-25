import { describe, expect, it } from 'vitest';
import {
  buildDailyAstrologyReading,
  getDailyAstrologyReading,
  getDailyTarotReading,
  hasAstrologyApiCredentials,
  hasDivineApiCredentials,
  zodiacFromBirthday,
} from './service.js';

describe('astrology service', () => {
  it('derives zodiac signs from birthday boundaries', () => {
    expect(zodiacFromBirthday('1996-03-21')).toBe('aries');
    expect(zodiacFromBirthday('1996-04-20')).toBe('taurus');
    expect(zodiacFromBirthday('1996-12-22')).toBe('capricorn');
    expect(zodiacFromBirthday('1996-02-19')).toBe('pisces');
  });

  it('uses the mock provider when DivineAPI credentials are absent', () => {
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

  it('reports DivineAPI readiness without exposing credentials', () => {
    expect(
      hasDivineApiCredentials({
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
      }),
    ).toBe(true);
    expect(
      hasAstrologyApiCredentials({
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
      }),
    ).toBe(true);

    const reading = buildDailyAstrologyReading(
      { birthday: '1996-01-25', zodiacSign: 'aquarius' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
        },
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('mock');
    expect(reading.apiConfigured).toBe(true);
    expect(reading.zodiacSign).toBe('aquarius');
  });

  it('maps DivineAPI daily horoscope responses onto the reading shape', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            prediction: {
              personal_life: 'A clear daily summary from DivineAPI.',
              profession: 'Prioritize one important work task.',
            },
            lucky_color: 'Blue',
          },
        }),
      } as Response;
    }) as typeof fetch;

    const reading = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
        },
        fetchImpl,
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('divineapi');
    expect(reading.headline).toBe('A clear daily summary from DivineAPI.');
    expect(reading.workNote).toBe('Prioritize one important work task.');
    expect(reading.luckyColor).toBe('Blue');
    expect(calls[0]?.url).toBe('https://example.test/api/v5/daily-horoscope');
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer token',
    });
    expect(String(calls[0]?.init?.body)).toContain('sign=aries');
  });

  it('maps DivineAPI daily tarot responses with mock fallback shape', async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            card_name: 'The Sun',
            card_type: 'Major Arcana',
            prediction: 'Good momentum for a bright, simple action.',
          },
        }),
      }) as Response) as typeof fetch;

    const reading = await getDailyTarotReading(
      { zodiacSign: 'leo' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
        },
        fetchImpl,
        now: new Date('2026-06-25T00:00:00.000Z'),
      },
    );

    expect(reading.provider).toBe('divineapi');
    expect(reading.title).toBe('The Sun');
    expect(reading.subtitle).toBe('Major Arcana');
    expect(reading.body).toBe('Good momentum for a bright, simple action.');
  });
});

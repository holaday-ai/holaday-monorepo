import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDailyAstrologyReading,
  clearDivineApiCacheForTest,
  divineApiStatus,
  getDailyAstrologyReading,
  getDailyTarotReading,
  getWeeklyAstrologyReading,
  getYesNoTarotReading,
  hasAstrologyApiCredentials,
  hasDivineApiCredentials,
  zodiacFromBirthday,
} from './service.js';

describe('astrology service', () => {
  afterEach(() => {
    clearDivineApiCacheForTest();
    vi.useRealTimers();
  });

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

    expect(
      divineApiStatus({
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_CACHE_TTL_MS: '60000',
        DIVINE_API_CAPABILITIES_CHECKED_AT: '2026-08-12T00:00:00.000Z',
      }),
    ).toMatchObject({
      provider: 'divineapi',
      apiConfigured: true,
      cacheTtlMs: 60000,
      cacheEntries: 0,
      endpoints: {
        dailyHoroscope: '/api/v5/daily-horoscope',
        dailyTarot: '/api/v2/daily-tarot',
        weeklyHoroscope: '/api/v5/weekly-horoscope',
        yesNoTarot: '/api/v2/yes-or-no-tarot',
      },
    });
  });

  it('does not call a provider endpoint that is absent from the capability allowlist', async () => {
    let called = false;
    const reading = await getDailyTarotReading(
      { zodiacSign: 'leo' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_CAPABILITIES: 'daily-horoscope',
        },
        fetchImpl: (async () => {
          called = true;
          throw new Error('disabled endpoint must not be called');
        }) as typeof fetch,
      },
    );

    expect(called).toBe(false);
    expect(reading.provider).toBe('mock');
  });

  it('treats an HTTP-200 business denial as a local fallback', async () => {
    const env = {
      DIVINE_API_KEY: 'key',
      DIVINE_ACCESS_TOKEN: 'token',
      DIVINE_API_BASE_URL: 'https://example.test',
      DIVINE_API_CAPABILITIES: 'daily-horoscope',
      DIVINE_API_CAPABILITIES_CHECKED_AT: '2026-08-12T00:00:00.000Z',
    };
    const reading = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      {
        env,
        fetchImpl: (async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              success: 2,
              msg: 'You are not authorized to access this API',
            }),
          }) as Response) as typeof fetch,
      },
    );

    expect(reading.provider).toBe('mock');
    expect(divineApiStatus(env).capabilities).toContainEqual({
      capability: 'daily-horoscope',
      available: false,
      checkedAt: '2026-08-12T00:00:00.000Z',
      reason: 'not-authorized',
    });
  });

  it('uses a recently expired validated response after a transient provider failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'));
    let callCount = 0;
    const env = {
      DIVINE_API_KEY: 'key',
      DIVINE_ACCESS_TOKEN: 'token',
      DIVINE_API_BASE_URL: 'https://example.test',
      DIVINE_API_CAPABILITIES: 'daily-horoscope',
      DIVINE_API_CACHE_TTL_MS: '1000',
      DIVINE_API_STALE_IF_ERROR_MS: '5000',
    };
    const fetchImpl = (async () => {
      callCount += 1;
      if (callCount > 1) throw new Error('provider unavailable');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: { prediction: { personal_life: 'Last verified provider result.' } },
        }),
      } as Response;
    }) as typeof fetch;

    const first = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      { env, fetchImpl },
    );
    vi.advanceTimersByTime(2000);
    const stale = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      { env, fetchImpl },
    );
    vi.advanceTimersByTime(5000);
    const expired = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      { env, fetchImpl },
    );

    expect(first.headline).toBe('Last verified provider result.');
    expect(stale.provider).toBe('divineapi');
    expect(stale.headline).toBe('Last verified provider result.');
    expect(expired.provider).toBe('mock');
  });

  it('reports every known capability without exposing provider secrets', () => {
    const status = divineApiStatus({
      DIVINE_API_KEY: 'secret-key',
      DIVINE_ACCESS_TOKEN: 'secret-token',
      DIVINE_API_CAPABILITIES: 'daily-horoscope,weekly-horoscope',
      DIVINE_API_CAPABILITIES_CHECKED_AT: '2026-08-12T00:00:00.000Z',
    });

    expect(status.capabilities).toHaveLength(10);
    expect(status.capabilities).toContainEqual({
      capability: 'daily-horoscope',
      available: true,
      checkedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(status.capabilities).toContainEqual({
      capability: 'daily-tarot',
      available: false,
      checkedAt: '2026-08-12T00:00:00.000Z',
      reason: 'not-configured',
    });
    expect(JSON.stringify(status)).not.toContain('secret-key');
    expect(JSON.stringify(status)).not.toContain('secret-token');
  });

  it('maps the official weekly horoscope response and reuses its cache', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            week: 'August 10 - August 16',
            weekly_horoscope: {
              personal: 'Make room for one honest conversation.',
              health: 'Choose a calmer pace.',
              profession: 'Finish the important draft first.',
              emotions: 'Name the feeling before reacting.',
              travel: 'Keep the plan flexible.',
              luck: 'Small experiments are favored.',
            },
            special: { lucky_color_codes: ['#FFB86B', '#9ED8FF'] },
          },
        }),
      } as Response;
    }) as typeof fetch;
    const options = {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CACHE_TTL_MS: '60000',
        DIVINE_API_CAPABILITIES: 'weekly-horoscope',
      },
      fetchImpl,
      now: new Date('2026-08-11T00:00:00.000Z'),
    };

    const first = await getWeeklyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      options,
    );
    const second = await getWeeklyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      options,
    );

    expect(calls).toEqual(['https://example.test/api/v5/weekly-horoscope']);
    expect(first).toEqual(second);
    expect(first.provider).toBe('divineapi');
    expect(first.weekLabel).toBe('August 10 - August 16');
    expect(first.profession).toBe('Finish the important draft first.');
    expect(first.luckyColors).toEqual(['#FFB86B', '#9ED8FF']);
  });

  it('maps yes/no tarot without sending a user question and falls back safely', async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      bodies.push(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            prediction: {
              card: 'The Sun',
              category: 'Major Arcana',
              yes_no: 'YES',
              result: 'Move forward with a clear and simple first step.',
              image: 'https://example.test/the-sun.jpg',
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const reading = await getYesNoTarotReading(
      { zodiacSign: 'leo', locale: 'zh-CN' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
          DIVINE_API_CAPABILITIES: 'yes-no-tarot',
        },
        fetchImpl,
        now: new Date('2026-08-11T00:00:00.000Z'),
      },
    );

    expect(reading).toMatchObject({
      provider: 'divineapi',
      answer: 'yes',
      card: 'The Sun',
      category: 'Major Arcana',
      result: 'Move forward with a clear and simple first step.',
    });
    expect(bodies[0]).not.toMatch(/question|Move forward/);

    const fallback = await getYesNoTarotReading(
      { zodiacSign: 'leo' },
      {
        env: {
          DIVINE_API_KEY: 'key',
          DIVINE_ACCESS_TOKEN: 'token',
          DIVINE_API_BASE_URL: 'https://example.test',
          DIVINE_API_CAPABILITIES: 'yes-no-tarot',
        },
        fetchImpl: (async () => {
          throw new Error('provider unavailable');
        }) as typeof fetch,
        now: new Date('2026-08-12T00:00:00.000Z'),
      },
    );
    expect(fallback.provider).toBe('mock');
    expect(['yes', 'no', 'maybe']).toContain(fallback.answer);
    expect(fallback.result.length).toBeGreaterThan(10);
  });

  it('maps DivineAPI daily horoscope responses onto the reading shape', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
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
          DIVINE_API_CAPABILITIES: 'daily-horoscope',
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
          success: 1,
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
          DIVINE_API_CAPABILITIES: 'daily-tarot',
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

  it('caches identical DivineAPI calls to avoid repeated provider usage', async () => {
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            prediction: {
              personal_life: `Cached daily summary ${callCount}.`,
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const options = {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CACHE_TTL_MS: '60000',
        DIVINE_API_CAPABILITIES: 'daily-horoscope',
      },
      fetchImpl,
      now: new Date('2026-06-25T00:00:00.000Z'),
    };

    const first = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      options,
    );
    const second = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries', locale: 'zh-CN' },
      options,
    );

    expect(callCount).toBe(1);
    expect(first.headline).toBe('Cached daily summary 1.');
    expect(second.headline).toBe('Cached daily summary 1.');
    expect(divineApiStatus(options.env).cacheEntries).toBe(1);
  });

  it('can disable DivineAPI cache with a zero TTL', async () => {
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: 1,
          data: {
            prediction: {
              personal_life: `Uncached daily summary ${callCount}.`,
            },
          },
        }),
      } as Response;
    }) as typeof fetch;

    const options = {
      env: {
        DIVINE_API_KEY: 'key',
        DIVINE_ACCESS_TOKEN: 'token',
        DIVINE_API_BASE_URL: 'https://example.test',
        DIVINE_API_CACHE_TTL_MS: '0',
        DIVINE_API_CAPABILITIES: 'daily-horoscope',
      },
      fetchImpl,
      now: new Date('2026-06-25T00:00:00.000Z'),
    };

    const first = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      options,
    );
    const second = await getDailyAstrologyReading(
      { birthday: '1996-03-21', zodiacSign: 'aries' },
      options,
    );

    expect(callCount).toBe(2);
    expect(first.headline).toBe('Uncached daily summary 1.');
    expect(second.headline).toBe('Uncached daily summary 2.');
    expect(divineApiStatus(options.env).cacheEntries).toBe(0);
  });
});
